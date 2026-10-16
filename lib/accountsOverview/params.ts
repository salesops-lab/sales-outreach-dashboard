/** Query-string ⇄ AoFilters (pure; shared by the API routes and tests) + CSV serialization. */
import { AO_TEAMS } from "../../config/accounts-overview";
import { resolveRange } from "./ranges";
import { AoActivityType, AoFilters, DateRange, DealerTypeFilter } from "./types";
import { AO_VIEWS, AoView, ListOpts } from "./views";

const ACTS: AoActivityType[] = ["call", "email", "meeting", "note", "task"];
const DEALER: DealerTypeFilter[] = ["all", "franchise", "independent", "none"];

/** Last Activity Date filter: a preset/custom range, or "none" = only accounts with NO date. */
function dateFilter(sp: URLSearchParams, prefix: string, nowMs: number): DateRange | null {
  const preset = sp.get(`${prefix}preset`) ?? "any";
  if (preset === "any") return null;
  if (preset === "none") return { fromMs: 0, toMs: 0, includeMissing: true };
  const r = resolveRange(preset, sp.get(`${prefix}from`), sp.get(`${prefix}to`), nowMs);
  if (r.fromMs == null && r.toMs == null) return null;
  return r;
}

export interface ParsedRequest {
  filters: AoFilters; view: AoView; list: ListOpts; csv: boolean; warnings: string[];
}

export function parseRequest(sp: URLSearchParams, nowMs: number, windowStartMs: number | null): ParsedRequest {
  const warnings: string[] = [];
  const teamVals = new Set<string>(AO_TEAMS.map((t) => t.value));
  const teams = (sp.get("teams") ?? "").split(",").map((s) => s.trim()).filter((s) => teamVals.has(s));
  const activityTypes = (sp.get("atypes") ?? "").split(",").filter((s): s is AoActivityType => ACTS.includes(s as AoActivityType));
  const dealer = sp.get("dtype") as DealerTypeFilter | null;

  const periodPreset = sp.get("ppreset") ?? "3m";
  let { fromMs, toMs } = resolveRange(periodPreset === "any" ? "3m" : periodPreset, sp.get("pfrom"), sp.get("pto"), nowMs);
  if (fromMs == null || toMs == null) {
    warnings.push("Custom date range incomplete — using Last 3 Months.");
    ({ fromMs, toMs } = resolveRange("3m", null, null, nowMs));
  }
  if (windowStartMs != null && fromMs! < windowStartMs) {
    warnings.push(`Activity before ${new Date(windowStartMs).toISOString().slice(0, 10)} is not synced, so it is not counted.`);
  }

  const filters: AoFilters = {
    teams,
    member: sp.get("member") || null,
    country: sp.get("country") || "USA",
    state: sp.get("state") || "all",
    gdName: (sp.get("gd") ?? "").slice(0, 200),
    dealerType: dealer && DEALER.includes(dealer) ? dealer : "all",
    owner: sp.get("owner") || null,
    companyDate: dateFilter(sp, "c", nowMs),
    q: (sp.get("q") ?? "").slice(0, 200),
    activityTypes,
    activityFrom: fromMs!, activityTo: toMs!,
  };
  const v = sp.get("view") as AoView | null;
  const view: AoView = v && (AO_VIEWS as readonly string[]).includes(v) ? v : "accounts";
  const list: ListOpts = {
    drill: sp.get("drill") ?? "",
    sort: sp.get("sort") ?? "",
    dir: sp.get("dir") === "desc" ? "desc" : "asc",
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("size")) || 50,
  };
  return { filters, view, list, csv: sp.get("format") === "csv", warnings };
}

// ── CSV ───────────────────────────────────────────────────────────────────────
const etStamp = (ms: unknown) => (typeof ms === "number"
  ? new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "");

/** Account-list CSV columns: [header, field, kind]. `ms` columns render in US/Eastern. */
export const CSV_COLUMNS: [string, string, ("ms" | "list")?][] = [
  ["HubSpot Record ID", "id"], ["Company", "name"], ["Domain", "domain"], ["Country", "country"], ["State", "state"], ["City", "city"],
  ["Team", "team"], ["Account Owner", "owner_name"], ["Worked By (period)", "activity_owners", "list"],
  ["Account Type", "type"], ["GD Name", "gd_name"], ["Company ICP", "icp"],
  ["Last Activity Date (ET)", "company_last_activity_ms", "ms"], ["Days Since Last Activity", "company_days"],
  ["Never Contacted", "never_contacted"],
  ["Calls", "calls"], ["Connected", "connected"], ["Emails", "emails"], ["Meetings", "meetings"],
  ["Demos Booked", "demos_booked"], ["Touchpoints", "touchpoints"], ["Contacts", "contacts"],
];

export function toCsv(rows: object[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Neutralize spreadsheet formula injection from CRM free text.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) => CSV_COLUMNS.map(([, field, kind]) => {
    const v = (r as Record<string, unknown>)[field];
    if (kind === "ms") return esc(etStamp(v));
    if (kind === "list") return esc(Array.isArray(v) ? v.join("; ") : v);
    return esc(v);
  }).join(","));
  return [CSV_COLUMNS.map(([h]) => esc(h)).join(","), ...lines].join("\n");
}
