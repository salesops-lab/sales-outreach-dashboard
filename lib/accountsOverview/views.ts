/** Accounts Overview — tab payloads over the pure engine (no I/O; unit-tested).
 *  "accounts": US TAM (HubSpot-wide) → teams → members of the chosen team → account list.
 *  "activity": worked / not worked in 60 days per team + member, last-quarter demos & deals per
 *              team + member, and account/contact utilization per member.
 *  "deals":    the deal-detail list behind the deal tables. */
import { AO_TEAMS } from "../../config/accounts-overview";
import { DealStageKey, stageLabel as rawStageLabel, stageOrder } from "../../config/deal-stages";
import {
  AccountCalc, AccountListRow, drillMatch, filterAccounts, isCall, isEmail, MemberRole, Prepared, rate, tally, toListRow,
} from "./compute";
import { resolveRange } from "./ranges";
import { AoDealRow, AoFilters } from "./types";

export const AO_VIEWS = ["accounts", "activity", "deals", "group"] as const;
export type AoView = (typeof AO_VIEWS)[number];

export interface ListOpts { drill: string; sort: string; dir: "asc" | "desc"; page: number; pageSize: number }
/** Deal-list selection (view=deals): whose deals and which kind. */
export interface DealOpts { team: string; owner: string; kind: "all" | "booked" | "conducted" }

export interface AoMeta {
  synced_at: string | null; sync_status: string; window_start_ms: number | null; error: string | null;
  period: { from: number; to: number };
  quarter: { from_ms: number; to_ms: number; label: string } | null;
  options: {
    members: { team: string; owner_id: string; name: string; role: MemberRole | null }[]; // HubSpot team members per team
    account_owners: { id: string; name: string }[];                                     // every account owner in the teams
    gd_names: { value: string; count: number }[];
    countries: { value: string; count: number }[];
    states: { value: string; count: number }[];
  };
}

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

/** Active owners in each of the four HubSpot teams (an owner in two teams is listed under both). */
function teamMembers(prep: Prepared): { team: string; owner_id: string; name: string; role: MemberRole | null }[] {
  const out: { team: string; owner_id: string; name: string; role: MemberRole | null }[] = [];
  for (const [id, o] of Object.entries(prep.data.state.owners ?? {})) {
    if (!o.active) continue;
    for (const t of AO_TEAMS) if ((o.teams ?? []).includes(t.hubspotTeamId)) out.push({ team: t.value, owner_id: id, name: o.name, role: prep.roleOf(id) });
  }
  return out;
}

const optCache = new WeakMap<Prepared, AoMeta["options"]>();
function options(prep: Prepared): AoMeta["options"] {
  const hit = optCache.get(prep);
  if (hit) return hit;
  const inScope = prep.companies.filter((p) => AO_TEAMS.some((t) => t.value === p.row.team));
  const owners = new Set<string>();
  for (const p of inScope) if (p.row.owner_id) owners.add(p.row.owner_id);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const byValue = (a: { value: string }, b: { value: string }) => a.value.localeCompare(b.value);
  const out: AoMeta["options"] = {
    members: teamMembers(prep).sort(byName),
    account_owners: [...owners].map((id) => ({ id, name: prep.ownerName(id) })).sort(byName),
    gd_names: countBy(inScope.map((p) => p.gdName ?? "").filter(Boolean)).sort(byValue),
    countries: countBy(inScope.map((p) => p.country)).sort((a, b) => b.count - a.count),
    states: countBy(inScope.map((p) => p.row.state?.trim() ?? "").filter(Boolean)).sort(byValue),
  };
  optCache.set(prep, out);
  return out;
}

/** Account-list cards (each is also a drill key for the list). */
export const ACCOUNT_CARDS = [
  { key: "", label: "All accounts" },
  { key: "type:group", label: "Group Dealership" },
  { key: "type:single_franchise", label: "Single Franchise" },
  { key: "type:independent", label: "Single Independent" },
  { key: "cstatus:active", label: "Worked in last 60 days" },
  { key: "cstatus:inactive_60plus", label: "Not worked in 60+ days" },
  { key: "cstatus:no_activity", label: "No activity recorded" },
  { key: "never_contacted", label: "Never contacted" },
] as const;

