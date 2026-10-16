/** Accounts Overview — per-tab payload builders over the pure engine (no I/O; unit-tested). */
import { AO_TEAMS } from "../../config/accounts-overview";
import { contactIcp } from "./classify";
import {
  AccountCalc, AccountListRow, ActivityListRow, byActivityOwner, ContactListRow, contactRows, DQ_CHECKS,
  drillMatch, filterAccounts, groupBy, Prepared, rate, Tally, tally, toActivityRow, toListRow,
} from "./compute";
import { AoActivityRow, AoFilters, AoReconRow, IcpStatus } from "./types";

export const AO_VIEWS = ["summary", "teams", "health", "activity", "icp", "meetings", "contacts", "quality", "accounts", "activities"] as const;
export type AoView = (typeof AO_VIEWS)[number];

export interface ListOpts { drill: string; sort: string; dir: "asc" | "desc"; page: number; pageSize: number }

export interface AoMeta {
  synced_at: string | null; sync_status: string; window_start_ms: number | null; error: string | null;
  period: { from: number; to: number };
  accounts_in_scope_all_countries: number; // the four teams, ignoring every filter — the KPI denominator check
  excluded_teams: AoReconRow[];
  options: {
    account_owners: { id: string; name: string }[];      // distinct ACCOUNT owners on the four teams' accounts
    activity_owners: { id: string; name: string; pod: string | null }[]; // distinct ACTIVITY owners in the synced window
    members: { team: string; owner_id: string; name: string }[]; // roster members per team (DB-backed, dynamic)
    countries: { value: string; count: number }[];
  };
}

export interface TeamRow { team: string; label: string; t: Tally }
export interface OwnerRow { owner_id: string; name: string; team: string | null; on_roster: boolean; roster_pod: string | null; pod_matches_team: boolean | null; t: Tally }
export interface IcpRow { key: string; name: string; team?: string | null; total_icp: number; contacted: number; not_contacted: number;
  inactive_60plus: number; inactive_90: number; calls: number; connected: number; emails: number; meetings: number;
  demos_booked: number; demos_completed: number; coverage: number | null; contact_coverage: number | null;
  contacts_at_icp: number; contacts_touched: number; meeting_rate: number | null; demo_rate: number | null }

const teamLabel = (v: string | null) => AO_TEAMS.find((t) => t.value === v)?.label ?? v ?? "—";

function sortRows<T>(rows: T[], key: string, dir: "asc" | "desc"): T[] {
  const m = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = (a as Record<string, unknown>)[key]; const bv = (b as Record<string, unknown>)[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // nulls last regardless of direction
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * m;
    return String(av).localeCompare(String(bv)) * m;
  });
}

function page<T>(rows: T[], o: ListOpts) {
  const size = Math.min(Math.max(o.pageSize, 10), 500);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(o.page, 1), pages);
  return { total: rows.length, page: p, pages, page_size: size, rows: rows.slice((p - 1) * size, p * size) };
}

function ownerRows(prep: Prepared, groups: Map<string, AccountCalc[]>, teamOf: (k: string) => string | null, ownerOf: (k: string) => string): OwnerRow[] {
  const rows: OwnerRow[] = [];
  for (const [k, list] of groups) {
    const ownerId = ownerOf(k);
    const team = teamOf(k);
    const r = prep.rosterById.get(ownerId);
    const pod = r?.podKey ?? null;
    rows.push({
      owner_id: ownerId, name: prep.ownerName(ownerId), team, on_roster: !!r, roster_pod: pod,
      pod_matches_team: pod == null || team == null ? null : prep.podToTeam.get(pod) === team, t: tally(list),
    });
  }
  return rows.sort((a, b) => b.t.accounts - a.t.accounts || b.t.touchpoints - a.t.touchpoints);
}

function icpRow(key: string, name: string, list: AccountCalc[], team?: string | null): IcpRow {
  const icp = list.filter((c) => c.p.icp === "yes");
  const t = tally(icp);
  const contactsAt = new Set<string>();
  for (const c of icp) for (const ct of c.p.contacts) contactsAt.add(ct.hs_id);
  // Contact coverage = associated contacts at ICP accounts that were touched ÷ all of them.
  let touchedAt = 0;
  const touched = new Set<string>();
  for (const c of icp) c.contactsTouched.forEach((id) => touched.add(id));
  for (const id of contactsAt) if (touched.has(id)) touchedAt++;
  return {
    key, name, team, total_icp: icp.length, contacted: t.contacted, not_contacted: icp.length - t.contacted,
    inactive_60plus: t.c_inactive_60 + t.c_inactive_90, inactive_90: t.c_inactive_90,
    calls: t.calls, connected: t.connected, emails: t.emails, meetings: t.meetings,
    demos_booked: t.demos_booked, demos_completed: t.demos_completed,
    coverage: rate(t.contacted, icp.length),
    contacts_at_icp: contactsAt.size, contacts_touched: touchedAt,
    contact_coverage: rate(touchedAt, contactsAt.size),
    meeting_rate: rate(t.accounts_with_meeting, t.contacted), demo_rate: rate(t.accounts_with_demo, t.contacted),
  };
}

