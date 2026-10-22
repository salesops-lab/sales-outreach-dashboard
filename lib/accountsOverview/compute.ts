/**
 * Accounts Overview — the pure metrics engine (no I/O; unit-tested). The API route loads the
 * sdr_ao_* rows once (cached), `prepare()`s indexes, then every filter change is one
 * `computeView()` call in memory — HubSpot is never re-read on a filter change.
 *
 * Counting rules (the metric → source map lives in docs/accounts-overview.md):
 *  - Calls = OUTBOUND calls; Connected = isConnected(disposition) — the dashboard's validated
 *    11-GUID rule (config/dispositions.ts); Emails = outgoing (hs_email_direction = EMAIL);
 *    Meetings = HubSpot meeting records (counted separately). Touchpoints = calls + emails.
 *    Notes/tasks appear in the account timeline but are NOT touchpoints.
 *  - An activity is counted ONCE per account even when it reaches the account both directly
 *    and through a contact; team/rep totals de-duplicate by activity id.
 *  - Demos come from Auto-Pipeline deals' HubSpot date fields: booked = "Demo Scheduled for
 *    Date" (demo_scheduled_for_date), completed = "Demo Completed Date" (demo_completed_date).
 *  - Account Owner, Assigned Team, Activity Owner and Contact Owner are never interchanged.
 */
import { isConnected, MEETING_SCHEDULED_GUID, MEETING_RESCHEDULED_GUID, dispositionLabel } from "../../config/dispositions";
import { AO_DEEP_INACTIVE_DAYS, AO_INACTIVE_DAYS, AO_TEAM_ROSTER, AO_TEAMS, AoRole, teamValueById } from "../../config/accounts-overview";
import {
  classifyAccountType, companyIcp, companyStatus, contactIcp, daysSince, gdKeyOf, gdNameOf,
  normalizeCountry, rooftopStatus, TypeVerdict,
} from "./classify";
import {
  AccountType, AoActivityRow, AoCompanyRow, AoContactRow, AoDealRow, AoFilters, AoSyncState,
  DateRange, IcpStatus, InactivityStatus,
} from "./types";

export interface AoData {
  companies: AoCompanyRow[];
  contacts: AoContactRow[];
  activities: AoActivityRow[];
  deals: AoDealRow[];
  state: AoSyncState;
  /** owner id → role label from the TrackerAI roster (Manager / SDR / AE). Optional. */
  roles?: Record<string, MemberRole>;
}

/** Roster roles (Manager / SDR / AE) plus the labels in the confirmed team mapping. */
export type MemberRole = "Manager" | "SDR" | "AE" | AoRole;

/** Role per HubSpot owner from the TrackerAI roster: AE-pod leads and SDR managers/TLs are
 *  "Manager", other roster members their SDR/AE type. Owners not in the roster get no role. */
export function rolesFromRoster(ts: {
  pods: { leadEmail: string | null }[];
  managers: Record<string, { ownerId: string | null }>;
  members: { ownerId: string; email: string | null; kind: string; active: boolean }[];
}): Record<string, MemberRole> {
  const out: Record<string, MemberRole> = {};
  const leads = new Set(ts.pods.map((p) => (p.leadEmail ?? "").toLowerCase()).filter(Boolean));
  const mgrIds = new Set(Object.values(ts.managers).map((m) => m.ownerId).filter(Boolean) as string[]);
  for (const m of ts.members) {
    if (mgrIds.has(m.ownerId) || (m.email && leads.has(m.email.toLowerCase()))) out[m.ownerId] = "Manager";
    else if (m.kind === "sdr" || m.kind === "ae") out[m.ownerId] = m.kind === "sdr" ? "SDR" : "AE";
  }
  for (const id of mgrIds) out[id] = "Manager";
  return out;
}

interface PCompany {
  row: AoCompanyRow;
  type: TypeVerdict;
  country: string;
  icp: IcpStatus;
  gdKey: string | null;
  gdName: string | null;
  contacts: AoContactRow[];
  acts: AoActivityRow[];       // whole synced window, newest first
  deals: AoDealRow[];
  hasWindowTouch: boolean;     // any outbound call / outgoing email / meeting in the synced window
  lastTouchWindowMs: number | null;
}

