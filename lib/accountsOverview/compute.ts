/**
 * Accounts Overview — the pure metrics engine (no I/O; unit-tested). The API route loads the
 * sdr_ao_* rows once (cached), `prepare()`s indexes, then every filter change is one
 * `computeView()` call in memory — HubSpot is never re-read on a filter change.
 *
 * Counting rules (the metric → source map lives in docs/accounts-overview.md):
 *  - Calls = OUTBOUND calls; Connected = isConnected(disposition) — the dashboard's validated
 *    11-GUID rule (config/dispositions.ts); Emails = outgoing (hs_email_direction = EMAIL);
 *    Meetings = HubSpot meeting records. Touchpoints = calls + emails + meetings.
 *    Notes/tasks appear in timelines but are NOT touchpoints.
 *  - An activity is counted ONCE per account even when it reaches the account both directly
 *    and through a contact; team/rep totals de-duplicate by activity id.
 *  - Demos come from Auto-Pipeline deals via the existing demoScheduledMs/demoCompletedMs
 *    (booked = entered Discovery Call Done; completed = first Demo Done/Accepted/In Discussion).
 *  - Account Owner, Assigned Team, Activity Owner and Contact Owner are never interchanged.
 */
import { isConnected, MEETING_SCHEDULED_GUID, MEETING_RESCHEDULED_GUID, dispositionLabel } from "../../config/dispositions";
import { AO_TEAMS } from "../../config/accounts-overview";
import {
  classifyAccountType, companyIcp, companyStatus, contactIcp, daysSince, gdKeyOf, gdNameOf,
  isNonStandardGdFlag, normalizeCountry, rooftopStatus, TypeVerdict,
} from "./classify";
import {
  AccountType, AoActivityRow, AoCompanyRow, AoContactRow, AoDealRow, AoFilters, AoSyncState,
  DateRange, IcpStatus, InactivityStatus,
} from "./types";

export interface RosterRef { ownerId: string; name: string; podKey: string | null; kind: "sdr" | "ae"; active: boolean }

export interface AoData {
  companies: AoCompanyRow[];
  contacts: AoContactRow[];
  activities: AoActivityRow[];
  deals: AoDealRow[];
  state: AoSyncState;
  roster: RosterRef[];
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
  rosterById: Map<string, RosterRef>;
  podToTeam: Map<string, string>;
}

const isCall = (a: AoActivityRow) => a.type === "call" && (a.direction ?? "").toUpperCase() === "OUTBOUND";
const isEmail = (a: AoActivityRow) => a.type === "email" && (a.direction ?? "").toUpperCase() === "EMAIL";
const isMeeting = (a: AoActivityRow) => a.type === "meeting";
export const isTouch = (a: AoActivityRow) => isCall(a) || isEmail(a) || isMeeting(a);
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
    const firstTouch = acts.find(isTouch);
    return {
      row, type: classifyAccountType(row), country: normalizeCountry(row.country), icp: companyIcp(row.icp),
      gdKey: gdKeyOf(row), gdName: gdNameOf(row),
      contacts: contactsByCo.get(row.hs_id) ?? [], acts, deals: dealsByCo.get(row.hs_id) ?? [],
      hasWindowTouch: !!firstTouch, lastTouchWindowMs: firstTouch?.ts_ms ?? null,
    };
  });
  const rosterById = new Map(data.roster.map((r) => [r.ownerId, r]));
  const owners = data.state.owners ?? {};
  const ownerName = (id: string | null | undefined) => {
    if (!id) return "—";
    return owners[id]?.name || rosterById.get(id)?.name || `Owner ${id}`;
  };
  const podToTeam = new Map<string, string>(AO_TEAMS.map((t) => [t.podKey, t.value]));
  return { data, companies, byId: new Map(companies.map((c) => [c.row.hs_id, c])), contactById, ownerName, rosterById, podToTeam };
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
  periodActs: AoActivityRow[];   // activities in period after type/member filters
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

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

function contactMatches(c: AoContactRow, q: string): boolean {
  const needle = q.toLowerCase();
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase();
  if (name.includes(needle) || (c.email ?? "").toLowerCase().includes(needle) || c.hs_id === q.trim()) return true;
  const d = digits(q);
  return d.length >= 4 && digits(c.phone).includes(d);
}