const worked = (c: AccountCalc) => c.cStatus === "active";
const notWorked = (c: AccountCalc) => c.cStatus === "inactive_60" || c.cStatus === "inactive_90";

/** One row per person who owns accounts in `accts` or is a HubSpot member of `teams`
 *  (so members with 0 accounts still show), plus "No owner" when some accounts have none. */
function peopleOf(prep: Prepared, accts: AccountCalc[], teams: string[]) {
  const members = teamMembers(prep).filter((m) => teams.includes(m.team));
  const byOwner = new Map<string, AccountCalc[]>();
  for (const c of accts) {
    const k = c.p.row.owner_id ?? "none";
    const l = byOwner.get(k) ?? []; l.push(c); byOwner.set(k, l);
  }
  const ids = new Set<string>([...members.map((m) => m.owner_id), ...byOwner.keys()]);
  return [...ids].map((id) => {
    const memberTeams = members.filter((m) => m.owner_id === id).map((m) => m.team);
    return {
      owner_id: id,
      name: id === "none" ? "No owner" : prep.ownerName(id),
      role: id === "none" ? null : prep.roleOf(id),
      team: memberTeams[0] ?? prep.teamOfOwner(id === "none" ? null : id),
      in_team: memberTeams.length > 0,
      accts: byOwner.get(id) ?? [],
    };
  });
}

const stageLabel = (k: DealStageKey) => rawStageLabel(k) ?? k;
/** Funnel order for display; lost / dropped stages go last instead of first. */
const stageRank = (k: string) => (k.startsWith("drop_off") || k === "non_sal" ? 1000 : 0) + stageOrder(k as DealStageKey);

const allTeams = () => AO_TEAMS.map((t) => t.value as string);

/** Worked / not worked in 60 days (HubSpot Last Activity Date) for a set of accounts. */
const workRow = (list: AccountCalc[]) => ({
  worked_60: list.filter(worked).length, not_worked_60: list.filter(notWorked).length,
  no_activity: list.filter((c) => c.cStatus === "no_activity").length,
  pct_worked: rate(list.filter(worked).length, list.length),
});

