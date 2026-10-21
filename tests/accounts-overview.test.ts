import { describe, it, expect } from "vitest";
import {
  classifyAccountType, companyIcp, companyStatus, contactIcp, normalizeCountry, rooftopStatus,
} from "../lib/accountsOverview/classify";
import { prepare, filterAccounts, tally, drillMatch, AoData, toListRow, rolesFromRoster } from "../lib/accountsOverview/compute";
import { computeView, dealList, ACCOUNT_CARDS } from "../lib/accountsOverview/views";
import { activityRow, companyRow, dealInWindow, dealRow } from "../lib/accountsOverview/rows";
import { parseRequest, toCsv } from "../lib/accountsOverview/params";
import { lastQuarter } from "../lib/accountsOverview/ranges";
import { AoActivityRow, AoCompanyRow, AoContactRow, AoDealRow, AoFilters } from "../lib/accountsOverview/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16, 16, 0, 0); // 2026-10-16 12:00 ET
const CONNECTED = "f240bbac-87c9-4f6e-bf70-924b57d47db7";
const NOT_CONNECTED = "not-a-connected-guid";
const MEETING_DISP = "243ad062-d38f-40ea-86e2-10040d9ce4bd";
const LIST = { drill: "", sort: "", dir: "asc" as const, page: 1, pageSize: 50 };

const co = (id: string, o: Partial<AoCompanyRow> = {}): AoCompanyRow => ({
  hs_id: id, name: `Co ${id}`, domain: `${id}.com`, country: "united states", state: "TX", city: null,
  owner_id: "o1", team: "Neelima", icp: "yes", type_of_dealership: "Franchise", is_group: null,
  gd_id: null, gd_name: null, group_name: null, last_activity_ms: NOW - 5 * DAY, last_contacted_ms: NOW - 5 * DAY,
  rooftop_last_activity_ms: NOW - 5 * DAY, num_contacts: 1, hs_lastmodified_ms: null, ...o,
});
const ct = (id: string, cos: string[], o: Partial<AoContactRow> = {}): AoContactRow => ({
  hs_id: id, first_name: "Pat", last_name: id, title: null, email: `${id}@x.com`, phone: null,
  owner_id: "co1", icp: null, last_activity_ms: null, last_contacted_ms: null, company_ids: cos, ...o,
});
const act = (id: string, o: Partial<AoActivityRow> = {}): AoActivityRow => ({
  hs_id: id, type: "call", ts_ms: NOW - 2 * DAY, owner_id: "rep1", direction: "OUTBOUND", disposition: null,
  duration_ms: null, email_replied: false, meeting_outcome: null, meeting_start_ms: null, subject: null,
  company_ids: ["1"], contact_ids: [], via_contact_only: false, ...o,
});

const filters = (o: Partial<AoFilters> = {}): AoFilters => ({
  teams: [], country: "USA", state: "all", gdName: "", dealerType: "all", owner: null, icp: "all",
  companyDate: null, q: "", activityTypes: [], activityFrom: NOW - 90 * DAY, activityTo: NOW + DAY, ...o,
});

const data = (o: Partial<AoData> = {}): AoData => ({
  companies: [], contacts: [], activities: [], deals: [],
  state: {
    status: "ok", started_at: null, finished_at: null, window_start_ms: NOW - 180 * DAY, counts: {}, reconciliation: [], error: null,
    owners: { o1: { name: "Owner One", active: true, teams: [] }, rep1: { name: "Rep One", active: true, teams: ["362172280"] } }, // rep1 ∈ Neelima Team
  },
  ...o,
});

