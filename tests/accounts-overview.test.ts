import { describe, it, expect } from "vitest";
import {
  classifyAccountType, companyIcp, companyStatus, contactIcp, normalizeCountry, rooftopStatus,
} from "../lib/accountsOverview/classify";
import { prepare, filterAccounts, tally, drillMatch, AoData, toListRow, DQ_CHECKS } from "../lib/accountsOverview/compute";
import { computeView } from "../lib/accountsOverview/views";
import { activityRow, companyRow, dealRow } from "../lib/accountsOverview/rows";
import { parseRequest, toCsv } from "../lib/accountsOverview/params";
import { resolveRange } from "../lib/accountsOverview/ranges";
import { AoActivityRow, AoCompanyRow, AoContactRow, AoFilters } from "../lib/accountsOverview/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16, 16, 0, 0); // 2026-10-16 12:00 ET
const CONNECTED = "f240bbac-87c9-4f6e-bf70-924b57d47db7";
const NOT_CONNECTED = "not-a-connected-guid";
const MEETING_DISP = "243ad062-d38f-40ea-86e2-10040d9ce4bd";

const co = (id: string, o: Partial<AoCompanyRow> = {}): AoCompanyRow => ({
  hs_id: id, name: `Co ${id}`, domain: `${id}.com`, country: "united states", state: null, city: null,
  owner_id: "o1", team: "Neelima", icp: "yes", type_of_dealership: "Franchise", is_group: "false",
  gd_id: null, gd_name: null, group_name: null, last_activity_ms: NOW - 5 * DAY, last_contacted_ms: NOW - 5 * DAY,
  rooftop_last_activity_ms: NOW - 5 * DAY, num_contacts: 1, hs_lastmodified_ms: null, ...o,
});
const ct = (id: string, cos: string[], o: Partial<AoContactRow> = {}): AoContactRow => ({
  hs_id: id, first_name: "Pat", last_name: id, title: null, email: `${id}@x.com`, phone: "+1 (555) 010-2030",
  owner_id: "co1", icp: null, last_activity_ms: null, last_contacted_ms: null, company_ids: cos, ...o,
});
const act = (id: string, o: Partial<AoActivityRow>): AoActivityRow => ({
  hs_id: id, type: "call", ts_ms: NOW - 2 * DAY, owner_id: "rep1", direction: "OUTBOUND", disposition: null,
  duration_ms: null, email_replied: false, meeting_outcome: null, meeting_start_ms: null, subject: null,
  company_ids: ["1"], contact_ids: [], via_contact_only: false, ...o,
});

const filters = (o: Partial<AoFilters> = {}): AoFilters => ({
  teams: [], member: null, country: "USA", companyDate: null, rooftopDate: null, accountType: "all", icp: "all",
  owner: null, q: "", contactQ: "", activityTypes: [], activityFrom: NOW - 90 * DAY, activityTo: NOW + DAY,
  inactiveDays: 60, deepInactiveDays: 90, ...o,
});

const data = (o: Partial<AoData> = {}): AoData => ({
  companies: [], contacts: [], activities: [], deals: [],
  state: { status: "ok", started_at: null, finished_at: null, window_start_ms: NOW - 180 * DAY, counts: {}, reconciliation: [], owners: { o1: { name: "Owner One", active: true }, rep1: { name: "Rep One", active: true } }, error: null },
  roster: [{ ownerId: "rep1", name: "Rep One", podKey: "neelima", kind: "sdr", active: true }],
  ...o,
});