export function computeView(prep: Prepared, f: AoFilters, view: AoView, o: ListOpts, nowMs: number, d?: DealOpts) {
  const state = prep.data.state;
  const meta: AoMeta = {
    synced_at: state.finished_at, sync_status: state.status, window_start_ms: state.window_start_ms, error: state.error,
    period: { from: f.activityFrom, to: f.activityTo },
    quarter: state.quarter ?? null,
    options: options(prep),
  };
  const accts = filterAccounts(prep, f, nowMs);
  const scopeTeams = f.teams.length ? f.teams : allTeams();
  // Team cards always show all four teams, and member rows all members of the chosen team(s), so a
  // selection never hides the alternatives. Every other filter still applies.
  const noTeam = f.teams.length ? filterAccounts(prep, { ...f, teams: [], owner: null }, nowMs) : null;
  const noOwner = f.owner ? filterAccounts(prep, { ...f, owner: null }, nowMs) : accts;
  const teamAccts = (team: string) => (noTeam ?? noOwner).filter((c) => c.p.row.team === team);

  if (view === "accounts") {
    const teams = AO_TEAMS.map((tm) => {
      const list = teamAccts(tm.value);
      const x = tally(list);
      const members = teamMembers(prep).filter((m) => m.team === tm.value);
      return {
        team: tm.value, label: tm.label, total: x.accounts, group: x.group, single_franchise: x.single_franchise,
        independent: x.independent, unknown: x.unknown, unique_gds: x.unique_gds, members: members.length,
        by_role: (["Manager", "SDR", "AE"] as const).map((r) => ({
          role: r, accounts: list.filter((c) => prep.roleOf(c.p.row.owner_id) === r).length,
        })),
        ...workRow(list),
      };
    });
    const people = peopleOf(prep, noOwner, scopeTeams).map((m) => {
      const x = tally(m.accts);
      return {
        owner_id: m.owner_id, name: m.name, role: m.role, team: m.team, in_team: m.in_team,
        total: x.accounts, group: x.group, single_franchise: x.single_franchise, independent: x.independent,
        ...workRow(m.accts),
      };
    }).sort((a, b) => Number(b.in_team) - Number(a.in_team) || b.total - a.total);
    const cards = ACCOUNT_CARDS.map((c) => ({ ...c, count: accts.filter((a) => drillMatch(a, c.key)).length }));
    const rows = sortRows(accts.filter((c) => drillMatch(c, o.drill)).map((c) => toListRow(c, prep)), o.sort || "name", o.dir);
    return { meta, tam: state.tam ?? null, teams, members: people, cards, unique_gds: tally(accts).unique_gds, list: page<AccountListRow>(rows, o) };
  }

  if (view === "deals") return { meta, deals: dealList(prep, f, d ?? { team: "", owner: "", kind: "all" }) };
  if (view === "group") return { meta, group: groupDetail(prep, f, o.drill, nowMs) };

  // ── Deals & Pipeline tab ──
  const q = state.quarter ?? null;
  // "Are members using their accounts?" — each member's OWN accounts (account owner), over the
  // activity date range; when no range is chosen it uses the last 3 months.
  const uf = f.activityDefault ? { ...f, ...threeMonths(nowMs) } : f;
  const util = peopleOf(prep, filterAccounts(prep, { ...uf, owner: null }, nowMs), scopeTeams).filter((m) => m.owner_id !== "none");
  const utilization = util.map((m) => {
    const contacts = new Set<string>(); const reached = new Set<string>(); const connected = new Set<string>();
    const booked = new Set<string>(); const done = new Set<string>();
    let worked = 0, icp = 0, icpWorked = 0, icpConnected = 0, icpMeetDemo = 0, mtgBooked = 0, mtgLogged = 0, touches = 0;
    for (const c of m.accts) {
      for (const ct of c.p.contacts) contacts.add(ct.hs_id);
      c.contactsTouched.forEach((id) => reached.add(id));
      c.contactsReached.forEach((id) => connected.add(id));
      const qBooked = c.p.deals.filter((d) => inQ(d.demo_booked_ms, q));
      qBooked.forEach((d) => booked.add(d.hs_id));
      c.p.deals.filter((d) => inQ(d.demo_completed_ms, q)).forEach((d) => done.add(d.hs_id));
      mtgBooked += c.meetingDispositionCalls; mtgLogged += c.meetings; touches += c.touchpoints;
      if (c.touchpoints > 0) worked++;
      if (c.p.icp !== "yes") continue;
      icp++;
      if (c.touchpoints > 0) icpWorked++;
      if (c.connected > 0 || c.meetings > 0) icpConnected++;
      if (c.meetingDispositionCalls > 0 || c.meetings > 0 || qBooked.length > 0) icpMeetDemo++;
    }
    const own = (set: Set<string>) => [...set].filter((id) => contacts.has(id)).length;
    return {
      owner_id: m.owner_id, name: m.name, role: m.role, team: m.team, in_team: m.in_team,
      accounts: m.accts.length, worked, pct_worked: rate(worked, m.accts.length),
      contacts: contacts.size, contacts_reached: own(reached), contacts_connected: own(connected),
      icp_accounts: icp, icp_worked: icpWorked, icp_connected: icpConnected, icp_meeting_or_demo: icpMeetDemo,
      meetings_booked: mtgBooked, meetings_logged: mtgLogged, demos_booked: booked.size, demos_done: done.size,
      touches_per_worked: rate(touches, worked),
    };
  }).sort((a, b) => Number(b.in_team) - Number(a.in_team) || b.accounts - a.accounts);

  return {
    meta, ...dealSummary(prep, f),
    deal_rows: dealList(prep, f, { team: "", owner: "", kind: "all" }),
    utilization, util_period: { from: uf.activityFrom, to: uf.activityTo, default_3m: !!f.activityDefault },
  };
}

/** [from, to) for "the last 3 months" in US/Eastern. */
function threeMonths(nowMs: number) {
  const r = resolveRange("3m", null, null, nowMs);
  return { activityFrom: r.fromMs!, activityTo: r.toMs! };
}