describe("classify", () => {
  it("normalizes country variants and never defaults blanks to USA", () => {
    expect(normalizeCountry("united states")).toBe("USA");
    expect(normalizeCountry("US")).toBe("USA");
    expect(normalizeCountry("U.S.A.")).toBe("USA");
    expect(normalizeCountry("canada")).toBe("Canada");
    expect(normalizeCountry(null)).toBe("Unknown");
  });

  it("keeps company ICP and contact ICP as separate properties", () => {
    expect(companyIcp("yes")).toBe("yes");
    expect(companyIcp(null)).toBe("unknown");
    expect(contactIcp("ICP")).toBe("yes");
    expect(contactIcp("Non ICP")).toBe("no");
  });

  it("classifies by the HubSpot GD Name + Type of Dealership filters", () => {
    expect(classifyAccountType(co("1", { gd_name: "Big Group" })).type).toBe("group");
    expect(classifyAccountType(co("1", { gd_name: "Big Group", type_of_dealership: "Independent" })).type).toBe("group");
    expect(classifyAccountType(co("1", { gd_name: null, type_of_dealership: "Franchise" })).type).toBe("single_franchise");
    expect(classifyAccountType(co("1", { gd_name: "  ", type_of_dealership: "Independent" })).type).toBe("independent");
    expect(classifyAccountType(co("1", { gd_name: null, type_of_dealership: null })).type).toBe("unknown");
    // dealership_group_name / the yes-no flag do not decide the type — only GD Name does
    expect(classifyAccountType(co("1", { group_name: "X", is_group: "true", gd_name: null })).type).toBe("single_franchise");
  });

  it("never treats a missing date as 0 days", () => {
    expect(companyStatus({ last_activity_ms: NOW - 10 * DAY, last_contacted_ms: null }, NOW, 60, 90)).toBe("active");
    expect(companyStatus({ last_activity_ms: NOW - 75 * DAY, last_contacted_ms: null }, NOW, 60, 90)).toBe("inactive_60");
    expect(companyStatus({ last_activity_ms: null, last_contacted_ms: null }, NOW, 60, 90)).toBe("no_activity");
    expect(companyStatus({ last_activity_ms: null, last_contacted_ms: NOW }, NOW, 60, 90)).toBe("needs_review");
    expect(rooftopStatus(null, NOW, 60, 90)).toBe("missing_date");
  });
});

describe("rows", () => {
  it("maps HubSpot records and drops undatable activities", () => {
    const r = companyRow("5", { name: " A ", hubspot_team_id: "362172539", gd_name: "G", notes_last_updated: "2026-10-01T00:00:00Z", num_associated_contacts: "3" });
    expect(r.name).toBe("A");
    expect(r.team).toBe("Prince");                                              // HubSpot Team id → team
    expect(companyRow("6", { hubspot_team_id: "343956526" }).team).toBeNull();     // other HubSpot teams are out of scope
    expect(r.gd_name).toBe("G");
    expect(r.num_contacts).toBe(3);
    expect(activityRow("call", "1", { hs_timestamp: null }, ["5"], [], false)).toBeNull();
    expect(activityRow("note", "2", { hs_timestamp: String(NOW), hs_note_body: "<p>Hello&nbsp;<b>there</b></p>" }, ["5"], [], false)?.subject).toBe("Hello there");
  });

  it("derives demos with the existing event-truth helpers, Auto Pipeline only", () => {
    const booked = Date.UTC(2026, 8, 1);
    const done = Date.UTC(2026, 8, 10);
    const d = dealRow("9", { pipeline: "1001348836", dealstage: "1534611151",
      hs_v2_date_entered_1534610164: String(booked), hs_v2_date_entered_1534611151: String(done) }, ["5"]);
    expect(d?.demo_booked_ms).toBe(booked);
    expect(d?.demo_completed_ms).toBe(done);
    expect(dealRow("10", { pipeline: "999" }, ["5"])).toBeNull();
  });
});