export interface Prepared {
  data: AoData;
  companies: PCompany[];
  byId: Map<string, PCompany>;
  contactById: Map<string, AoContactRow>;
  ownerName: (id: string | null | undefined) => string;
  /** The owner's team among the four = their HubSpot MAIN team (see `memberTeam`), or null. */
  teamOfOwner: (id: string | null | undefined) => string | null;
  /** [teamOfOwner] or [] — kept as a list for callers that test membership. */
  teamsOfOwner: (id: string | null | undefined) => string[];
  roleOf: (id: string | null | undefined) => MemberRole | null;
  /** A deal's team = its HubSpot Team field as stored by the sync (null = none of the four). */
  dealTeam: (d: AoDealRow) => string | null;
}

const ROSTER_BY_EMAIL = new Map(AO_TEAM_ROSTER.map((r) => [r.email.toLowerCase(), r]));

/** Which of the four teams a HubSpot owner belongs to: their HubSpot MAIN team when the sync stored
 *  it; otherwise (older sync) the confirmed mapping by email; otherwise their only in-scope team.
 *  Extra teams never count — they double-listed Shadman Khalid and a shared CS login. */
export function memberTeam(o: AoSyncState["owners"][string] | undefined): string | null {
  if (!o) return null;
  if (o.primary_team !== undefined) return teamValueById(o.primary_team);
  const listed = o.email ? ROSTER_BY_EMAIL.get(o.email.toLowerCase()) : undefined;
  if (listed) return listed.team;
  const inScope = [...new Set((o.teams ?? []).map(teamValueById).filter(Boolean) as string[])];
  return inScope.length === 1 ? inScope[0] : null;
}

const isCall = (a: AoActivityRow) => a.type === "call" && (a.direction ?? "").toUpperCase() === "OUTBOUND";
const isEmail = (a: AoActivityRow) => a.type === "email" && (a.direction ?? "").toUpperCase() === "EMAIL";
const isMeeting = (a: AoActivityRow) => a.type === "meeting";
/** Touchpoint = an outbound call or an outgoing email (the same Total Touches rule as Call Blitz). */
const isTouch = (a: AoActivityRow) => isCall(a) || isEmail(a);
const isMeetingDisposition = (a: AoActivityRow) =>
  isCall(a) && (a.disposition === MEETING_SCHEDULED_GUID || a.disposition === MEETING_RESCHEDULED_GUID);
const isEngaged = (a: AoActivityRow) => (isCall(a) && isConnected(a.disposition)) || isMeeting(a) || (isEmail(a) && a.email_replied);

export function prepare(data: AoData): Prepared {
  const contactById = new Map(data.contacts.map((c) => [c.hs_id, c]));
  const contactsByCo = new Map<string, AoContactRow[]>();
  for (const c of data.contacts) for (const co of c.company_ids) {
    const l = contactsByCo.get(co) ?? []; l.push(c); contactsByCo.set(co, l);
  }
  const actsByCo = new Map<string, AoActivityRow[]>();
  for (const a of data.activities) for (const co of a.company_ids) {
    const l = actsByCo.get(co) ?? []; l.push(a); actsByCo.set(co, l);
  }
  const dealsByCo = new Map<string, AoDealRow[]>();
  for (const d of data.deals) for (const co of d.company_ids) {
    const l = dealsByCo.get(co) ?? []; l.push(d); dealsByCo.set(co, l);
  }
  const companies: PCompany[] = data.companies.map((row) => {
    const acts = (actsByCo.get(row.hs_id) ?? []).slice().sort((a, b) => b.ts_ms - a.ts_ms);
    const firstTouch = acts.find((a) => isTouch(a) || isMeeting(a)); // any real contact, meetings included
    return {
      row, type: classifyAccountType(row), country: normalizeCountry(row.country), icp: companyIcp(row.icp),
      gdKey: gdKeyOf(row), gdName: gdNameOf(row),
      contacts: contactsByCo.get(row.hs_id) ?? [], acts, deals: dealsByCo.get(row.hs_id) ?? [],
      hasWindowTouch: !!firstTouch, lastTouchWindowMs: firstTouch?.ts_ms ?? null,
    };
  });
  const owners = data.state.owners ?? {};
  const ownerName = (id: string | null | undefined) => (id ? owners[id]?.name || `Owner ${id}` : "—");
  const teamOfOwner = (id: string | null | undefined) => (id ? memberTeam(owners[id]) : null);
  const teamsOfOwner = (id: string | null | undefined) => { const t = teamOfOwner(id); return t ? [t] : []; };
  const roles = data.roles ?? {};
  // Role: the confirmed mapping (by HubSpot email) first, then the TrackerAI roster.
  const roleOf = (id: string | null | undefined): MemberRole | null => {
    if (!id) return null;
    const email = owners[id]?.email;
    return (email && ROSTER_BY_EMAIL.get(email.toLowerCase())?.role) || roles[id] || null;
  };
  const dealTeam = (d: AoDealRow) => d.team ?? null;
  return { data, companies, byId: new Map(companies.map((c) => [c.row.hs_id, c])), contactById, ownerName, teamOfOwner, teamsOfOwner, roleOf, dealTeam };
}

