/** Pure scheduling-window check — no I/O, so unit-testable and safe to import anywhere. Split out
 *  of scheduler.ts because that module imports the server-only Supabase admin client, which vitest
 *  cannot load (see CLAUDE.md: never import a server-only-guarded module from a test). */
import { ReportSchedule } from "./types";

const DEFAULT_TOLERANCE_MINUTES = 10; // matches the heartbeat's fire-check cadence

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/** Civil (year,month,day,weekday 0=Sun..6=Sat,hour,minute) for `nowMs` in the given IANA tz. */
function wallClockParts(nowMs: number, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(nowMs)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay(); // 0=Sun..6=Sat
  return { year: parts.year, month: parts.month, day: parts.day, weekday, hour: parts.hour, minute: parts.minute };
}

/** Is `report` due right now, and if so what's its idempotency slot key ("YYYY-MM-DDTHH:MM" in the
 *  report's configured tz)? Returns null if not due. Pure — no I/O. */
export function dueSlotFor(
  report: { timezone: string; schedule: ReportSchedule },
  nowMs: number,
  toleranceMinutes = DEFAULT_TOLERANCE_MINUTES,
): string | null {
  const p = wallClockParts(nowMs, report.timezone);
  if (!report.schedule.daysOfWeek.includes(p.weekday)) return null;
  const nowMinutes = p.hour * 60 + p.minute;
  const ymd = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  for (const t of [report.schedule.time1, report.schedule.time2]) {
    if (!t) continue;
    const [h, m] = t.split(":").map(Number);
    const schedMinutes = h * 60 + m;
    if (nowMinutes >= schedMinutes && nowMinutes < schedMinutes + toleranceMinutes) {
      return `${ymd}T${t}`;
    }
  }
  return null;
}
