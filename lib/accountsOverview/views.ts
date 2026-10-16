/** Accounts Overview — the two tab payloads over the pure engine (no I/O; unit-tested).
 *  "accounts": the 8 count cards + a paged, sortable account list (cards drill the list).
 *  "pipeline": demos + deal pipeline, ICP contacted vs not, and a per-team-member table. */
import { AO_TEAMS } from "../../config/accounts-overview";
import { DealStageKey, stageLabel, stageOrder } from "../../config/deal-stages";
import {
  AccountListRow, drillMatch, filterAccounts, Prepared, rate, tally, toListRow,
} from "./compute";
import { AoActivityRow, AoFilters } from "./types";

export const AO_VIEWS = ["accounts", "pipeline"] as const;
export type AoView = (typeof AO_VIEWS)[number];

export interface ListOpts { drill: string; sort: string; dir: "asc" | "desc"; page: number; pageSize: number }

export interface AoMeta {
  synced_at: string | null; sync_status: string; window_start_ms: number | null; error: string | null;
  period: { from: number; to: number };
  options: {
    account_owners: { id: string; name: string }[];
    members: { team: string; owner_id: string; name: string }[];      // roster members per team (DB-backed)
    activity_owners: { id: string; name: string }[];                  // anyone who logged activity on these accounts
    gd_names: { value: string; count: number }[];
    countries: { value: string; count: number }[];
    states: { value: string; count: number }[];
  };
}

const isCall = (a: AoActivityRow) => a.type === "call" && (a.direction ?? "").toUpperCase() === "OUTBOUND";
const isEmail = (a: AoActivityRow) => a.type === "email" && (a.direction ?? "").toUpperCase() === "EMAIL";

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

const countBy = (vals: string[]) => {
  const m = new Map<string, number>();
  for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, count]) => ({ value, count }));
};