// ── per-account calc for the reporting period ────────────────────────────────
export interface AccountCalc {
  p: PCompany;
  cStatus: InactivityStatus;
  rStatus: InactivityStatus;
  cDays: number | null;
  rDays: number | null;
  neverContacted: boolean;       // verified: HubSpot Last Contacted empty AND no touch in the synced window
  contactedConflict: boolean;    // HubSpot Last Contacted empty BUT a touch exists in the synced window
  periodActs: AoActivityRow[];   // activities in the activity date range after the type filter
  calls: number; connected: number; emails: number; meetings: number; notes: number; tasks: number;
  meetingsCompleted: number; meetingsCanceled: number; meetingsNoShow: number; meetingsRescheduled: number; meetingsNoOutcome: number;
  meetingDispositionCalls: number;
  touchpoints: number;
  demosBooked: number; demosCompleted: number;
  bookedDealIds: string[]; completedDealIds: string[]; // deals counted in the period (de-dup across accounts)
  contactsTouched: Set<string>; contactsReached: Set<string>;
  activityOwners: Set<string>;
  lastCallMs: number | null; lastEmailMs: number | null; lastMeetingMs: number | null; lastDemoMs: number | null;
  lastTouchPeriodMs: number | null;
}

const inRange = (ms: number | null, r: DateRange | null): boolean => {
  if (!r) return true;
  if (ms == null) return !!r.includeMissing;
  if (r.fromMs != null && ms < r.fromMs) return false;
  if (r.toMs != null && ms >= r.toMs) return false;
  return true;
};