// ── deals (last completed quarter, as stored by the sync) ─────────────────────
const inQ = (ms: number | null | undefined, q: { from_ms: number; to_ms: number } | null) =>
  ms != null && q != null && ms >= q.from_ms && ms < q.to_ms;

/** Deals that pass the Team + Team member filters (deals carry no company-level filters). */
function scopedDeals(prep: Prepared, f: AoFilters): AoDealRow[] {
  const teams = new Set(f.teams.length ? f.teams : allTeams());
  return prep.data.deals.filter((d) => d.team != null && teams.has(d.team) &&
    (!f.owner || d.sdr_owner_id === f.owner || d.deal_owner_id === f.owner));
}

function dealSummary(prep: Prepared, f: AoFilters) {
  const q = prep.data.state.quarter ?? null;
  const all = scopedDeals(prep, { ...f, teams: [], owner: null });
  const scoped = scopedDeals(prep, f);
  const counts = (list: AoDealRow[]) => ({
    deals: list.length,
    booked: list.filter((d) => inQ(d.demo_booked_ms, q)).length,
    conducted: list.filter((d) => inQ(d.demo_completed_ms, q)).length,
  });
  const deal_teams = AO_TEAMS.map((tm) => ({ team: tm.value, label: tm.label, ...counts(all.filter((d) => d.team === tm.value)) }));

  const stageCount = new Map<string, number>();
  for (const d of scoped) stageCount.set(d.stage_key, (stageCount.get(d.stage_key) ?? 0) + 1);
  const deal_stages = [...stageCount].map(([key, count]) => ({ key, label: stageLabel(key as DealStageKey), count }))
    .sort((a, b) => stageRank(a.key) - stageRank(b.key));

  // Per member: demos BOOKED are credited to the SDR (sdr_owner), demos CONDUCTED to the deal owner
  // (the AE) — the same two lenses as the rest of TrackerAI, never summed.
  const teamSet = f.teams.length ? f.teams : allTeams();
  const ids = new Set<string>(teamMembers(prep).filter((m) => teamSet.includes(m.team)).map((m) => m.owner_id));
  const base = scopedDeals(prep, { ...f, owner: null });
  for (const d of base) { if (d.sdr_owner_id) ids.add(d.sdr_owner_id); if (d.deal_owner_id) ids.add(d.deal_owner_id); }
  if (f.owner) for (const id of [...ids]) if (id !== f.owner) ids.delete(id);
  const deal_members = [...ids].map((id) => {
    const mine = base.filter((d) => d.sdr_owner_id === id || d.deal_owner_id === id);
    return {
      owner_id: id, name: prep.ownerName(id), role: prep.roleOf(id), team: prep.teamOfOwner(id),
      in_team: prep.teamsOfOwner(id).some((t) => teamSet.includes(t)),
      booked: base.filter((d) => d.sdr_owner_id === id && inQ(d.demo_booked_ms, q)).length,
      conducted: base.filter((d) => d.deal_owner_id === id && inQ(d.demo_completed_ms, q)).length,
      deals: mine.length,
    };
  }).filter((m) => m.in_team || m.deals > 0)
    .sort((a, b) => b.booked + b.conducted - (a.booked + a.conducted) || b.deals - a.deals);

  return { deal_totals: counts(scoped), deal_teams, deal_stages, deal_members };
}

export interface DealListRow {
  id: string; name: string; stage: string; stage_key: string; stage_rank: number; amount: number | null; team: string | null;
  sdr_id: string | null; owner_id: string | null;
  company_id: string | null; company_name: string | null;
  sdr: string; owner: string; created_ms: number | null; booked_ms: number | null; conducted_ms: number | null; close_ms: number | null;
}

/** The deal-detail list: deals in the Team/member scope, narrowed to one team / one person
 *  (as SDR or deal owner) and to booked / conducted in the quarter when asked. */