describe("classify", () => {
  it("normalizes country variants and never defaults blanks to USA", () => {
    expect(normalizeCountry("united states")).toBe("USA");
    expect(normalizeCountry("US")).toBe("USA");
    expect(normalizeCountry("U.S.A.")).toBe("USA");
    expect(normalizeCountry("canada")).toBe("Canada");
    expect(normalizeCountry("puerto rico")).toBe("Puerto Rico");
    expect(normalizeCountry(null)).toBe("Unknown");
    expect(normalizeCountry("  ")).toBe("Unknown");
  });

  it("keeps company ICP and contact ICP as separate properties", () => {
    expect(companyIcp("yes")).toBe("yes");
    expect(companyIcp("no")).toBe("no");
    expect(companyIcp(null)).toBe("unknown");
    expect(contactIcp("ICP")).toBe("yes");
    expect(contactIcp("Non ICP")).toBe("no");
    expect(contactIcp("yes")).toBe("unknown"); // the contact enum is ICP/Non ICP, not yes/no
  });

  it("classifies Group Dealership by association + GD name (flag not required)", () => {
    expect(classifyAccountType(co("1", { gd_id: "9", gd_name: "Big Group", is_group: null })).type).toBe("group");
    expect(classifyAccountType(co("1", { group_name: "Big Group", is_group: "true" })).type).toBe("group");
    expect(classifyAccountType(co("1", { gd_id: "9", gd_name: null, group_name: null, is_group: "true" })))
      .toEqual({ type: "unknown", reason: "GD ID set but GD name missing" });
    expect(classifyAccountType(co("1", { gd_id: "9", gd_name: "X", is_group: "false" })).type).toBe("unknown");
  });

  it("only classes Single Franchise / Independent with an explicit non-GD flag", () => {
    expect(classifyAccountType(co("1", { type_of_dealership: "Franchise", is_group: "false" })).type).toBe("single_franchise");
    expect(classifyAccountType(co("1", { type_of_dealership: "Independent", is_group: "false" })).type).toBe("independent");
    expect(classifyAccountType(co("1", { type_of_dealership: "Franchise", is_group: null })))
      .toEqual({ type: "unknown", reason: "GD flag not set (cannot confirm non-group)" });
    expect(classifyAccountType(co("1", { type_of_dealership: "Franchise", is_group: null }), false).type).toBe("single_franchise");
    expect(classifyAccountType(co("1", { type_of_dealership: null, is_group: "false" })).reason).toBe("Type of Dealership missing");
    expect(classifyAccountType(co("1", { is_group: "Yes" })).reason).toBe("GD flag is Yes but no GD ID / name");
  });

  it("measures company and rooftop inactivity independently; a missing date is never 0 days", () => {
    const c = { last_activity_ms: NOW - 10 * DAY, last_contacted_ms: NOW - 10 * DAY };
    expect(companyStatus(c, NOW, 60, 90)).toBe("active");
    expect(rooftopStatus(NOW - 75 * DAY, NOW, 60, 90)).toBe("inactive_60");
    expect(rooftopStatus(NOW - 90 * DAY, NOW, 60, 90)).toBe("inactive_90");
    expect(companyStatus({ last_activity_ms: null, last_contacted_ms: null }, NOW, 60, 90)).toBe("no_activity");
    expect(rooftopStatus(null, NOW, 60, 90)).toBe("missing_date");
    // contradiction: contacted but no activity date
    expect(companyStatus({ last_activity_ms: null, last_contacted_ms: NOW }, NOW, 60, 90)).toBe("needs_review");
    expect(rooftopStatus(NOW + 5 * DAY, NOW, 60, 90)).toBe("needs_review");
    // thresholds are configurable
    expect(rooftopStatus(NOW - 40 * DAY, NOW, 30, 45)).toBe("inactive_60");
  });
});