describe("engine", () => {
  it("counts calls/connected/emails once; touchpoints = calls + emails", () => {
    const prep = prepare(data({
      companies: [co("1"), co("2", { owner_id: "o2" })],
      contacts: [ct("c1", ["1"])],
      activities: [
        act("a1", { disposition: CONNECTED, contact_ids: ["c1"] }),
        act("a2", { disposition: NOT_CONNECTED }),
        act("a3", { type: "email", direction: "EMAIL" }),
        act("a4", { type: "email", direction: "INCOMING_EMAIL" }),        // not outgoing
        act("a5", { direction: "INBOUND" }),                               // not outbound
        act("a6", { type: "meeting", direction: null, meeting_outcome: "SCHEDULED" }),
        act("a7", { type: "note", direction: null }),
        act("a8", { company_ids: ["1", "2"], disposition: MEETING_DISP }), // one call on two accounts
      ],
    }));
    const accts = filterAccounts(prep, filters(), NOW);
    const one = accts.find((a) => a.p.row.hs_id === "1")!;
    expect([one.calls, one.connected, one.emails, one.meetings, one.notes]).toEqual([3, 2, 1, 1, 1]);
    expect(one.touchpoints).toBe(4);           // 3 calls + 1 email; the meeting is counted separately
    expect(one.meetingsCompleted).toBe(0);     // scheduled ≠ completed
    expect(tally(accts).calls).toBe(3);        // a8 sits on two accounts but is one call
    expect(filterAccounts(prep, filters({ owner: "o2" }), NOW).map((a) => a.p.row.hs_id)).toEqual(["2"]);
    expect(filterAccounts(prep, filters({ owner: "nobody" }), NOW)).toHaveLength(0);
    expect(toListRow(one, prep).activity_owners).toEqual(["Rep One"]);
  });

  it("applies the HubSpot-style filters", () => {
    const prep = prepare(data({
      companies: [
        co("1", { gd_name: "Alpha Group" }), co("2", { state: "CA" }), co("3", { type_of_dealership: "Independent" }),
        co("4", { type_of_dealership: null }), co("5", { country: null }), co("6", { team: null }),
      ],
    }));
    const ids = (f: Partial<AoFilters>) => filterAccounts(prep, filters(f), NOW).map((a) => a.p.row.hs_id).sort();
    expect(ids({})).toEqual(["1", "2", "3", "4"]);                 // USA default; companies outside the four teams excluded
    expect(ids({ country: "all" })).toEqual(["1", "2", "3", "4", "5"]);
    expect(ids({ gdName: "alpha group" })).toEqual(["1"]);
    expect(ids({ state: "ca" })).toEqual(["2"]);
    expect(ids({ dealerType: "independent" })).toEqual(["3"]);
    expect(ids({ dealerType: "none" })).toEqual(["4"]);
    expect(ids({ companyDate: { fromMs: NOW - 2 * DAY, toMs: NOW + DAY } })).toEqual([]);
    expect(ids({ icp: "no" })).toEqual([]);
    expect(ids({ icp: "yes" })).toEqual(["1", "2", "3", "4"]);
  });

  it("card counts equal their drill-down lists and the type cards never overlap", () => {
    const prep = prepare(data({
      companies: [
        co("1"), co("2", { type_of_dealership: "Independent" }), co("3", { gd_name: "G" }), co("4", { gd_name: "G" }),
        co("5", { last_activity_ms: NOW - 120 * DAY }), co("6", { last_activity_ms: null, last_contacted_ms: null }),
        co("7", { type_of_dealership: null }),
      ],
    }));
    type V = {
      cards: { key: string; count: number }[]; unique_gds: number; list: { total: number };
      teams: { team: string; total: number; single_franchise: number; independent: number; group: number; members: number }[];
      members: { owner_id: string; total: number; in_team: boolean }[];
    };
    const v = computeView(prep, filters(), "accounts", LIST, NOW) as unknown as V;
    expect(v.teams.find((r) => r.team === "Neelima")).toMatchObject({ total: 7, single_franchise: 3, independent: 1, group: 2, members: 1 });
    // the team cards always show all four teams, even when the Team filter narrows the cards
    const narrowed = computeView(prep, filters({ teams: ["Prince"] }), "accounts", LIST, NOW) as unknown as V;
    expect(narrowed.teams.find((r) => r.team === "Neelima")!.total).toBe(7);
    expect(narrowed.cards[0].count).toBe(0);
    // members = HubSpot team members (rep1, 0 accounts) + owners of accounts in scope (o1, not in a team)
    expect(v.members.map((m) => [m.owner_id, m.total, m.in_team])).toEqual([["rep1", 0, true], ["o1", 7, false]]);
    const count = (k: string) => v.cards.find((c) => c.key === k)!.count;
    expect(v.cards.map((c) => c.key)).toEqual(ACCOUNT_CARDS.map((c) => c.key));
    expect(count("")).toBe(7);
    expect(count("type:group")).toBe(2);
    expect(v.unique_gds).toBe(1);
    expect(count("type:single_franchise") + count("type:independent") + count("type:group") + 1).toBe(7); // +1 unknown
    expect(count("work:active")).toBe(5);
    expect(count("work:inactive_60plus")).toBe(1);
    expect(count("work:no_activity")).toBe(1);
    expect(count("never_contacted")).toBe(1);
    for (const c of v.cards) {
      const listed = computeView(prep, filters(), "accounts", { ...LIST, drill: c.key }, NOW) as { list: { total: number } };
      expect(listed.list.total).toBe(c.count);
    }
    const accts = filterAccounts(prep, filters(), NOW);
    expect(accts.filter((a) => drillMatch(a, "type:group"))).toHaveLength(2);
  });

  it("worked-60d: groups use Rooftop Last Activity, singles the company Last Activity Date", () => {
    const prep = prepare(data({
      companies: [
        // group rooftops — the company date is ignored
        co("1", { gd_name: "G", last_activity_ms: NOW - 200 * DAY, rooftop_last_activity_ms: NOW - 3 * DAY }), // worked
        co("2", { gd_name: "G", last_activity_ms: NOW - 3 * DAY, rooftop_last_activity_ms: NOW - 90 * DAY }), // not worked
        co("3", { gd_name: "G", rooftop_last_activity_ms: null }),                                            // no date
        // singles — the rooftop date is ignored
        co("4", { last_activity_ms: NOW - 3 * DAY, rooftop_last_activity_ms: null }),                         // worked
        co("5", { type_of_dealership: "Independent", last_activity_ms: NOW - 70 * DAY }),                     // not worked
        co("6", { last_activity_ms: null, last_contacted_ms: null }),                                         // no activity
      ],
    }));
    const v = computeView(prep, filters(), "accounts", LIST, NOW) as any;
    const t = v.teams.find((r: any) => r.team === "Neelima");
    expect([t.worked_60, t.not_worked_60, t.no_activity]).toEqual([2, 2, 2]);
    expect(t.split.group).toMatchObject({ accounts: 3, worked_60: 1, not_worked_60: 1, no_activity: 1 });
    expect(t.split.single).toMatchObject({ accounts: 3, worked_60: 1, not_worked_60: 1, no_activity: 1 });
    const accts = filterAccounts(prep, filters(), NOW);
    const ids = (k: string) => accts.filter((a) => drillMatch(a, k)).map((a) => a.p.row.hs_id);
    expect(ids("work:active")).toEqual(["1", "4"]);
    expect(ids("work:active:group")).toEqual(["1"]);
    expect(ids("work:inactive_60plus:single")).toEqual(["5"]);
    expect(ids("single")).toEqual(["4", "5", "6"]);
  });

  it("verifies Never Contacted against HubSpot and the synced activity", () => {
    const prep = prepare(data({
      companies: [co("1", { last_contacted_ms: null }), co("2", { last_contacted_ms: null })],
      activities: [act("a1", { company_ids: ["2"] })],
    }));
    const accts = filterAccounts(prep, filters(), NOW);
    expect(accts.find((a) => a.p.row.hs_id === "1")!.neverContacted).toBe(true);
    expect(accts.find((a) => a.p.row.hs_id === "2")!.neverContacted).toBe(false);
  });

  it("activity tab: 60-day work per team + member, quarter deals by SDR / owner lens, utilization", () => {
    const Q = { from_ms: NOW - 100 * DAY, to_ms: NOW - 10 * DAY, label: "Q3 2026 (Jul–Sep)" };
    const deal = (o: Partial<AoDealRow>): AoDealRow => ({
      hs_id: "d", stage_key: "discovery_done", deal_owner_id: "ae", sdr_owner_id: "rep1", company_ids: ["1"],
      demo_booked_ms: null, demo_completed_ms: null, team: "Neelima", ...o,
    });
    const base = data();
    const prep = prepare({
      ...base,
      state: { ...base.state, quarter: Q, owners: { ...base.state.owners, ae: { name: "AE One", active: true, teams: ["362172280"] } } },
      roles: { rep1: "SDR", ae: "AE" },
      companies: [
        co("1", { owner_id: "rep1" }), co("2", { owner_id: "rep1", icp: "no", last_activity_ms: NOW - 70 * DAY }),
        co("3", { owner_id: "rep1", last_activity_ms: null, last_contacted_ms: null }), co("4", { team: "Prince" }),
      ],
      contacts: [ct("c1", ["1"]), ct("c2", ["1"])],
      activities: [
        act("a1", { contact_ids: ["c1"] }), act("a2", { type: "email", direction: "EMAIL" }),
        act("a3", { owner_id: "other" }),
      ],
      deals: [
        deal({ hs_id: "d1", demo_booked_ms: NOW - 50 * DAY }),
        deal({ hs_id: "d2", stage_key: "demo_done", demo_booked_ms: NOW - 200 * DAY, demo_completed_ms: NOW - 20 * DAY }),
        deal({ hs_id: "d3", team: "Prince", sdr_owner_id: "x", deal_owner_id: "y", company_ids: ["4"], demo_booked_ms: NOW - 40 * DAY }),
      ],
    });
    const v = computeView(prep, filters({ country: "all" }), "activity", LIST, NOW) as any;
    // 60-day work now lives on the Accounts tab's team + member rows
    const acc = computeView(prep, filters({ country: "all" }), "accounts", LIST, NOW) as any;
    expect(acc.teams.find((t: any) => t.team === "Neelima")).toMatchObject({ total: 3, worked_60: 1, not_worked_60: 1, no_activity: 1 });
    expect(acc.members.find((m: any) => m.owner_id === "rep1")).toMatchObject({ role: "SDR", total: 3, worked_60: 1, not_worked_60: 1, no_activity: 1 });
    expect(v.deal_teams.find((t: any) => t.team === "Neelima")).toMatchObject({ deals: 2, booked: 1, conducted: 1 });
    expect(v.deal_teams.find((t: any) => t.team === "Prince")).toMatchObject({ deals: 1, booked: 1 });
    // booked → SDR, conducted → deal owner (AE)
    expect(v.deal_members.find((m: any) => m.owner_id === "rep1")).toMatchObject({ booked: 1, conducted: 0, deals: 2 });
    expect(v.deal_members.find((m: any) => m.owner_id === "ae")).toMatchObject({ booked: 0, conducted: 1, deals: 2, role: "AE" });
    // pipeline rows carry the people and the stage order
    expect(v.deal_rows.map((d: any) => [d.id, d.sdr_id, d.owner_id, d.stage_key]).sort()).toEqual([
      ["d1", "rep1", "ae", "discovery_done"], ["d2", "rep1", "ae", "demo_done"], ["d3", "x", "y", "discovery_done"]]);
    // utilization funnel over the member's own accounts (explicit range here, so not the 3-month default)
    const u = v.utilization.find((m: any) => m.owner_id === "rep1");
    expect(u).toMatchObject({ accounts: 3, worked: 1, contacts: 2, contacts_reached: 1, icp_accounts: 2, icp_worked: 1,
      demos_booked: 1, demos_done: 1 });
    expect(v.util_period.default_3m).toBe(false);
    const d3m = computeView(prep, filters({ country: "all", activityDefault: true }), "activity", LIST, NOW) as any;
    expect(d3m.util_period.default_3m).toBe(true);
    // deal list: one person's booked demos / everything for a team
    expect(dealList(prep, filters(), { team: "", owner: "rep1", kind: "booked" }).map((d) => d.id)).toEqual(["d1"]);
    expect(dealList(prep, filters(), { team: "Prince", owner: "", kind: "all" }).map((d) => d.id)).toEqual(["d3"]);
    expect(dealList(prep, filters({ teams: ["Neelima"] }), { team: "", owner: "", kind: "conducted" }).map((d) => d.id)).toEqual(["d2"]);
  });

  it("roles come from the roster: pod leads / managers = Manager, else SDR / AE", () => {
    const roles = rolesFromRoster({
      pods: [{ leadEmail: "lead@spyne.ai" }],
      managers: { m: { ownerId: "3" } },
      members: [
        { ownerId: "1", email: "LEAD@spyne.ai", kind: "ae", active: true },
        { ownerId: "2", email: "a@spyne.ai", kind: "sdr", active: true },
        { ownerId: "3", email: "b@spyne.ai", kind: "sdr", active: true },
        { ownerId: "4", email: "c@spyne.ai", kind: "ae", active: true },
      ],
    });
    expect(roles).toEqual({ 1: "Manager", 2: "SDR", 3: "Manager", 4: "AE" });
  });
});