export function dealList(prep: Prepared, f: AoFilters, d: DealOpts): DealListRow[] {
  const q = prep.data.state.quarter ?? null;
  return scopedDeals(prep, f)
    .filter((x) => !d.team || x.team === d.team)
    .filter((x) => {
      if (!d.owner) return d.kind === "all" || inQ(d.kind === "booked" ? x.demo_booked_ms : x.demo_completed_ms, q);
      if (d.kind === "booked") return x.sdr_owner_id === d.owner && inQ(x.demo_booked_ms, q);
      if (d.kind === "conducted") return x.deal_owner_id === d.owner && inQ(x.demo_completed_ms, q);
      return x.sdr_owner_id === d.owner || x.deal_owner_id === d.owner;
    })
    .map((x) => {
      const co = x.company_ids.map((id) => prep.byId.get(id)).find(Boolean);
      return {
        id: x.hs_id, name: x.deal_name?.trim() || `Deal ${x.hs_id}`, stage: stageLabel(x.stage_key as DealStageKey),
        stage_key: x.stage_key, stage_rank: stageRank(x.stage_key),
        sdr_id: x.sdr_owner_id, owner_id: x.deal_owner_id,
        amount: x.amount ?? null, team: x.team ?? null,
        company_id: co?.row.hs_id ?? null, company_name: co?.row.name ?? null,
        sdr: prep.ownerName(x.sdr_owner_id), owner: prep.ownerName(x.deal_owner_id),
        created_ms: x.created_ms ?? null, booked_ms: x.demo_booked_ms, conducted_ms: x.demo_completed_ms, close_ms: x.close_ms ?? null,
      };
    })
    .sort((a, b) => (b.booked_ms ?? b.created_ms ?? 0) - (a.booked_ms ?? a.created_ms ?? 0));
}

/** Everything about one dealership group (by GD Name, case-insensitive): every rooftop in the four
 *  teams, regardless of the other filters (only the activity date range / type still apply to the
 *  call and email counts). `gd` arrives in the list's `drill` slot. */
export function groupDetail(prep: Prepared, f: AoFilters, gd: string, nowMs: number) {
  const key = gd.trim().toLowerCase();
  if (!key) return null;
  const accts = filterAccounts(prep, {
    ...f, teams: [], owner: null, gdName: key, country: "all", state: "all", dealerType: "all", icp: "all", companyDate: null, q: "",
  }, nowMs);
  if (!accts.length) return null;
  const rows = sortRows(accts.map((c) => toListRow(c, prep)), "name", "asc");
  const latest = (vals: (number | null)[]) => vals.reduce<number | null>((m, v) => (v != null && (m == null || v > m) ? v : m), null);
  const ids = new Set(accts.map((c) => c.p.row.hs_id));
  const deals = prep.data.deals.filter((d) => d.company_ids.some((id) => ids.has(id)));
  const potentials = rows.map((r) => r.potential_rooftops).filter((v): v is number => v != null);
  const x = tally(accts);
  const by = (vals: string[]) => countBy(vals).sort((a, b) => b.count - a.count);
  return {
    name: rows[0].gd_name ?? gd,
    rooftops: rows.length,
    potential_rooftops: potentials.length ? Math.max(...potentials) : null,
    franchise: rows.filter((r) => (r.dealer_type ?? "").toLowerCase() === "franchise").length,
    independent: rows.filter((r) => (r.dealer_type ?? "").toLowerCase() === "independent").length,
    worked_60: accts.filter(worked).length, not_worked_60: accts.filter(notWorked).length,
    last_activity_ms: latest(rows.map((r) => r.company_last_activity_ms)),
    rooftop_last_activity_ms: latest(rows.map((r) => r.rooftop_last_activity_ms)),
    teams: by(rows.map((r) => r.team ?? "No team")),
    owners: by(rows.map((r) => r.owner_name)),
    states: by(rows.map((r) => r.state ?? "Unknown")),
    contacts: x.contacts, calls: x.calls, emails: x.emails, touchpoints: x.touchpoints,
    quarter_deals: deals.length,
    rows,
  };
}

/** Full (unpaged) account rows for CSV export. */
export function exportRows(prep: Prepared, f: AoFilters, drill: string, nowMs: number): AccountListRow[] {
  return filterAccounts(prep, f, nowMs).filter((c) => drillMatch(c, drill)).map((c) => toListRow(c, prep));
}