function teamRows(accts: AccountCalc[], f: AoFilters): TeamRow[] {
  const by = groupBy(accts, (c) => c.p.row.team);
  const teams = f.teams.length ? AO_TEAMS.filter((t) => f.teams.includes(t.value)) : AO_TEAMS;
  return teams.map((t) => ({ team: t.value, label: t.label, t: tally(by.get(t.value) ?? []) }));
}

/** Distinct activities across the account set (an activity on two accounts is listed once). */
function distinctActs(accts: AccountCalc[]): AoActivityRow[] {
  const m = new Map<string, AoActivityRow>();
  for (const c of accts) for (const a of c.periodActs) m.set(a.hs_id, a);
  return [...m.values()];
}

const optCache = new WeakMap<Prepared, AoMeta["options"]>();
function options(prep: Prepared): AoMeta["options"] {
  const hit = optCache.get(prep);
  if (hit) return hit;
  const inScope = prep.companies.filter((p) => AO_TEAMS.some((t) => t.value === p.row.team));
  const owners = new Set<string>(); const actOwners = new Set<string>(); const countries = new Map<string, number>();
  for (const p of inScope) {
    if (p.row.owner_id) owners.add(p.row.owner_id);
    for (const a of p.acts) if (a.owner_id) actOwners.add(a.owner_id);
    countries.set(p.country, (countries.get(p.country) ?? 0) + 1);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const out: AoMeta["options"] = {
    account_owners: [...owners].map((id) => ({ id, name: prep.ownerName(id) })).sort(byName),
    activity_owners: [...actOwners].map((id) => ({ id, name: prep.ownerName(id), pod: prep.rosterById.get(id)?.podKey ?? null })).sort(byName),
    members: AO_TEAMS.flatMap((t) => prep.data.roster.filter((r) => r.active && r.podKey === t.podKey)
      .map((r) => ({ team: t.value, owner_id: r.ownerId, name: r.name }))),
    countries: [...countries].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
  };
  optCache.set(prep, out);
  return out;
}

export function computeView(prep: Prepared, f: AoFilters, view: AoView, o: ListOpts, nowMs: number) {
  const accts = filterAccounts(prep, f, nowMs);
  const state = prep.data.state;
  const meta: AoMeta = {
    synced_at: state.finished_at, sync_status: state.status, window_start_ms: state.window_start_ms, error: state.error,
    period: { from: f.activityFrom, to: f.activityTo },
    accounts_in_scope_all_countries: prep.companies.filter((p) => AO_TEAMS.some((t) => t.value === p.row.team)).length,
    excluded_teams: (state.reconciliation ?? []).filter((r) => r.check === "excluded_team"),
    options: options(prep),
  };

  switch (view) {
    case "summary": {
      return { meta, total: tally(accts), teams: teamRows(accts, f) };
    }
    case "teams": {
      const byOwner = groupBy(accts, (c) => `${c.p.row.team}|${c.p.row.owner_id ?? ""}`);
      const actOwners = new Map<string, AccountCalc[]>();
      for (const [owner, list] of byActivityOwner(accts)) {
        // activity-owner rows split by the ACCOUNT's assigned team
        for (const [team, l] of groupBy(list, (c) => c.p.row.team)) actOwners.set(`${team}|${owner}`, l);
      }
      return {
        meta, total: tally(accts), teams: teamRows(accts, f),
        account_owners: ownerRows(prep, byOwner, (k) => k.split("|")[0] || null, (k) => k.split("|")[1]),
        activity_owners: ownerRows(prep, actOwners, (k) => k.split("|")[0] || null, (k) => k.split("|")[1]),
        roster: AO_TEAMS.map((t) => ({
          team: t.value, label: t.label, pod_key: t.podKey,
          members: prep.data.roster.filter((r) => r.active && r.podKey === t.podKey)
            .map((r) => ({ owner_id: r.ownerId, name: r.name, kind: r.kind })),
        })),
      };
    }
    case "health": {
      const buckets = (days: (c: AccountCalc) => number | null, hasDate: (c: AccountCalc) => boolean) => {
        const edges: [string, number, number][] = [["0–29", 0, 30], ["30–59", 30, 60], ["60–89", 60, 90], ["90–179", 90, 180], ["180–364", 180, 365], ["365+", 365, Infinity]];
        const out = edges.map(([label]) => ({ label, count: 0 }));
        let none = 0, future = 0;
        for (const c of accts) {
          const d = days(c);
          if (!hasDate(c) || d == null) { none++; continue; }
          if (d < 0) { future++; continue; }
          const i = edges.findIndex(([, lo, hi]) => d >= lo && d < hi);
          out[i].count++;
        }
        return { buckets: out, no_date: none, future };
      };
      const cross: Record<string, Record<string, number>> = {};
      for (const c of accts) { cross[c.cStatus] ??= {}; cross[c.cStatus][c.rStatus] = (cross[c.cStatus][c.rStatus] ?? 0) + 1; }
      return {
        meta, total: tally(accts), teams: teamRows(accts, f),
        company_days: buckets((c) => c.cDays, (c) => c.p.row.last_activity_ms != null),
        rooftop_days: buckets((c) => c.rDays, (c) => c.p.row.rooftop_last_activity_ms != null),
        cross,
      };
    }
    case "activity": {
      const owners = ownerRows(prep, byActivityOwner(accts), () => null, (k) => k);
      for (const r of owners) {
        const pod = r.roster_pod;
        r.team = pod ? prep.podToTeam.get(pod) ?? null : null; // the owner's ROSTER pod — never the account team
      }
      return { meta, total: tally(accts), teams: teamRows(accts, f), activity_owners: owners };
    }
    case "icp": {
      const byTeam = groupBy(accts, (c) => c.p.row.team);
      const teams = (f.teams.length ? AO_TEAMS.filter((t) => f.teams.includes(t.value)) : AO_TEAMS)
        .map((t) => icpRow(t.value, t.label, byTeam.get(t.value) ?? []));
      const byOwner = groupBy(accts, (c) => `${c.p.row.team}|${c.p.row.owner_id ?? ""}`);
      const owners = [...byOwner].map(([k, l]) => {
        const [team, id] = k.split("|");
        return icpRow(k, prep.ownerName(id), l, team);
      }).filter((r) => r.total_icp > 0).sort((a, b) => b.total_icp - a.total_icp);
      const actOwners = [...byActivityOwner(accts)].map(([id, l]) => {
        const icp = l.filter((c) => c.p.icp === "yes");
        const t = tally(icp);
        return { owner_id: id, name: prep.ownerName(id), icp_accounts_touched: t.contacted, calls: t.calls, connected: t.connected, emails: t.emails, meetings: t.meetings, contacts_touched: t.contacts_touched };
      }).filter((r) => r.icp_accounts_touched > 0).sort((a, b) => b.icp_accounts_touched - a.icp_accounts_touched);
      // contact-level ICP is its own property — cross-tabbed against company ICP, never merged
      const cross: Record<IcpStatus, Record<IcpStatus, number>> = { yes: { yes: 0, no: 0, unknown: 0 }, no: { yes: 0, no: 0, unknown: 0 }, unknown: { yes: 0, no: 0, unknown: 0 } };
      const seen = new Set<string>();
      for (const c of accts) for (const ct of c.p.contacts) {
        if (seen.has(ct.hs_id)) continue; seen.add(ct.hs_id);
        cross[c.p.icp][contactIcp(ct.icp)]++;
      }
      return { meta, all: icpRow("all", "All selected teams", accts), teams, account_owners: owners, activity_owners: actOwners, contact_icp_cross: cross };
    }
    case "meetings": {
      const total = tally(accts);
      const icp = tally(accts.filter((c) => c.p.icp === "yes"));
      const split = (keyOf: (c: AccountCalc) => string | null, label: (k: string) => string) =>
        [...groupBy(accts, keyOf)].map(([k, l]) => ({ key: k, label: label(k), t: tally(l) }));
      // Demo credit follows the existing convention: SDR via sdr_owner, AE via hubspot_owner_id.
      const demoCredit = (field: "sdr_owner_id" | "deal_owner_id") => {
        const m = new Map<string, { booked: Set<string>; completed: Set<string> }>();
        const booked = new Set(accts.flatMap((c) => c.bookedDealIds));
        const done = new Set(accts.flatMap((c) => c.completedDealIds));
        for (const d of prep.data.deals) {
          const owner = d[field];
          if (!owner || (!booked.has(d.hs_id) && !done.has(d.hs_id))) continue;
          const e = m.get(owner) ?? { booked: new Set(), completed: new Set() };
          if (booked.has(d.hs_id)) e.booked.add(d.hs_id);
          if (done.has(d.hs_id)) e.completed.add(d.hs_id);
          m.set(owner, e);
        }
        return [...m].map(([id, e]) => ({ owner_id: id, name: prep.ownerName(id), booked: e.booked.size, completed: e.completed.size }))
          .sort((a, b) => b.booked - a.booked);
      };
      return {
        meta, total, icp,
        rates: {
          meeting_booking: rate(total.accounts_with_meeting, total.contacted),
          demo_booking: rate(total.accounts_with_demo, total.contacted),
          icp_meeting_booking: rate(icp.accounts_with_meeting, icp.contacted),
          icp_demo_booking: rate(icp.accounts_with_demo, icp.contacted),
        },
        icp_contacted_no_meeting: accts.filter((c) => c.p.icp === "yes" && c.touchpoints > 0 && c.meetings === 0).length,
        icp_contacted_no_demo: accts.filter((c) => c.p.icp === "yes" && c.touchpoints > 0 && c.demosBooked === 0).length,
        icp_not_contacted: accts.filter((c) => c.p.icp === "yes" && c.touchpoints === 0).length,
        by_team: teamRows(accts, f),
        by_type: split((c) => c.p.type.type, (k) => k),
        by_icp: split((c) => c.p.icp, (k) => k),
        by_activity_owner: ownerRows(prep, byActivityOwner(accts), () => null, (k) => k).filter((r) => r.t.meetings > 0 || r.t.meeting_disposition_calls > 0),
        demos_by_sdr: demoCredit("sdr_owner_id"),
        demos_by_ae: demoCredit("deal_owner_id"),
      };
    }
    case "quality": {
      // Quality is measured with the country filter lifted — missing country is itself a finding.
      const all = filterAccounts(prep, { ...f, country: "all" }, nowMs);
      const checks = DQ_CHECKS.map((c) => ({ ...c, count: all.filter((a) => drillMatch(a, `dq:${c.key}`, prep)).length }));
      const reasons = new Map<string, number>();
      for (const a of all) if (a.p.type.type === "unknown") reasons.set(a.p.type.reason ?? "?", (reasons.get(a.p.type.reason ?? "?") ?? 0) + 1);
      const contacts = new Map<string, string | null>();
      for (const a of all) for (const ct of a.p.contacts) contacts.set(ct.hs_id, ct.icp);
      const meetings = distinctActs(all).filter((a) => a.type === "meeting");
      const owners = state.owners ?? {};
      return {
        meta, checks,
        unknown_type_reasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
        contact_icp_unset: [...contacts.values()].filter((v) => contactIcp(v) === "unknown").length,
        contacts_total: contacts.size,
        meetings_total: meetings.length,
        meetings_no_outcome: meetings.filter((a) => !a.meeting_outcome).length,
        roster_not_in_hubspot: Object.keys(owners).length === 0 ? null : prep.data.roster
          .filter((r) => r.active && !owners[r.ownerId]).map((r) => ({ owner_id: r.ownerId, name: r.name, pod: r.podKey })),
        reconciliation: state.reconciliation ?? [],
        sync_counts: state.counts ?? {},
      };
    }
    case "accounts": {
      const rows = sortRows(accts.filter((c) => drillMatch(c, o.drill, prep)).map((c) => toListRow(c, prep)), o.sort || "name", o.dir);
      return { meta, list: page<AccountListRow>(rows, o) };
    }
    case "contacts": {
      const rows = sortRows(contactRows(accts.filter((c) => drillMatch(c, o.drill, prep)), prep, f), o.sort || "name", o.dir);
      const eng = { engaged: 0, touched: 0, not_touched: 0 };
      for (const r of rows) eng[r.engagement]++;
      return { meta, engagement: eng, list: page<ContactListRow>(rows, o) };
    }
    case "activities": {
      const scoped = accts.filter((c) => drillMatch(c, o.drill, prep));
      const rows = distinctActs(scoped).sort((a, b) => b.ts_ms - a.ts_ms).map((a) => toActivityRow(a, prep));
      return { meta, list: page<ActivityListRow>(rows, o) };
    }
  }
}

/** Full (unpaged) rows for CSV export. */
export function exportRows(prep: Prepared, f: AoFilters, view: "accounts" | "contacts" | "activities", drill: string, nowMs: number) {
  const accts = filterAccounts(prep, f, nowMs).filter((c) => drillMatch(c, drill, prep));
  if (view === "accounts") return accts.map((c) => toListRow(c, prep));
  if (view === "contacts") return contactRows(accts, prep, f);
  return distinctActs(accts).sort((a, b) => b.ts_ms - a.ts_ms).map((a) => toActivityRow(a, prep));
}

export { teamLabel };