export function calcAccount(prep: Prepared, p: PCompany, f: AoFilters, nowMs: number): AccountCalc {
  const typeSet = f.activityTypes.length ? new Set(f.activityTypes) : null;
  const periodActs = p.acts.filter((a) =>
    a.ts_ms >= f.activityFrom && a.ts_ms < f.activityTo &&
    (!typeSet || typeSet.has(a.type)));
  const c: AccountCalc = {
    p,
    cStatus: companyStatus(p.row, nowMs, AO_INACTIVE_DAYS, AO_DEEP_INACTIVE_DAYS),
    rStatus: rooftopStatus(p.row.rooftop_last_activity_ms, nowMs, AO_INACTIVE_DAYS, AO_DEEP_INACTIVE_DAYS),
    cDays: daysSince(p.row.last_activity_ms, nowMs),
    rDays: daysSince(p.row.rooftop_last_activity_ms, nowMs),
    neverContacted: p.row.last_contacted_ms == null && !p.hasWindowTouch,
    contactedConflict: p.row.last_contacted_ms == null && p.hasWindowTouch,
    periodActs,
    calls: 0, connected: 0, emails: 0, meetings: 0, notes: 0, tasks: 0,
    meetingsCompleted: 0, meetingsCanceled: 0, meetingsNoShow: 0, meetingsRescheduled: 0, meetingsNoOutcome: 0,
    meetingDispositionCalls: 0, touchpoints: 0, demosBooked: 0, demosCompleted: 0,
    bookedDealIds: [], completedDealIds: [],
    contactsTouched: new Set(), contactsReached: new Set(), activityOwners: new Set(),
    lastCallMs: null, lastEmailMs: null, lastMeetingMs: null, lastDemoMs: null, lastTouchPeriodMs: null,
  };
  for (const a of periodActs) {
    if (a.owner_id) c.activityOwners.add(a.owner_id);
    if (a.type === "note") c.notes++;
    else if (a.type === "task") c.tasks++;
    if (isCall(a)) { c.calls++; if (isConnected(a.disposition)) c.connected++; if (isMeetingDisposition(a)) c.meetingDispositionCalls++; }
    if (isEmail(a)) c.emails++;
    if (isMeeting(a)) {
      c.meetings++;
      const o = (a.meeting_outcome ?? "").toUpperCase();
      if (o === "COMPLETED") c.meetingsCompleted++;
      else if (o === "CANCELED") c.meetingsCanceled++;
      else if (o === "NO_SHOW") c.meetingsNoShow++;
      else if (o === "RESCHEDULED") c.meetingsRescheduled++;
      else if (!o) c.meetingsNoOutcome++;
    }
    if (isTouch(a)) {
      c.touchpoints++;
      if (c.lastTouchPeriodMs == null || a.ts_ms > c.lastTouchPeriodMs) c.lastTouchPeriodMs = a.ts_ms;
      for (const id of a.contact_ids) c.contactsTouched.add(id);
      if (isEngaged(a)) for (const id of a.contact_ids) c.contactsReached.add(id);
    }
  }
  // Last-dates span the whole synced window (not just the period) — labelled as such in the UI.
  for (const a of p.acts) {
    if (c.lastCallMs == null && isCall(a)) c.lastCallMs = a.ts_ms;
    if (c.lastEmailMs == null && isEmail(a)) c.lastEmailMs = a.ts_ms;
    if (c.lastMeetingMs == null && isMeeting(a)) c.lastMeetingMs = a.ts_ms;
  }
  // Demos are deal events, not activities — the type filter only hides them when the user
  // filtered to specific activity types.
  const demosVisible = !typeSet;
  for (const d of p.deals) {
    if (d.demo_booked_ms != null && (c.lastDemoMs == null || d.demo_booked_ms > c.lastDemoMs)) c.lastDemoMs = d.demo_booked_ms;
    if (!demosVisible) continue;
    if (d.demo_booked_ms != null && d.demo_booked_ms >= f.activityFrom && d.demo_booked_ms < f.activityTo) c.bookedDealIds.push(d.hs_id);
    if (d.demo_completed_ms != null && d.demo_completed_ms >= f.activityFrom && d.demo_completed_ms < f.activityTo) c.completedDealIds.push(d.hs_id);
  }
  c.demosBooked = c.bookedDealIds.length;
  c.demosCompleted = c.completedDealIds.length;
  return c;
}

/** Account-level filters → the account set, then the per-account period calc. */
export function filterAccounts(prep: Prepared, f: AoFilters, nowMs: number): AccountCalc[] {
  const teams = new Set(f.teams.length ? f.teams : AO_TEAMS.map((t) => t.value));
  const q = f.q.trim().toLowerCase();
  const gd = f.gdName.trim().toLowerCase();
  const state = f.state.trim().toLowerCase();
  const out: AccountCalc[] = [];
  for (const p of prep.companies) {
    const r = p.row;
    if (!r.team || !teams.has(r.team)) continue;
    if (f.country !== "all" && p.country !== f.country) continue;
    if (state !== "all" && (r.state ?? "").trim().toLowerCase() !== state) continue;
    if (gd && p.gdKey !== gd) continue;
    if (f.dealerType !== "all") {
      const t = (r.type_of_dealership ?? "").trim().toLowerCase();
      if (f.dealerType === "none" ? t !== "" : t !== f.dealerType) continue;
    }
    if (f.owner && (f.owner === "none" ? r.owner_id != null : r.owner_id !== f.owner)) continue;
    if (f.icp !== "all" && p.icp !== f.icp) continue;
    if (q && !((r.name ?? "").toLowerCase().includes(q) || (r.domain ?? "").toLowerCase().includes(q) || r.hs_id === q)) continue;
    if (!inRange(r.last_activity_ms, f.companyDate)) continue;
    out.push(calcAccount(prep, p, f, nowMs));
  }
  return out;
}

