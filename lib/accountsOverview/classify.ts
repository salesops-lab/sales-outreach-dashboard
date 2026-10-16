/** Accounts Overview — pure per-record classifiers (no I/O; unit-tested). Every rule here maps to
 *  a verified HubSpot property; anything missing or contradictory is surfaced, never guessed. */
import { AccountType, AoCompanyRow, IcpStatus, InactivityStatus } from "./types";

const DAY_MS = 86_400_000;
const blank = (s: string | null | undefined) => !s || !s.trim();

/** Free-text `country` → a stable label. HubSpot holds "united states", "us", "usa" etc. for the
 *  same country; empty stays "Unknown" (never defaulted to USA). */
export function normalizeCountry(raw: string | null | undefined): string {
  if (blank(raw)) return "Unknown";
  const s = raw!.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (["us", "usa", "united states", "united states of america", "america"].includes(s)) return "USA";
  if (["ca", "can", "canada"].includes(s)) return "Canada";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Company `icp` (string; live values "yes"/"no"/empty). Anything else → unknown. */
export function companyIcp(raw: string | null | undefined): IcpStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "yes" || s === "true") return "yes";
  if (s === "no" || s === "false") return "no";
  return "unknown";
}

/** Contact `icp_non_icp` (enum "ICP" / "Non ICP"). Separate from the company ICP. */
export function contactIcp(raw: string | null | undefined): IcpStatus {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "icp") return "yes";
  if (s === "non icp") return "no";
  return "unknown";
}

/** The HubSpot "GD Name" property (`gd_name`) — the one field the account-type rule keys on. */
export const gdNameOf = (c: AoCompanyRow) => c.gd_name?.trim() || null;

/** Unique-GD key: the GD Name, case-insensitive. */
export function gdKeyOf(c: AoCompanyRow): string | null {
  const g = gdNameOf(c);
  return g ? g.toLowerCase() : null;
}

export interface TypeVerdict { type: AccountType; reason: string | null }

/**
 * Account type — the same filters a user would apply in HubSpot:
 *  - Group Dealership: GD Name is set.
 *  - Single Franchise: GD Name empty + Type of Dealership = Franchise.
 *  - Single Independent: GD Name empty + Type of Dealership = Independent.
 *  - Unknown: GD Name empty and Type of Dealership empty.
 */
export function classifyAccountType(c: AoCompanyRow): TypeVerdict {
  if (gdNameOf(c)) return { type: "group", reason: null };
  const t = (c.type_of_dealership ?? "").trim().toLowerCase();
  if (t === "franchise") return { type: "single_franchise", reason: null };
  if (t === "independent") return { type: "independent", reason: null };
  return { type: "unknown", reason: "GD Name and Type of Dealership both empty" };
}

/** Whole elapsed days (floor of 24h units between absolute instants — timezone-independent), the
 *  same rule for the company and the rooftop date. */
export function daysSince(ms: number | null, nowMs: number): number | null {
  if (ms == null) return null;
  return Math.floor((nowMs - ms) / DAY_MS);
}

/** Company inactivity from HubSpot's Last Activity Date (+ Last Contacted for consistency). */
export function companyStatus(
  c: Pick<AoCompanyRow, "last_activity_ms" | "last_contacted_ms">, nowMs: number, inactiveDays: number, deepDays: number,
): InactivityStatus {
  const la = c.last_activity_ms;
  if (la == null) {
    // Last Contacted ⊂ Last Activity in HubSpot's definitions — contacted-but-no-activity is contradictory.
    return c.last_contacted_ms != null ? "needs_review" : "no_activity";
  }
  return byDays(la, nowMs, inactiveDays, deepDays);
}

/** Rooftop inactivity from the custom Rooftop Last Activity property — independent of the company date. */
export function rooftopStatus(ms: number | null, nowMs: number, inactiveDays: number, deepDays: number): InactivityStatus {
  if (ms == null) return "missing_date";
  return byDays(ms, nowMs, inactiveDays, deepDays);
}

function byDays(ms: number, nowMs: number, inactiveDays: number, deepDays: number): InactivityStatus {
  if (ms > nowMs + DAY_MS) return "needs_review"; // future-dated
  const d = Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
  if (d >= deepDays) return "inactive_90";
  if (d >= inactiveDays) return "inactive_60";
  return "active";
}

export const STATUS_LABEL: Record<InactivityStatus, string> = {
  active: "Active",
  inactive_60: "Inactive 60+",
  inactive_90: "Inactive 90+",
  no_activity: "No Recorded Activity",
  missing_date: "Missing Activity Date",
  needs_review: "Needs Review",
};

export const TYPE_LABEL: Record<AccountType, string> = {
  single_franchise: "Single Franchise",
  independent: "Single Independent",
  group: "Group Dealership",
  unknown: "Unknown",
};
