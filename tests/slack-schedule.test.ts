import { describe, it, expect } from "vitest";
import { cleanSchedule, DEFAULT_SLOTS, dueSlots, GRACE_MS, nextSend, ReportSchedule, zonedToUtc } from "../lib/slackReports/schedule";
import { formatCallBlitzMessage } from "../lib/slackReports/format";

const IST = "Asia/Kolkata";
const sched = (p: Partial<ReportSchedule> = {}): ReportSchedule => ({ enabled: true, days: [1, 2, 3, 4, 5], slots: DEFAULT_SLOTS, tz: IST, ...p });
const ist = (y: number, m: number, d: number, h: number, min: number) => zonedToUtc(IST, y, m, d, h, min);

describe("slack report schedule", () => {
  it("converts IST wall-clock time to UTC (+05:30, no DST)", () => {
    expect(new Date(ist(2026, 10, 19, 21, 30)).toISOString()).toBe("2026-10-19T16:00:00.000Z");
  });

  it("fires the three IST slots for ONE US working day (Monday ET)", () => {
    // Mon 19 Oct 2026: 9:30 PM IST = 12:00 PM ET Mon; Tue 00:30 IST = 3:00 PM ET Mon; Tue 02:55 IST = 5:25 PM ET Mon
    const at = (ms: number) => dueSlots(sched(), ms).map((s) => [s.slotKey, s.label]);
    expect(at(ist(2026, 10, 19, 21, 30))).toEqual([["2026-10-19@21:30", "Call Blitz-1"]]);
    expect(at(ist(2026, 10, 20, 0, 31))).toEqual([["2026-10-19@00:30", "Call Blitz-2"]]);
    expect(at(ist(2026, 10, 20, 2, 55))).toEqual([["2026-10-19@02:55", "Final Report"]]);
    expect(at(ist(2026, 10, 19, 21, 29))).toEqual([]);                 // a minute early
    expect(at(ist(2026, 10, 19, 21, 30) + GRACE_MS)).toEqual([]);      // past the grace window
  });

  it("skips US weekends: Saturday-night IST slots belong to Saturday ET", () => {
    expect(dueSlots(sched(), ist(2026, 10, 24, 21, 30))).toEqual([]); // Sat 24 Oct
    expect(dueSlots(sched(), ist(2026, 10, 25, 2, 55))).toEqual([]);  // Sun 02:55 IST = Sat ET
    // …but Friday ET's final report lands on Saturday morning IST and still sends
    expect(dueSlots(sched(), ist(2026, 10, 24, 2, 55)).map((s) => s.slotKey)).toEqual(["2026-10-23@02:55"]);
  });

  it("does nothing when the schedule is off", () => {
    expect(dueSlots(sched({ enabled: false }), ist(2026, 10, 19, 21, 30))).toEqual([]);
  });

  it("next send rolls over to the next working day", () => {
    const n = nextSend(sched(), ist(2026, 10, 20, 3, 0)); // after Monday ET's final report
    expect(n?.label).toBe("Call Blitz-1");
    expect(n?.slotMs).toBe(ist(2026, 10, 20, 21, 30));
    expect(nextSend(sched({ enabled: false }), Date.now())).toBeNull();
  });

  it("cleans user input: drops bad times, orders evening-first, turns off when empty", () => {
    const c = cleanSchedule({ enabled: true, days: [5, 1, 1, 9], tz: IST, slots: [
      { time: "02:55", label: " Final " }, { time: "25:00", label: "bad" }, { time: "21:30", label: "" },
    ] });
    expect(c.days).toEqual([1, 5]);
    expect(c.slots).toEqual([{ time: "21:30", label: "Update" }, { time: "02:55", label: "Final" }]);
    expect(c.enabled).toBe(true);
    expect(cleanSchedule({ enabled: true, days: [], slots: DEFAULT_SLOTS }).enabled).toBe(false);
  });

  it("titles a scheduled send with its own name", () => {
    const report = { reportDateEt: "2026-10-19", teamName: "Vaibhav", rows: [], totals: {} } as never;
    expect(formatCallBlitzMessage(report, { label: "Call Blitz-1" }).text).toMatch(/^📊 CALL BLITZ-1\n/);
    expect(formatCallBlitzMessage(report, { label: "Final Report" }).text).toMatch(/^📊 FINAL REPORT\n/);
    expect(formatCallBlitzMessage(report).text).toContain("📊 CALL BLITZ REPORT\n");
  });
});
