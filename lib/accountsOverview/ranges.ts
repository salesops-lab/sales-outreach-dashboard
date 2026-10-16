/** Date-range presets in US/Eastern (the portal timezone the rest of the dashboard uses). Pure. */
import { etDateStr, etDayStartMs } from "../sync/buckets";

export const RANGE_PRESETS = ["7d", "30d", "60d", "90d", "3m", "custom", "any"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** [fromMs, toMs) for a preset. "Last N days" = today + the previous N−1 ET days (HubSpot's
 *  convention); "3m" = same ET calendar day three months ago → end of today. "any" = unbounded. */
export function resolveRange(preset: string, from: string | null, to: string | null, nowMs: number): { fromMs: number | null; toMs: number | null } {
  const today = etDateStr(nowMs);
  const end = etDayStartMs(today, 1);
  const m = /^(\d+)d$/.exec(preset);
  if (m) return { fromMs: etDayStartMs(today, -(Number(m[1]) - 1)), toMs: end };
  if (preset === "3m") {
    const [y, mo, d] = today.split("-").map(Number);
    const t = new Date(Date.UTC(y, mo - 1 - 3, d));
    return { fromMs: etDayStartMs(t.toISOString().slice(0, 10)), toMs: end };
  }
  if (preset === "custom") {
    const ok = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    return { fromMs: ok(from) ? etDayStartMs(from!) : null, toMs: ok(to) ? etDayStartMs(to!, 1) : null };
  }
  return { fromMs: null, toMs: null };
}