const optCache = new WeakMap<Prepared, AoMeta["options"]>();
function options(prep: Prepared): AoMeta["options"] {
  const hit = optCache.get(prep);
  if (hit) return hit;
  const inScope = prep.companies.filter((p) => AO_TEAMS.some((t) => t.value === p.row.team));
  const owners = new Set<string>(); const actOwners = new Set<string>();
  for (const p of inScope) {
    if (p.row.owner_id) owners.add(p.row.owner_id);
    for (const a of p.acts) if (a.owner_id) actOwners.add(a.owner_id);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const byValue = (a: { value: string }, b: { value: string }) => a.value.localeCompare(b.value);
  const out: AoMeta["options"] = {
    account_owners: [...owners].map((id) => ({ id, name: prep.ownerName(id) })).sort(byName),
    members: AO_TEAMS.flatMap((t) => prep.data.roster.filter((r) => r.active && r.podKey === t.podKey)
      .map((r) => ({ team: t.value, owner_id: r.ownerId, name: r.name }))),
    activity_owners: [...actOwners].map((id) => ({ id, name: prep.ownerName(id) })).sort(byName),
    gd_names: countBy(inScope.map((p) => p.gdName ?? "").filter(Boolean)).sort(byValue),
    countries: countBy(inScope.map((p) => p.country)).sort((a, b) => b.count - a.count),
    states: countBy(inScope.map((p) => p.row.state?.trim() ?? "").filter(Boolean)).sort(byValue),
  };
  optCache.set(prep, out);
  return out;
}

/** The 8 cards on the Accounts tab — each is also a drill key for the list below it. */
export const ACCOUNT_CARDS = [
  { key: "", label: "Total accounts" },
  { key: "type:single_franchise", label: "Single Franchise" },
  { key: "type:independent", label: "Single Independent" },
  { key: "type:group", label: "Group Dealership" },
  { key: "cstatus:active", label: "Worked in last 60 days" },
  { key: "cstatus:inactive_60plus", label: "Not touched in 60+ days" },
  { key: "never_contacted", label: "Never contacted" },
  { key: "cstatus:no_activity", label: "No recorded activity" },
] as const;

export function computeView(prep: Prepared, f: AoFilters, view: AoView, o: ListOpts, nowMs: number) {
  const accts = filterAccounts(prep, f, nowMs);
  const state = prep.data.state;
  const meta: AoMeta = {
    synced_at: state.finished_at, sync_status: state.status, window_start_ms: state.window_start_ms, error: state.error,
    period: { from: f.activityFrom, to: f.activityTo },
    options: options(prep),
  };

  if (view === "accounts") {
    const t = tally(accts);
    const cards = ACCOUNT_CARDS.map((c) => ({ ...c, count: accts.filter((a) => drillMatch(a, c.key)).length }));
    const rows = sortRows(accts.filter((c) => drillMatch(c, o.drill)).map((c) => toListRow(c, prep)), o.sort || "name", o.dir);
    return { meta, cards, unique_gds: t.unique_gds, unknown_type: t.unknown, list: page<AccountListRow>(rows, o) };
  }

  // ── pipeline ──
  const t = tally(accts);
  // Deals whose demo was booked in the period, by their CURRENT stage (de-duplicated by deal id).
  const booked = new Set(accts.flatMap((c) => c.bookedDealIds));
  const stageCount = new Map<string, number>();
  for (const d of prep.data.deals) if (booked.has(d.hs_id)) stageCount.set(d.stage_key, (stageCount.get(d.stage_key) ?? 0) + 1);
  const stages = [...stageCount].map(([key, count]) => ({ key, label: stageLabel(key as DealStageKey), count }))
    .sort((a, b) => stageOrder(a.key as DealStageKey) - stageOrder(b.key as DealStageKey));

  // ICP: contacted (≥1 touch in the period) vs not, and how many got a demo.
  const icpSplit = (["yes", "no", "unknown"] as const).map((k) => {
    const list = accts.filter((c) => c.p.icp === k);
    const contacted = list.filter((c) => c.touchpoints > 0).length;
    return {
      icp: k, accounts: list.length, contacted, not_contacted: list.length - contacted,
      demo_booked: list.filter((c) => c.demosBooked > 0).length,
      contacted_no_demo: list.filter((c) => c.touchpoints > 0 && c.demosBooked === 0).length,
    };
  });

  // Per team member: accounts they OWN (in the filtered set) and the calls/emails THEY made.
  const owned = new Map<string, number>();
  for (const c of accts) if (c.p.row.owner_id) owned.set(c.p.row.owner_id, (owned.get(c.p.row.owner_id) ?? 0) + 1);
  const work = new Map<string, { calls: number; emails: number; accounts: Set<string> }>();
  for (const c of accts) for (const a of c.periodActs) {
    if (!a.owner_id || !(isCall(a) || isEmail(a))) continue;
    const w = work.get(a.owner_id) ?? { calls: 0, emails: 0, accounts: new Set<string>() };
    if (isCall(a)) w.calls++; else w.emails++;
    w.accounts.add(c.p.row.hs_id);
    work.set(a.owner_id, w);
  }
  const teamSet = new Set(f.teams.length ? f.teams : AO_TEAMS.map((x) => x.value));
  const podTeam = new Map<string, string>(AO_TEAMS.map((x) => [x.podKey, x.value]));
  const rosterIds = prep.data.roster
    .filter((r) => r.active && r.podKey && teamSet.has(podTeam.get(r.podKey) ?? ""))
    .map((r) => r.ownerId);
  const ids = new Set<string>([...rosterIds, ...work.keys()]);
  if (f.member) for (const id of [...ids]) if (id !== f.member) ids.delete(id);
  const members = [...ids].map((id) => {
    const w = work.get(id);
    const touch = (w?.calls ?? 0) + (w?.emails ?? 0);
    const worked = w?.accounts.size ?? 0;
    const r = prep.rosterById.get(id);
    return {
      owner_id: id, name: prep.ownerName(id), team: r?.podKey ? podTeam.get(r.podKey) ?? null : null, on_roster: !!r,
      accounts_owned: owned.get(id) ?? 0, accounts_worked: worked,
      calls: w?.calls ?? 0, emails: w?.emails ?? 0, touchpoints: touch,
      touch_per_account: worked ? touch / worked : null,
    };
  }).sort((a, b) => b.touchpoints - a.touchpoints || b.accounts_owned - a.accounts_owned);

  return {
    meta,
    demos: { booked: t.demos_booked, completed: t.demos_completed, accounts_with_demo: t.accounts_with_demo },
    stages,
    accounts: t.accounts, contacted: t.contacted,
    demo_rate: rate(t.accounts_with_demo, t.contacted),
    icp: icpSplit,
    members,
  };
}

/** Full (unpaged) account rows for CSV export. */
export function exportRows(prep: Prepared, f: AoFilters, drill: string, nowMs: number): AccountListRow[] {
  return filterAccounts(prep, f, nowMs).filter((c) => drillMatch(c, drill)).map((c) => toListRow(c, prep));
}

