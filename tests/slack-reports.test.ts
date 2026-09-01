import { describe, it, expect } from "vitest";
import { buildCallBlitzReport } from "../lib/slackReports/callBlitz";
import { Activity } from "../lib/sync/types";
import {
  CALLBACK_HIGH_GUID, CALLBACK_LOW_GUID, NOT_INTERESTED_GUID, GAVE_REFERRAL_GUID,
  MEETING_SCHEDULED_GUID, MEETING_RESCHEDULED_GUID,
} from "../config/dispositions";

const CONNECTED = "f240bbac-87c9-4f6e-bf70-924b57d47db7"; // "Connected"
const NO_ANSWER = "9afcb440-c2c4-44a7-9eb5-8f63e4896aeb"; // "NC - No Answer"

let seq = 0;
function call(over: Partial<Activity> = {}): Activity {
  seq++;
  return {
    id: `c${seq}`, type: "call", ownerId: "rep1", timestampMs: 1_000_000 + seq * 1000,
    disposition: NO_ANSWER, emailStatus: null, emailOpened: false, emailReplied: false,
    emailClicked: false, contactIds: [], companyIds: [], ...over,
  };
}
function email(over: Partial<Activity> = {}): Activity {
  seq++;
  return {
    id: `e${seq}`, type: "email", ownerId: "rep1", timestampMs: 1_000_000 + seq * 1000,
    disposition: null, emailStatus: "SENT", emailOpened: false, emailReplied: false,
    emailClicked: false, contactIds: [], companyIds: [], ...over,
  };
}

const NAMES = { rep1: "Prabhjeet", rep2: "Rahul" };

describe("buildCallBlitzReport", () => {
  it("Total Touches = Calls + Emails, never anything else", () => {
    const report = buildCallBlitzReport(
      [call(), call(), email(), email(), email()],
      {}, ["rep1"], NAMES, "2026-08-31", "Vaibhav's Team",
    );
    const row = report.rows[0];
    expect(row.calls).toBe(2);
    expect(row.emails).toBe(3);
    expect(row.totalTouches).toBe(5);
  });

  it("maps each disposition to exactly one narrow column, no double counting", () => {
    const report = buildCallBlitzReport(
      [
        call({ disposition: CONNECTED }),
        call({ disposition: CALLBACK_HIGH_GUID }),
        call({ disposition: CALLBACK_LOW_GUID }),
        call({ disposition: NOT_INTERESTED_GUID }),
        call({ disposition: GAVE_REFERRAL_GUID }),
        call({ disposition: MEETING_SCHEDULED_GUID }),
        call({ disposition: MEETING_RESCHEDULED_GUID }),
      ],
      {}, ["rep1"], NAMES, "2026-08-31", "Vaibhav's Team",
    );
    const row = report.rows[0];
    expect(row.calls).toBe(7);
    // Every disposition used here is in CONNECTED_DISPOSITIONS — "connected" just means a human
    // was reached, so even the rejection/referral outcomes count (config/dispositions.ts).
    expect(row.connectedCalls).toBe(7);
    expect(row.highIntent).toBe(1);
    expect(row.lowIntent).toBe(1);
    expect(row.notInterested).toBe(1);
    expect(row.referral).toBe(1);
    // Meeting = Scheduled OR Rescheduled — broader than the dashboard's Scheduled-only meetings_booked.
    expect(row.meetings).toBe(2);
  });

  it("folds in deal-stage demos separately from call dispositions", () => {
    const report = buildCallBlitzReport([call()], { rep1: 3 }, ["rep1"], NAMES, "2026-08-31", "Team");
    expect(report.rows[0].demos).toBe(3);
  });

  it("team totals sum every column, and totalTouches is computed from the summed calls/emails", () => {
    const report = buildCallBlitzReport(
      [
        call({ ownerId: "rep1" }), call({ ownerId: "rep1" }), email({ ownerId: "rep1" }),
        call({ ownerId: "rep2" }), email({ ownerId: "rep2" }), email({ ownerId: "rep2" }),
      ],
      { rep1: 1, rep2: 2 }, ["rep1", "rep2"], NAMES, "2026-08-31", "Team",
    );
    expect(report.totals.calls).toBe(3);
    expect(report.totals.emails).toBe(3);
    expect(report.totals.totalTouches).toBe(6);
    expect(report.totals.demos).toBe(3);
  });

  it("zero-activity reps still produce a valid all-zero row (matches dashboard behavior)", () => {
    const report = buildCallBlitzReport([], {}, ["rep1"], NAMES, "2026-08-31", "Team");
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ calls: 0, emails: 0, totalTouches: 0, demos: 0 });
  });
});