export function calcAccount(prep: Prepared, p: PCompany, f: AoFilters, nowMs: number): AccountCalc {
  const typeSet = f.activityTypes.length ? new Set(f.activityTypes) : null;
  const periodActs = p.acts.filter((a) =>
    a.ts_ms >= f.activityFrom && a.ts_ms < f.activityTo &&
    (!typeSet || typeSet.has(a.type)) && (!f.member || a.owner_id === f.member));
  const c: AccountCalc = {
    p,
    cStatus: companyStatus(p.row, nowMs, f.inactiveDays, f.deepInactiveDays),
    rStatus: rooftopStatus(p.row.rooftop_last_activity_ms, nowMs, f.inactiveDays, f.deepInactiveDays),
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
  // Demos are deal events, not activities — the member filter does not apply; the type filter
  // only hides them when the user filtered to specific activity types.
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
  const cq = f.contactQ.trim();
  const out: AccountCalc[] = [];
  for (const p of prep.companies) {
    const r = p.row;
    if (!r.team || !teams.has(r.team)) continue;
    if (f.country !== "all" && p.country !== f.country) continue;
    if (f.accountType !== "all" && p.type.type !== f.accountType) continue;
    if (f.icp !== "all" && p.icp !== f.icp) continue;
    if (f.owner && r.owner_id !== f.owner) continue;
    if (q && !((r.name ?? "").toLowerCase().includes(q) || (r.domain ?? "").toLowerCase().includes(q) || r.hs_id === q)) continue;
    if (cq && !p.contacts.some((c) => contactMatches(c, cq))) continue;
    if (!inRange(r.last_activity_ms, f.companyDate)) continue;
    if (!inRange(r.rooftop_last_activity_ms, f.rooftopDate)) continue;
    const calc = calcAccount(prep, p, f, nowMs);
    // The team-member (activity owner) filter narrows to accounts that member worked in the period.
    if (f.member && calc.periodActs.length === 0) continue;
    out.push(calc);
  }
  return out;
}

// ── drill-down predicates (KPI click → filtered account list) ────────────────
export function drillMatch(c: AccountCalc, key: string, prep: Prepared): boolean {
  if (!key) return true;
  const [k, v] = key.split(":");
  const icpYes = c.p.icp === "yes";
  switch (k) {
    case "type": return c.p.type.type === v;
    case "unknown_reason": return c.p.type.type === "unknown" && c.p.type.reason === decodeURIComponent(v);
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
    case "gd": return c.p.gdKey === decodeURIComponent(v);
    case "dq": return dqMatch(c, v, prep);
    default: return true;
  }
}

// ── data-quality checks (each is a predicate so its count and its drill list agree) ──
export const DQ_CHECKS: { key: string; label: string; detail: string }[] = [
  { key: "nonstandard_gd_flag", label: "Non-standard GD flag value", detail: "GD flag holds the label text (e.g. \"Yes\") instead of the option value true/false." },
  { key: "missing_country", label: "Country missing", detail: "Excluded by the default USA country filter — set Country to All to see them." },
  { key: "no_company_date", label: "No company Last Activity Date", detail: "HubSpot has never logged an activity on the company record." },
  { key: "no_rooftop_date", label: "Rooftop Last Activity missing", detail: "Custom property empty — treated as unknown, not as never contacted." },
  { key: "company_needs_review", label: "Company date needs review", detail: "Future-dated, or Last Contacted set while Last Activity Date is empty." },
  { key: "rooftop_needs_review", label: "Rooftop date needs review", detail: "Rooftop Last Activity is in the future." },
  { key: "icp_unset", label: "Company ICP not set", detail: "`icp` is empty — counted as ICP Unknown, never assumed." },
  { key: "contacted_conflict", label: "Last Contacted empty but a touch exists", detail: "HubSpot Last Contacted is empty, yet a call/email/meeting is associated in the synced window." },
  { key: "activity_after_last_activity", label: "Logged activity newer than Last Activity Date", detail: "A synced activity is >1 day newer than the company's Last Activity Date (HubSpot rollup lag or association-only activity)." },
  { key: "owner_not_on_roster", label: "Account owner not a tracked rep", detail: "Account owner is not in the TrackerAI roster (e.g. the salesops placeholder user)." },
  { key: "owner_pod_mismatch", label: "Account owner's roster pod ≠ assigned team", detail: "The owner's AE pod in the roster differs from the company's Team Accounts value." },
  { key: "duplicate_domain", label: "Domain shared with another account", detail: "Possible duplicate rooftop or GD HQ record — not merged automatically." },
  { key: "contact_count_mismatch", label: "Contact count ≠ HubSpot", detail: "Synced contact associations differ from HubSpot's num_associated_contacts." },
];

function dqMatch(c: AccountCalc, key: string, prep: Prepared): boolean {
  const r = c.p.row;
  switch (key) {
    case "nonstandard_gd_flag": return isNonStandardGdFlag(r.is_group);
    case "missing_country": return c.p.country === "Unknown";
    case "no_company_date": return r.last_activity_ms == null;
    case "no_rooftop_date": return r.rooftop_last_activity_ms == null;
    case "company_needs_review": return c.cStatus === "needs_review";
    case "rooftop_needs_review": return c.rStatus === "needs_review";
    case "icp_unset": return c.p.icp === "unknown";
    case "contacted_conflict": return c.contactedConflict;
    case "activity_after_last_activity": {
      const newest = c.p.acts[0]?.ts_ms;
      return newest != null && (r.last_activity_ms == null || newest > r.last_activity_ms + 86_400_000);
    }
    case "owner_not_on_roster": return !!r.owner_id && !prep.rosterById.has(r.owner_id);
    case "owner_pod_mismatch": {
      const pod = r.owner_id ? prep.rosterById.get(r.owner_id)?.podKey : null;
      return !!pod && prep.podToTeam.get(pod) !== r.team;
    }
    case "duplicate_domain": return dupDomains(prep).has(normDomain(r.domain) ?? "\u0000");
    case "contact_count_mismatch": return r.num_contacts != null && r.num_contacts !== c.p.contacts.length;
    default: return false;
  }
}

const normDomain = (d: string | null) => {
  const s = (d ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return s || null;
};
const dupCache = new WeakMap<Prepared, Set<string>>();
function dupDomains(prep: Prepared): Set<string> {
  let s = dupCache.get(prep);
  if (s) return s;
  const seen = new Map<string, number>();
  for (const p of prep.companies) { const d = normDomain(p.row.domain); if (d) seen.set(d, (seen.get(d) ?? 0) + 1); }
  s = new Set([...seen].filter(([, n]) => n > 1).map(([d]) => d));
  dupCache.set(prep, s);
  return s;
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

// ── list rows ────────────────────────────────────────────────────────────────
export interface AccountListRow {
  id: string; name: string; domain: string | null; country: string; state: string | null; city: string | null;
  owner_id: string | null; owner_name: string; team: string | null;
  activity_owners: string[];
  type: AccountType; type_reason: string | null; gd_name: string | null; gd_id: string | null;
  rooftop_id: string; icp: IcpStatus;
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
  owner_id: string | null; owner_name: string; owner_pod: string | null;
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
    owner_pod: a.owner_id ? prep.rosterById.get(a.owner_id)?.podKey ?? null : null,
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
  const cq = f.contactQ.trim();
  for (const c of accts) {
    for (const ct of c.p.contacts) {
      if (seen.has(ct.hs_id)) continue; // a contact on two accounts is listed once (first account)
      if (cq && !contactMatches(ct, cq)) continue;
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

// ── breakdowns ──────────────────────────────────────────────────────────────
export function groupBy<K>(accts: AccountCalc[], keyOf: (c: AccountCalc) => K | K[] | null): Map<K, AccountCalc[]> {
  const m = new Map<K, AccountCalc[]>();
  for (const c of accts) {
    const k = keyOf(c);
    if (k == null) continue;
    for (const key of Array.isArray(k) ? k : [k]) { const l = m.get(key) ?? []; l.push(c); m.set(key, l); }
  }
  return m;
}

/** Activity-owner view: for each owner, only THEIR activities on the accounts (accounts re-scoped
 *  per owner), so one account worked by two reps contributes each rep's own work. */
export function byActivityOwner(accts: AccountCalc[]): Map<string, AccountCalc[]> {
  const m = new Map<string, AccountCalc[]>();
  for (const c of accts) {
    const byOwner = new Map<string, AoActivityRow[]>();
    for (const a of c.periodActs) {
      if (!a.owner_id) continue;
      const l = byOwner.get(a.owner_id) ?? []; l.push(a); byOwner.set(a.owner_id, l);
    }
    for (const [owner, acts] of byOwner) {
      const scoped = rescope(c, acts);
      const l = m.get(owner) ?? []; l.push(scoped); m.set(owner, l);
    }
  }
  return m;
}

function rescope(c: AccountCalc, acts: AoActivityRow[]): AccountCalc {
  const s: AccountCalc = {
    ...c, periodActs: acts, calls: 0, connected: 0, emails: 0, meetings: 0, notes: 0, tasks: 0,
    meetingsCompleted: 0, meetingsCanceled: 0, meetingsNoShow: 0, meetingsRescheduled: 0, meetingsNoOutcome: 0,
    meetingDispositionCalls: 0, touchpoints: 0, demosBooked: 0, demosCompleted: 0,
    bookedDealIds: [], completedDealIds: [], // demos are credited by deal owner, never by activity owner
    contactsTouched: new Set(), contactsReached: new Set(), activityOwners: new Set([acts[0]?.owner_id ?? ""]), lastTouchPeriodMs: null,
  };
  for (const a of acts) {
    if (a.type === "note") s.notes++;
    else if (a.type === "task") s.tasks++;
    if (isCall(a)) { s.calls++; if (isConnected(a.disposition)) s.connected++; if (isMeetingDisposition(a)) s.meetingDispositionCalls++; }
    if (isEmail(a)) s.emails++;
    if (isMeeting(a)) s.meetings++;
    if (isTouch(a)) {
      s.touchpoints++;
      if (s.lastTouchPeriodMs == null || a.ts_ms > s.lastTouchPeriodMs) s.lastTouchPeriodMs = a.ts_ms;
      for (const id of a.contact_ids) s.contactsTouched.add(id);
      if (isEngaged(a)) for (const id of a.contact_ids) s.contactsReached.add(id);
    }
  }
  return s;
}