/** 60-day work status used by the team / member tables, the account cards and the group drawer
 *  (user decision 2026-10-21): group rooftops (GD Name set) go by the custom Rooftop Last Activity,
 *  single companies (SF + SI) by HubSpot's company Last Activity Date. "no_activity" = that date is empty. */
export type WorkStatus = "active" | "inactive_60plus" | "no_activity" | "needs_review";
export function workStatus(c: AccountCalc): WorkStatus {
  const s = c.p.type.type === "group" ? c.rStatus : c.cStatus;
  if (s === "active") return "active";
  if (s === "inactive_60" || s === "inactive_90") return "inactive_60plus";
  if (s === "no_activity" || s === "missing_date") return "no_activity";
  return "needs_review";
}

// ── drill-down predicates (KPI click → filtered account list) ────────────────
export function drillMatch(c: AccountCalc, key: string): boolean {
  if (!key) return true;
  const [k, v, scope] = key.split(":");
  const icpYes = c.p.icp === "yes";
  switch (k) {
    case "type": return c.p.type.type === v;
    case "single": return c.p.type.type !== "group";
    case "work": { // work:<status>[:group|single]
      const isGroup = c.p.type.type === "group";
      if ((scope === "group" && !isGroup) || (scope === "single" && isGroup)) return false;
      return workStatus(c) === v;
    }
    case "cstatus": return v === "inactive_60plus" ? (c.cStatus === "inactive_60" || c.cStatus === "inactive_90") : c.cStatus === v;
    case "rstatus": return v === "inactive_60plus" ? (c.rStatus === "inactive_60" || c.rStatus === "inactive_90") : c.rStatus === v;
    case "never_contacted": return c.neverContacted;
    case "contacted_conflict": return c.contactedConflict;
    case "contacted": return c.touchpoints > 0;
    case "not_contacted": return c.touchpoints === 0;
    case "touch": return v === "0" ? c.touchpoints === 0 : v === "1" ? c.touchpoints === 1 : c.touchpoints >= 2;
    case "icp": return c.p.icp === v;
    case "icp_contacted": return icpYes && c.touchpoints > 0;
    case "icp_not_contacted": return icpYes && c.touchpoints === 0;
    case "icp_inactive": return icpYes && (v === "90" ? c.cStatus === "inactive_90" : c.cStatus === "inactive_60" || c.cStatus === "inactive_90");
    case "with_meeting": return c.meetings > 0;
    case "with_demo": return c.demosBooked > 0;
    case "icp_with_meeting": return icpYes && c.meetings > 0;
    case "icp_with_demo": return icpYes && c.demosBooked > 0;
    case "icp_contacted_no_meeting": return icpYes && c.touchpoints > 0 && c.meetings === 0;
    case "icp_contacted_no_demo": return icpYes && c.touchpoints > 0 && c.demosBooked === 0;
    case "team": return c.p.row.team === v;
    case "owner": return (c.p.row.owner_id ?? "") === v;
    default: return true;
  }
}

// ── aggregates ───────────────────────────────────────────────────────────────
export interface Tally {
  accounts: number; single_franchise: number; independent: number; group: number; unknown: number;
  unique_gds: number;
  c_active: number; c_inactive_60: number; c_inactive_90: number; c_no_activity: number; c_needs_review: number;
  r_active: number; r_inactive_60: number; r_inactive_90: number; r_missing_date: number; r_needs_review: number;
  never_contacted: number;
  contacts: number;               // distinct associated contacts (synced associations)
  hubspot_contacts: number;       // Σ HubSpot num_associated_contacts (reference)
  icp_yes: number; icp_no: number; icp_unknown: number;
  contacted: number;              // accounts with ≥1 touchpoint in period
  touch_0: number; touch_1: number; touch_2plus: number;
  calls: number; connected: number; emails: number; meetings: number; notes: number; tasks: number; touchpoints: number;
  meetings_completed: number; meetings_canceled: number; meetings_no_show: number; meetings_rescheduled: number; meetings_no_outcome: number;
  meeting_disposition_calls: number;
  demos_booked: number; demos_completed: number;
  accounts_with_meeting: number; accounts_with_demo: number; accounts_with_demo_completed: number;
  contacts_touched: number; contacts_reached: number;
  last_touch_ms: number | null;
}

