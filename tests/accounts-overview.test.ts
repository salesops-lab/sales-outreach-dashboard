import { describe, it, expect } from "vitest";
import {
  classifyAccountType, companyIcp, companyStatus, contactIcp, normalizeCountry, rooftopStatus,
} from "../lib/accountsOverview/classify";
import { prepare, filterAccounts, tally, drillMatch, AoData, toListRow } from "../lib/accountsOverview/compute";
import { computeView, ACCOUNT_CARDS } from "../lib/accountsOverview/views";
import { activityRow, companyRow, dealRow } from "../lib/accountsOverview/rows";
import { parseRequest, toCsv } from "../lib/accountsOverview/params";
import { resolveRange } from "../lib/accountsOverview/ranges";
import { AoActivityRow, AoCompanyRow, AoContactRow, AoFilters } from "../lib/accountsOverview/types";

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
  teams: [], member: null, country: "USA", state: "all", gdName: "", dealerType: "all", owner: null,
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
    expect(filterAccounts(prep, filters({ member: "nobody" }), NOW)).toHaveLength(0);
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
  });

  it("card counts equal their drill-down lists and the type cards never overlap", () => {
    const prep = prepare(data({
      companies: [
        co("1"), co("2", { type_of_dealership: "Independent" }), co("3", { gd_name: "G" }), co("4", { gd_name: "G" }),
        co("5", { last_activity_ms: NOW - 120 * DAY }), co("6", { last_activity_ms: null, last_contacted_ms: null }),
        co("7", { type_of_dealership: null }),
      ],
    }));
    const v = computeView(prep, filters(), "accounts", LIST, NOW) as { cards: { key: string; count: number }[]; unique_gds: number; list: { total: number } };
    const count = (k: string) => v.cards.find((c) => c.key === k)!.count;
    expect(v.cards.map((c) => c.key)).toEqual(ACCOUNT_CARDS.map((c) => c.key));
    expect(count("")).toBe(7);
    expect(count("type:group")).toBe(2);
    expect(v.unique_gds).toBe(1);
    expect(count("type:single_franchise") + count("type:independent") + count("type:group") + 1).toBe(7); // +1 unknown
    expect(count("cstatus:active")).toBe(5);
    expect(count("cstatus:inactive_60plus")).toBe(1);
    expect(count("cstatus:no_activity")).toBe(1);
    expect(count("never_contacted")).toBe(1);
    for (const c of v.cards) {
      const listed = computeView(prep, filters(), "accounts", { ...LIST, drill: c.key }, NOW) as { list: { total: number } };
      expect(listed.list.total).toBe(c.count);
    }
    const accts = filterAccounts(prep, filters(), NOW);
    expect(accts.filter((a) => drillMatch(a, "type:group"))).toHaveLength(2);
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

  it("pipeline: demos once per deal, ICP contacted vs not, per-member work", () => {
    const prep = prepare(data({
      companies: [co("1", { owner_id: "rep1" }), co("2", { icp: "no" }), co("3")],
      activities: [act("a1"), act("a2", { type: "email", direction: "EMAIL" }), act("a3", { company_ids: ["2"] })],
      deals: [
        { hs_id: "d1", stage_key: "discovery_done", deal_owner_id: "ae", sdr_owner_id: "rep1", company_ids: ["1", "2"], demo_booked_ms: NOW - 3 * DAY, demo_completed_ms: null },
        { hs_id: "d2", stage_key: "demo_done", deal_owner_id: "ae", sdr_owner_id: "rep1", company_ids: ["1"], demo_booked_ms: NOW - 200 * DAY, demo_completed_ms: NOW - DAY },
      ],
    }));
    const v = computeView(prep, filters(), "pipeline", LIST, NOW) as {
      demos: { booked: number; completed: number }; stages: { key: string; count: number }[];
      icp: { icp: string; accounts: number; contacted: number; not_contacted: number; demo_booked: number }[];
      members: { owner_id: string; accounts_owned: number; accounts_worked: number; calls: number; emails: number; touchpoints: number; touch_per_account: number | null }[];
    };
    expect(v.demos).toMatchObject({ booked: 1, completed: 1 });   // d1 on two accounts = one demo
    expect(v.stages).toEqual([{ key: "discovery_done", label: "Discovery Call Done", count: 1 }]);
    expect(v.icp.find((r) => r.icp === "yes")).toMatchObject({ accounts: 2, contacted: 1, not_contacted: 1, demo_booked: 1 });
    expect(v.members).toEqual([{
      owner_id: "rep1", name: "Rep One", team: "Neelima", in_team: true,
      accounts_owned: 1, accounts_worked: 2, calls: 2, emails: 1, touchpoints: 3, touch_per_account: 1.5,
    }]);
  });
});

describe("params", () => {
  it("defaults to USA, all four teams, the last 3 months", () => {
    const p = parseRequest(new URLSearchParams(""), NOW, NOW - 180 * DAY);
    expect(p.filters.country).toBe("USA");
    expect(p.filters.teams).toEqual([]);
    expect(p.view).toBe("accounts");
    expect(p.filters.activityFrom).toBe(resolveRange("3m", null, null, NOW).fromMs);
  });

  it("reads the new filters and rejects unknown teams", () => {
    const p = parseRequest(new URLSearchParams("teams=Prince,Archit&gd=Alpha&dtype=independent&state=TX&cpreset=none&view=pipeline"), NOW, null);
    expect(p.filters.teams).toEqual(["Prince"]);
    expect(p.filters).toMatchObject({ gdName: "Alpha", dealerType: "independent", state: "TX" });
    expect(p.filters.companyDate).toEqual({ fromMs: 0, toMs: 0, includeMissing: true });
    expect(p.view).toBe("pipeline");
  });

  it("escapes CSV and neutralizes formula injection", () => {
    const csv = toCsv([{ id: "1", name: "=HYPERLINK(\"x\")", activity_owners: ["A", "B"] }]);
    expect(csv.split("\n")[1]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain("\"A; B\"");
  });
});