describe("rows", () => {
  it("maps HubSpot records and drops undatable activities", () => {
    const r = companyRow("5", { name: " A ", team_accounts: "Prince", notes_last_updated: "2026-10-01T00:00:00Z", rooftop_last_activity: "", num_associated_contacts: "3" });
    expect(r.name).toBe("A");
    expect(r.team).toBe("Prince");
    expect(r.rooftop_last_activity_ms).toBeNull();
    expect(r.num_contacts).toBe(3);
    expect(activityRow("call", "1", { hs_timestamp: null }, ["5"], [], false)).toBeNull();
    const note = activityRow("note", "2", { hs_timestamp: String(NOW), hs_note_body: "<p>Hello&nbsp;<b>there</b></p>" }, ["5"], [], false);
    expect(note?.subject).toBe("Hello there");
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
  it("counts calls/connected/emails/meetings once and keeps ownership concepts separate", () => {
    const d = data({
      companies: [co("1"), co("2", { owner_id: "o2" })],
      contacts: [ct("c1", ["1"])],
      activities: [
        act("a1", { disposition: CONNECTED, contact_ids: ["c1"] }),
        act("a2", { disposition: NOT_CONNECTED }),
        act("a3", { type: "email", direction: "EMAIL", email_replied: true }),
        act("a4", { type: "email", direction: "INCOMING_EMAIL" }),           // not an outgoing touch
        act("a5", { type: "call", direction: "INBOUND" }),                    // not an outbound call
        act("a6", { type: "meeting", direction: null, meeting_outcome: "SCHEDULED" }),
        act("a7", { type: "note", direction: null }),
        act("a8", { company_ids: ["1", "2"], disposition: MEETING_DISP }),    // one call on two accounts
      ],
    });
    const prep = prepare(d);
    const accts = filterAccounts(prep, filters(), NOW);
    const one = accts.find((a) => a.p.row.hs_id === "1")!;
    expect(one.calls).toBe(3);
    expect(one.connected).toBe(2); // a1 + a8 (Meeting Scheduled is a connected disposition)
    expect(one.emails).toBe(1);
    expect(one.meetings).toBe(1);
    expect(one.meetingsCompleted).toBe(0); // scheduled is never counted as completed
    expect(one.notes).toBe(1);
    expect(one.touchpoints).toBe(5);
    const t = tally(accts);
    expect(t.calls).toBe(3); // a8 appears on both accounts but is one activity record
    expect(t.contacted).toBe(2);
    expect(t.meeting_disposition_calls).toBe(1);
    // account owner filter ≠ activity owner filter
    expect(filterAccounts(prep, filters({ owner: "o2" }), NOW).map((a) => a.p.row.hs_id)).toEqual(["2"]);
    expect(filterAccounts(prep, filters({ member: "rep1" }), NOW)).toHaveLength(2);
    expect(filterAccounts(prep, filters({ member: "nobody" }), NOW)).toHaveLength(0);
    const row = toListRow(one, prep);
    expect(row.owner_name).toBe("Owner One");
    expect(row.activity_owners).toEqual(["Rep One"]);
    expect(row.team).toBe("Neelima");
  });

  it("verifies Never Contacted against both HubSpot and the synced activity", () => {
    const d = data({
      companies: [
        co("1", { last_contacted_ms: null }),                                   // no touch → verified never contacted
        co("2", { last_contacted_ms: null }),                                   // touch exists → conflict, not "never"
      ],
      activities: [act("a1", { company_ids: ["2"] })],
    });
    const accts = filterAccounts(prepare(d), filters(), NOW);
    expect(accts.find((a) => a.p.row.hs_id === "1")!.neverContacted).toBe(true);
    const two = accts.find((a) => a.p.row.hs_id === "2")!;
    expect(two.neverContacted).toBe(false);
    expect(two.contactedConflict).toBe(true);
  });

  it("applies country default, team scope, and keeps KPI counts equal to drill-down lists", () => {
    const d = data({
      companies: [
        co("1"), co("2", { country: null }), co("3", { team: "Archit" }), co("4", { team: "Prince", type_of_dealership: "Independent" }),
        co("5", { gd_id: "7", gd_name: "G", is_group: "true" }), co("6", { gd_id: "7", gd_name: "G", is_group: "true" }),
        co("7", { last_activity_ms: NOW - 120 * DAY, rooftop_last_activity_ms: null }),
      ],
    });
    const prep = prepare(d);
    const accts = filterAccounts(prep, filters(), NOW);
    expect(accts.map((a) => a.p.row.hs_id).sort()).toEqual(["1", "4", "5", "6", "7"]); // no blank-country, no Archit
    expect(filterAccounts(prep, filters({ country: "all" }), NOW)).toHaveLength(6);
    const t = tally(accts);
    expect(t.group).toBe(2);
    expect(t.unique_gds).toBe(1);
    expect(t.independent).toBe(1);
    expect(t.single_franchise + t.independent + t.group + t.unknown).toBe(t.accounts); // categories never overlap
    expect(t.c_inactive_90).toBe(1);
    expect(t.r_missing_date).toBe(1);
    for (const [key, n] of [["type:group", t.group], ["cstatus:inactive_90", t.c_inactive_90], ["rstatus:missing_date", t.r_missing_date], ["not_contacted", t.touch_0]] as const) {
      expect(accts.filter((a) => drillMatch(a, key, prep))).toHaveLength(n);
    }
    const prince = filterAccounts(prep, filters({ teams: ["Prince"] }), NOW);
    expect(prince.map((a) => a.p.row.hs_id)).toEqual(["4"]);
  });

  it("counts demos per deal once and never treats booked as completed", () => {
    const d = data({
      companies: [co("1"), co("2")],
      deals: [
        { hs_id: "d1", stage_key: "discovery_done", deal_owner_id: "ae", sdr_owner_id: "rep1", company_ids: ["1", "2"], demo_booked_ms: NOW - 3 * DAY, demo_completed_ms: null },
        { hs_id: "d2", stage_key: "demo_done", deal_owner_id: "ae", sdr_owner_id: "rep1", company_ids: ["1"], demo_booked_ms: NOW - 200 * DAY, demo_completed_ms: NOW - 1 * DAY },
      ],
    });
    const prep = prepare(d);
    const t = tally(filterAccounts(prep, filters(), NOW));
    expect(t.demos_booked).toBe(1);     // d1 sits on two accounts → one deal
    expect(t.demos_completed).toBe(1);  // d2 completed in period; its booking was outside the period
    expect(t.accounts_with_demo).toBe(2);
    const view = computeView(prep, filters(), "meetings", { drill: "", sort: "", dir: "asc", page: 1, pageSize: 50 }, NOW) as { demos_by_sdr: { owner_id: string; booked: number; completed: number }[] };
    expect(view.demos_by_sdr).toEqual([{ owner_id: "rep1", name: "Rep One", booked: 1, completed: 1 }]);
  });

  it("flags roster-pod vs assigned-team mismatches without reassigning anything", () => {
    const d = data({
      companies: [co("1", { owner_id: "rep1", team: "Prince" }), co("2", { owner_id: "o1" })],
    });
    const prep = prepare(d);
    const q = computeView(prep, filters(), "quality", { drill: "", sort: "", dir: "asc", page: 1, pageSize: 50 }, NOW) as { checks: { key: string; count: number }[] };
    const count = (k: string) => q.checks.find((c) => c.key === k)!.count;
    expect(count("owner_pod_mismatch")).toBe(1);   // rep1 is a neelima-pod rep on a Prince account
    expect(count("owner_not_on_roster")).toBe(1);  // o1 is not a tracked rep
    expect(DQ_CHECKS.length).toBe(q.checks.length);
    expect(prep.byId.get("1")!.row.team).toBe("Prince"); // team untouched
  });

  it("finds accounts by contact name, email or phone digits", () => {
    const d = data({ companies: [co("1"), co("2")], contacts: [ct("c1", ["1"], { first_name: "Dana", email: "dana@dealer.com" })] });
    const prep = prepare(d);
    expect(filterAccounts(prep, filters({ contactQ: "dana" }), NOW).map((a) => a.p.row.hs_id)).toEqual(["1"]);
    expect(filterAccounts(prep, filters({ contactQ: "555-010" }), NOW)).toHaveLength(1);
    expect(filterAccounts(prep, filters({ contactQ: "nobody" }), NOW)).toHaveLength(0);
  });
});

describe("params", () => {
  it("defaults to USA, all four teams, the last 3 months and 60/90 thresholds", () => {
    const p = parseRequest(new URLSearchParams(""), NOW, NOW - 180 * DAY);
    expect(p.filters.country).toBe("USA");
    expect(p.filters.teams).toEqual([]);
    expect(p.filters.inactiveDays).toBe(60);
    expect(p.filters.deepInactiveDays).toBe(90);
    expect(p.view).toBe("summary");
    expect(p.filters.activityFrom).toBe(resolveRange("3m", null, null, NOW).fromMs);
  });

  it("rejects unknown teams and warns about ranges outside the synced window", () => {
    const p = parseRequest(new URLSearchParams("teams=Prince,Archit,bogus&ppreset=custom&pfrom=2025-01-01&pto=2025-02-01&inact=90&deep=60"), NOW, NOW - 180 * DAY);
    expect(p.filters.teams).toEqual(["Prince"]);
    expect(p.warnings.some((w) => w.includes("synced window"))).toBe(true);
    expect(p.filters.deepInactiveDays).toBe(91);
  });

  it("resolves ET presets", () => {
    const r = resolveRange("7d", null, null, NOW);
    expect(r.toMs! - r.fromMs!).toBe(7 * DAY);
    expect(resolveRange("any", null, null, NOW)).toEqual({ fromMs: null, toMs: null });
  });

  it("escapes CSV and neutralizes formula injection", () => {
    const csv = toCsv("contacts", [{ id: "1", name: "=HYPERLINK(\"x\")", activity_owners: ["A", "B"], last_activity_ms: null }]);
    expect(csv.split("\n")[1]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain("\"A; B\"");
  });
});
