/** Query-string ⇄ AoFilters (pure; shared by the API routes and tests) + CSV serialization. */
import { AO_TEAMS } from "../../config/accounts-overview";
import { resolveRange as resolveRange, lastQuarter } from "./ranges";
import { AoActivityType, AoFilters, DateRange, DealerTypeFilter, IcpFilter } from "./types";
import { AO_VIEWS, AoView, DealOpts, ListOpts } from "./views";

const ACTS: AoActivityType[] = ["call", "email", "meeting", "note", "task"];
const DEALER: DealerTypeFilter[] = ["all", "franchise", "independent", "none"];
const ICP: IcpFilter[] = ["all", "yes", "no", "unknown"];

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
  filters: AoFilters; view: AoView; list: ListOpts; deal: DealOpts; csv: boolean; warnings: string[];
}

export function parseRequest(sp: URLSearchParams, nowMs: number, windowStartMs: number | null): ParsedRequest {
  const warnings: string[] = [];
  const teamVals = new Set<string>(AO_TEAMS.map((t) => t.value));
  const teams = (sp.get("teams") ?? "").split(",").map((s) => s.trim()).filter((s) => teamVals.has(s));
  const activityTypes = (sp.get("atypes") ?? "").split(",").filter((s): s is AoActivityType => ACTS.includes(s as AoActivityType));
  const dealer = sp.get("dtype") as DealerTypeFilter | null;

  // Activity date range — default: everything the sync holds (no filter applied).
  const periodPreset = sp.get("ppreset") ?? "all";
  const allSynced = { fromMs: windowStartMs ?? 0, toMs: nowMs + 86_400_000 };
  let { fromMs, toMs } = periodPreset === "all" || periodPreset === "any" ? allSynced
    : periodPreset === "lq" ? lastQuarter(nowMs)
    : resolveRange(periodPreset, sp.get("pfrom"), sp.get("pto"), nowMs);
  if (fromMs == null || toMs == null) {
    warnings.push("Custom date range incomplete — showing all synced activity.");
    ({ fromMs, toMs } = allSynced);
  }
  if (windowStartMs != null && periodPreset !== "all" && fromMs! < windowStartMs) {
    warnings.push(`Activity before ${new Date(windowStartMs).toISOString().slice(0, 10)} is not synced, so it is not counted.`);
  }

  const filters: AoFilters = {
    teams,
    country: sp.get("country") || "all",
    state: sp.get("state") || "all",
    gdName: (sp.get("gd") ?? "").slice(0, 200),
    dealerType: dealer && DEALER.includes(dealer) ? dealer : "all",
    owner: sp.get("owner") || null,
    icp: ICP.includes(sp.get("icp") as IcpFilter) ? (sp.get("icp") as IcpFilter) : "all",
    companyDate: dateFilter(sp, "c", nowMs),
    q: (sp.get("q") ?? "").slice(0, 200),
    activityTypes,
    activityFrom: fromMs!, activityTo: toMs!, activityDefault: periodPreset === "all" || periodPreset === "any",
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
  const kind = sp.get("dkind");
  const deal: DealOpts = {
    team: sp.get("dteam") ?? "", owner: sp.get("downer") ?? "",
    kind: kind === "booked" || kind === "conducted" ? kind : "all",
  };
  return { filters, view, list, deal, csv: sp.get("format") === "csv", warnings };
}

// ── CSV ───────────────────────────────────────────────────────────────────────
const etStamp = (ms: unknown) => (typeof ms === "number"
  ? new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "");

/** Account-list CSV columns: [header, field, kind]. `ms` columns render in US/Eastern. */
export const CSV_COLUMNS: [string, string, ("ms" | "list")?][] = [
  ["HubSpot Record ID", "id"], ["Company", "name"], ["Domain", "domain"], ["Country", "country"], ["State", "state"], ["City", "city"],
  ["Team", "team"], ["Account Owner", "owner_name"], ["Worked By (period)", "activity_owners", "list"],
  ["Account Type", "type"], ["Type of Dealership", "dealer_type"], ["GD Name", "gd_name"], ["#Potential Rooftops", "potential_rooftops"], ["Company ICP", "icp"],
  ["Last Activity Date (ET)", "company_last_activity_ms", "ms"], ["Days Since Last Activity", "company_days"],
  ["Rooftop Last Activity (ET)", "rooftop_last_activity_ms", "ms"], ["Days Since Rooftop Last Activity", "rooftop_days"],
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