/** Roll accounts up. Activity counts de-duplicate by activity id so an activity attached to two
 *  accounts in the same group counts once; account counts are unique accounts. */
export function tally(accts: AccountCalc[]): Tally {
  const t: Tally = {
    accounts: accts.length, single_franchise: 0, independent: 0, group: 0, unknown: 0, unique_gds: 0,
    c_active: 0, c_inactive_60: 0, c_inactive_90: 0, c_no_activity: 0, c_needs_review: 0,
    r_active: 0, r_inactive_60: 0, r_inactive_90: 0, r_missing_date: 0, r_needs_review: 0,
    never_contacted: 0, contacts: 0, hubspot_contacts: 0, icp_yes: 0, icp_no: 0, icp_unknown: 0,
    contacted: 0, touch_0: 0, touch_1: 0, touch_2plus: 0,
    calls: 0, connected: 0, emails: 0, meetings: 0, notes: 0, tasks: 0, touchpoints: 0,
    meetings_completed: 0, meetings_canceled: 0, meetings_no_show: 0, meetings_rescheduled: 0, meetings_no_outcome: 0,
    meeting_disposition_calls: 0, demos_booked: 0, demos_completed: 0,
    accounts_with_meeting: 0, accounts_with_demo: 0, accounts_with_demo_completed: 0,
    contacts_touched: 0, contacts_reached: 0, last_touch_ms: null,
  };
  const gds = new Set<string>(); const contacts = new Set<string>();
  const touched = new Set<string>(); const reached = new Set<string>();
  const seenActs = new Set<string>(); const bookedDeals = new Set<string>(); const completedDeals = new Set<string>();
  for (const c of accts) {
    t[c.p.type.type]++;
    if (c.p.type.type === "group" && c.p.gdKey) gds.add(c.p.gdKey);
    t[`c_${c.cStatus}` as "c_active"]++;
    t[`r_${c.rStatus}` as "r_active"]++;
    if (c.neverContacted) t.never_contacted++;
    for (const ct of c.p.contacts) contacts.add(ct.hs_id);
    t.hubspot_contacts += c.p.row.num_contacts ?? 0;
    t[`icp_${c.p.icp}` as "icp_yes"]++;
    if (c.touchpoints > 0) t.contacted++;
    if (c.touchpoints === 0) t.touch_0++; else if (c.touchpoints === 1) t.touch_1++; else t.touch_2plus++;
    if (c.meetings > 0) t.accounts_with_meeting++;
    if (c.demosBooked > 0) t.accounts_with_demo++;
    if (c.demosCompleted > 0) t.accounts_with_demo_completed++;
    c.contactsTouched.forEach((id) => touched.add(id));
    c.contactsReached.forEach((id) => reached.add(id));
    if (c.lastTouchPeriodMs != null && (t.last_touch_ms == null || c.lastTouchPeriodMs > t.last_touch_ms)) t.last_touch_ms = c.lastTouchPeriodMs;
    for (const a of c.periodActs) {
      if (seenActs.has(a.hs_id)) continue;
      seenActs.add(a.hs_id);
      if (a.type === "note") t.notes++;
      if (a.type === "task") t.tasks++;
      if (isCall(a)) { t.calls++; if (isConnected(a.disposition)) t.connected++; if (isMeetingDisposition(a)) t.meeting_disposition_calls++; }
      if (isEmail(a)) t.emails++;
      if (isMeeting(a)) {
        t.meetings++;
        const o = (a.meeting_outcome ?? "").toUpperCase();
        if (o === "COMPLETED") t.meetings_completed++;
        else if (o === "CANCELED") t.meetings_canceled++;
        else if (o === "NO_SHOW") t.meetings_no_show++;
        else if (o === "RESCHEDULED") t.meetings_rescheduled++;
        else if (!o) t.meetings_no_outcome++;
      }
      if (isTouch(a)) t.touchpoints++;
    }
    c.bookedDealIds.forEach((id) => bookedDeals.add(id));
    c.completedDealIds.forEach((id) => completedDeals.add(id));
  }
  t.unique_gds = gds.size; t.contacts = contacts.size;
  t.contacts_touched = touched.size; t.contacts_reached = reached.size;
  t.demos_booked = bookedDeals.size;
  t.demos_completed = completedDeals.size;
  return t;
}