describe("quarter", () => {
  it("is the last COMPLETED calendar quarter in US/Eastern", () => {
    const q = lastQuarter(NOW); // 2026-10-16
    expect(q.label).toBe("Q3 2026 (Jul–Sep)");
    expect(new Date(q.fromMs).toISOString()).toBe("2026-07-01T04:00:00.000Z"); // midnight EDT
    expect(new Date(q.toMs).toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(lastQuarter(Date.UTC(2027, 1, 10)).label).toBe("Q4 2026 (Oct–Dec)");
  });

  it("keeps a deal when it was created, booked or demoed inside the window", () => {
    const d = dealRow("9", { pipeline: "1001348836", dealstage: "1534610164", dealname: "Acme", amount: "1200",
      createdate: "2026-06-20T00:00:00Z", hs_v2_date_entered_1534610164: String(Date.UTC(2026, 6, 3)) }, ["5"], "Prince")!;
    expect(d).toMatchObject({ deal_name: "Acme", amount: 1200, team: "Prince" });
    const q = lastQuarter(NOW);
    expect(dealInWindow(d, q.fromMs, q.toMs)).toBe(true);                // booked Jul 3
    expect(dealInWindow({ ...d, demo_booked_ms: null }, q.fromMs, q.toMs)).toBe(false); // created in June only
  });
});

describe("params", () => {
  it("opens with no filters: all countries, all four teams, every synced activity", () => {
    const p = parseRequest(new URLSearchParams(""), NOW, NOW - 180 * DAY);
    expect(p.filters.country).toBe("all");
    expect(p.filters.teams).toEqual([]);
    expect(p.filters).toMatchObject({ owner: null, icp: "all", dealerType: "all", state: "all", companyDate: null, activityTypes: [] });
    expect(p.view).toBe("accounts");
    expect(p.filters.activityFrom).toBe(NOW - 180 * DAY);
    expect(p.warnings).toEqual([]);
    expect(parseRequest(new URLSearchParams("ppreset=lq"), NOW, null).filters.activityFrom).toBe(lastQuarter(NOW).fromMs);
  });

  it("reads the new filters and rejects unknown teams", () => {
    const p = parseRequest(new URLSearchParams("teams=Prince,Archit&gd=Alpha&dtype=independent&state=TX&cpreset=none&icp=yes&view=activity&dteam=Prince&dkind=booked"), NOW, null);
    expect(p.filters.teams).toEqual(["Prince"]);
    expect(p.filters).toMatchObject({ gdName: "Alpha", dealerType: "independent", state: "TX", icp: "yes" });
    expect(p.deal).toEqual({ team: "Prince", owner: "", kind: "booked" });
    expect(p.filters.companyDate).toEqual({ fromMs: 0, toMs: 0, includeMissing: true });
    expect(p.view).toBe("activity");
  });

  it("escapes CSV and neutralizes formula injection", () => {
    const csv = toCsv([{ id: "1", name: "=HYPERLINK(\"x\")", activity_owners: ["A", "B"] }]);
    expect(csv.split("\n")[1]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain("\"A; B\"");
  });
});

describe("group detail", () => {
  it("lists every rooftop of a GD across teams, ignoring the other filters", () => {
    const prep = prepare(data({
      companies: [
        co("1", { gd_name: "Alpha Group", potential_rooftops: 5, rooftop_last_activity_ms: NOW - 3 * DAY }),
        co("2", { gd_name: "alpha group", team: "Prince", state: "CA", type_of_dealership: "Independent", potential_rooftops: 7, rooftop_last_activity_ms: NOW - 80 * DAY }),
        co("3", { gd_name: "Beta" }), co("4", { gd_name: "Alpha Group", team: null }),
      ],
    }));
    const v = computeView(prep, filters({ state: "TX", teams: ["Neelima"] }), "group", { ...LIST, drill: "Alpha Group" }, NOW) as any;
    expect(v.group).toMatchObject({ rooftops: 2, potential_rooftops: 7, franchise: 1, independent: 1, worked_60: 1, not_worked_60: 1,
      rooftop_last_activity_ms: NOW - 3 * DAY });
    expect(v.group.rows.map((r: any) => [r.id, r.dealer_type, r.potential_rooftops])).toEqual([["1", "Franchise", 5], ["2", "Independent", 7]]);
    expect((computeView(prep, filters(), "group", { ...LIST, drill: "nope" }, NOW) as any).group).toBeNull();
    expect(companyRow("9", { potential_rooftops: "12" }).potential_rooftops).toBe(12);
  });
});
