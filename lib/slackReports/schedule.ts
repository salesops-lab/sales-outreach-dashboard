/**
 * Slack report schedule — pure, I/O-free, unit-tested.
 *
 * A schedule is a list of local clock times (in `tz`, default IST) plus the US/Eastern weekdays it
 * runs on. Days are keyed to the ET date because the report itself covers the dashboard's ET "today":
 * the 9:30 PM / 12:30 AM / 2:55 AM IST slots all fall inside ONE US working day (e.g. Monday ET),
 * even though the last two are Tuesday in India. So "Mon–Fri" means Mon–Fri US business days.
 *
 * The scheduler pings `dueSlots` every minute; a slot is due from its time until GRACE_MS later
 * (so a late ping still sends), and its `slotKey` (ET date + time) is claimed once in the run log,
 * so it never sends twice.
 */

export interface ScheduleSlot { time: string; label: string } // time = "HH:MM" (24h, in tz)
export interface ReportSchedule {
  enabled: boolean;
  days: number[];        // ET weekdays, 1 = Mon … 7 = Sun
  slots: ScheduleSlot[];
  tz: string;            // IANA zone the slot times are written in
}

export const DEFAULT_TZ = "Asia/Kolkata";
export const DEFAULT_SLOTS: ScheduleSlot[] = [
  { time: "21:30", label: "Call Blitz-1" },
  { time: "00:30", label: "Call Blitz-2" },
  { time: "02:55", label: "Final Report" },
];
export const DEFAULT_SCHEDULE: ReportSchedule = { enabled: false, days: [1, 2, 3, 4, 5], slots: DEFAULT_SLOTS, tz: DEFAULT_TZ };
export const GRACE_MS = 45 * 60_000;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const DAY = 86_400_000;

/** Wall-clock parts of an instant in a zone. */
function partsIn(tz: string, ms: number) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return {
    y: Number(get("year")), m: Number(get("month")), d: Number(get("day")),
    h: Number(get("hour")), min: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday") as (typeof WEEKDAYS)[number]) + 1,
  };
}

/** The UTC instant of local wall-clock y-m-d hh:mm in `tz` (DST-safe: one correction pass). */
export function zonedToUtc(tz: string, y: number, m: number, d: number, h: number, min: number): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = partsIn(tz, guess);
  const asLocal = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  const first = guess - (asLocal - guess);
  const p2 = partsIn(tz, first);
  const asLocal2 = Date.UTC(p2.y, p2.m - 1, p2.d, p2.h, p2.min);
  return first - (asLocal2 - guess);
}

export const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

const etDate = (ms: number) => {
  const p = partsIn("America/New_York", ms);
  return { date: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, weekday: p.weekday };
};

export interface DueSlot { slotKey: string; label: string; time: string; slotMs: number; etDate: string }

/** Slots that should send at `nowMs` (inside [slot time, slot time + GRACE)). */
export function dueSlots(s: ReportSchedule, nowMs: number): DueSlot[] {
  if (!s.enabled) return [];
  const tz = s.tz || DEFAULT_TZ;
  const out: DueSlot[] = [];
  for (const slot of s.slots) {
    if (!validTime(slot.time)) continue;
    const [h, min] = slot.time.split(":").map(Number);
    // the slot today or yesterday (local) — yesterday covers a just-past-midnight ping
    for (const back of [0, 1]) {
      const l = partsIn(tz, nowMs - back * DAY);
      const slotMs = zonedToUtc(tz, l.y, l.m, l.d, h, min);
      if (nowMs < slotMs || nowMs >= slotMs + GRACE_MS) continue;
      const et = etDate(slotMs);
      if (!s.days.includes(et.weekday)) continue;
      out.push({ slotKey: `${et.date}@${slot.time}`, label: slot.label, time: slot.time, slotMs, etDate: et.date });
    }
  }
  return out;
}

/** The next send time after `nowMs` (for the "Next send" hint), or null. */
export function nextSend(s: ReportSchedule, nowMs: number): { slotMs: number; label: string } | null {
  if (!s.enabled || !s.slots.some((x) => validTime(x.time)) || !s.days.length) return null;
  const tz = s.tz || DEFAULT_TZ;
  let best: { slotMs: number; label: string } | null = null;
  for (let back = 0; back <= 8; back++) {
    const l = partsIn(tz, nowMs + back * DAY);
    for (const slot of s.slots) {
      if (!validTime(slot.time)) continue;
      const [h, min] = slot.time.split(":").map(Number);
      const slotMs = zonedToUtc(tz, l.y, l.m, l.d, h, min);
      if (slotMs <= nowMs || !s.days.includes(etDate(slotMs).weekday)) continue;
      if (!best || slotMs < best.slotMs) best = { slotMs, label: slot.label };
    }
    if (best) return best;
  }
  return best;
}

/** Normalise user input: valid HH:MM only, sorted by send order within a working day (evening
 *  first, then after-midnight), labels trimmed, days 1–7 unique. */
export function cleanSchedule(input: Partial<ReportSchedule>): ReportSchedule {
  const tz = input.tz || DEFAULT_TZ;
  const order = (t: string) => { const [h, m] = t.split(":").map(Number); return ((h < 12 ? h + 24 : h) * 60) + m; };
  const slots = (input.slots ?? [])
    .map((x) => ({ time: (x.time ?? "").trim(), label: (x.label ?? "").trim() || "Update" }))
    .filter((x) => validTime(x.time))
    .sort((a, b) => order(a.time) - order(b.time));
  const days = [...new Set((input.days ?? []).map(Number).filter((d) => d >= 1 && d <= 7))].sort();
  return { enabled: !!input.enabled && slots.length > 0 && days.length > 0, days, slots, tz };
}

export const fmtSlotTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
export const tzLabel = (tz: string) => (tz === "Asia/Kolkata" ? "IST" : tz === "America/New_York" ? "ET" : tz);