export const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export { isCall, isEmail, isTouch };

// ── list rows ────────────────────────────────────────────────────────────────
export interface AccountListRow {
  id: string; name: string; domain: string | null; country: string; state: string | null; city: string | null;
  owner_id: string | null; owner_name: string; team: string | null;
  activity_owners: string[];
  type: AccountType; type_reason: string | null; gd_name: string | null; gd_id: string | null;
  rooftop_id: string; icp: IcpStatus;
  dealer_type: string | null;      // raw HubSpot Type of Dealership
  potential_rooftops: number | null;
  company_last_activity_ms: number | null; company_days: number | null; company_status: InactivityStatus;
  rooftop_last_activity_ms: number | null; rooftop_days: number | null; rooftop_status: InactivityStatus;
  last_contacted_ms: number | null; never_contacted: boolean;
  last_call_ms: number | null; last_email_ms: number | null; last_meeting_ms: number | null; last_demo_ms: number | null;
  calls: number; connected: number; emails: number; meetings: number; demos_booked: number; demos_completed: number; touchpoints: number;
  contacts: number; hubspot_contacts: number | null;
}

export function toListRow(c: AccountCalc, prep: Prepared): AccountListRow {
  const r = c.p.row;
  return {
    id: r.hs_id, name: r.name?.trim() || `Company ${r.hs_id}`, domain: r.domain, country: c.p.country, state: r.state, city: r.city,
    owner_id: r.owner_id, owner_name: prep.ownerName(r.owner_id), team: r.team,
    activity_owners: [...c.activityOwners].map((id) => prep.ownerName(id)),
    type: c.p.type.type, type_reason: c.p.type.reason, gd_name: c.p.gdName, gd_id: r.gd_id,
    rooftop_id: r.hs_id, icp: c.p.icp,
    dealer_type: r.type_of_dealership, potential_rooftops: r.potential_rooftops ?? null,
    company_last_activity_ms: r.last_activity_ms, company_days: c.cDays, company_status: c.cStatus,
    rooftop_last_activity_ms: r.rooftop_last_activity_ms, rooftop_days: c.rDays, rooftop_status: c.rStatus,
    last_contacted_ms: r.last_contacted_ms, never_contacted: c.neverContacted,
    last_call_ms: c.lastCallMs, last_email_ms: c.lastEmailMs, last_meeting_ms: c.lastMeetingMs, last_demo_ms: c.lastDemoMs,
    calls: c.calls, connected: c.connected, emails: c.emails, meetings: c.meetings,
    demos_booked: c.demosBooked, demos_completed: c.demosCompleted, touchpoints: c.touchpoints,
    contacts: c.p.contacts.length, hubspot_contacts: r.num_contacts,
  };
}

export interface ActivityListRow {
  id: string; type: string; ts_ms: number; direction: string | null; outcome: string | null; subject: string | null;
  owner_id: string | null; owner_name: string; owner_team: string | null;
  company_ids: string[]; company_names: string[]; teams: string[]; contact_ids: string[]; contact_names: string[];
  duration_ms: number | null; meeting_status: string | null; meeting_start_ms: number | null;
  connected: boolean | null; counted_as_touch: boolean; via_contact_only: boolean;
}

export function toActivityRow(a: AoActivityRow, prep: Prepared): ActivityListRow {
  const cos = a.company_ids.map((id) => prep.byId.get(id)).filter(Boolean) as PCompany[];
  return {
    id: a.hs_id, type: a.type, ts_ms: a.ts_ms, direction: a.direction,
    outcome: a.type === "call" ? (a.disposition ? dispositionLabel(a.disposition) : "No disposition") : a.type === "email" ? (a.email_replied ? "Replied" : null) : null,
    subject: a.subject, owner_id: a.owner_id, owner_name: prep.ownerName(a.owner_id),
    owner_team: prep.teamOfOwner(a.owner_id),
    company_ids: cos.map((p) => p.row.hs_id), company_names: cos.map((p) => p.row.name ?? p.row.hs_id),
    teams: [...new Set(cos.map((p) => p.row.team ?? ""))].filter(Boolean),
    contact_ids: a.contact_ids,
    contact_names: a.contact_ids.map((id) => { const c = prep.contactById.get(id); return c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || id : id; }),
    duration_ms: a.duration_ms, meeting_status: a.type === "meeting" ? (a.meeting_outcome ?? "Not recorded") : null,
    meeting_start_ms: a.meeting_start_ms,
    connected: isCall(a) ? isConnected(a.disposition) : null, counted_as_touch: isTouch(a), via_contact_only: a.via_contact_only,
  };
}

export interface ContactListRow {
  id: string; name: string; title: string | null; email: string | null; phone: string | null;
  company_id: string; company_name: string; account_owner: string; contact_owner: string; team: string | null;
  activity_owners: string[]; company_icp: IcpStatus; contact_icp: IcpStatus;
  last_activity_ms: number | null; last_call_ms: number | null; last_email_ms: number | null;
  calls: number; connected: number; emails: number; meetings: number; demos: number; touchpoints: number;
  engagement: "engaged" | "touched" | "not_touched";
}

/** Contacts at the filtered accounts. Activity counts are per contact (in period, filters applied);
 *  Demos = deals on the account that list this contact and were booked in the period. */
export function contactRows(accts: AccountCalc[], prep: Prepared, f: AoFilters): ContactListRow[] {
  const out: ContactListRow[] = [];
  const seen = new Set<string>();
  for (const c of accts) {
    for (const ct of c.p.contacts) {
      if (seen.has(ct.hs_id)) continue; // a contact on two accounts is listed once (first account)
      seen.add(ct.hs_id);
      let calls = 0, connected = 0, emails = 0, meetings = 0, touch = 0, engaged = false;
      let lastCall: number | null = null, lastEmail: number | null = null;
      const owners = new Set<string>();
      for (const a of c.periodActs) {
        if (!a.contact_ids.includes(ct.hs_id)) continue;
        if (a.owner_id) owners.add(a.owner_id);
        if (isCall(a)) { calls++; if (isConnected(a.disposition)) connected++; }
        if (isEmail(a)) emails++;
        if (isMeeting(a)) meetings++;
        if (isTouch(a)) touch++;
        if (isEngaged(a)) engaged = true;
      }
      for (const a of c.p.acts) {
        if (!a.contact_ids.includes(ct.hs_id)) continue;
        if (lastCall == null && isCall(a)) lastCall = a.ts_ms;
        if (lastEmail == null && isEmail(a)) lastEmail = a.ts_ms;
      }
      const demos = f.activityTypes.length ? 0 : c.p.deals.filter((d) => d.demo_booked_ms != null &&
        d.demo_booked_ms >= f.activityFrom && d.demo_booked_ms < f.activityTo).length;
      out.push({
        id: ct.hs_id, name: `${ct.first_name ?? ""} ${ct.last_name ?? ""}`.trim() || `Contact ${ct.hs_id}`,
        title: ct.title, email: ct.email, phone: ct.phone,
        company_id: c.p.row.hs_id, company_name: c.p.row.name ?? c.p.row.hs_id,
        account_owner: prep.ownerName(c.p.row.owner_id), contact_owner: prep.ownerName(ct.owner_id), team: c.p.row.team,
        activity_owners: [...owners].map((id) => prep.ownerName(id)),
        company_icp: c.p.icp, contact_icp: contactIcp(ct.icp),
        last_activity_ms: ct.last_activity_ms, last_call_ms: lastCall, last_email_ms: lastEmail,
        calls, connected, emails, meetings, demos, touchpoints: touch,
        engagement: engaged ? "engaged" : touch > 0 ? "touched" : "not_touched",
      });
    }
  }
  return out;
}
