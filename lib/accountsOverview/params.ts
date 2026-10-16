/** Query-string ⇄ AoFilters (pure; shared by the API routes and tests) + CSV serialization. */
import { AO_DEEP_INACTIVE_DAYS, AO_INACTIVE_DAYS, AO_TEAMS } from "../../config/accounts-overview";
import { resolveRange } from "./ranges";
import { AccountType, AoActivityType, AoFilters, DateRange, IcpStatus } from "./types";
import { AO_VIEWS, AoView, ListOpts } from "./views";

const TYPES: AccountType[] = ["single_franchise", "independent", "group", "unknown"];
const ICPS: IcpStatus[] = ["yes", "no", "unknown"];
const ACTS: AoActivityType[] = ["call", "email", "meeting", "note", "task"];

function dateFilter(sp: URLSearchParams, prefix: string, nowMs: number): DateRange | null {
  const preset = sp.get(`${prefix}preset`) ?? "any";
  const missing = sp.get(`${prefix}missing`) === "1";
  if (preset === "any") return null;
  if (preset === "none") return { fromMs: 0, toMs: 0, includeMissing: true }; // only records with NO date
  const r = resolveRange(preset, sp.get(`${prefix}from`), sp.get(`${prefix}to`), nowMs);
  if (r.fromMs == null && r.toMs == null) return null;
  return { ...r, includeMissing: missing };
}

export interface ParsedRequest {
  filters: AoFilters; view: AoView; list: ListOpts; csv: boolean;
  periodPreset: string; warnings: string[];
}

export function parseRequest(sp: URLSearchParams, nowMs: number, windowStartMs: number | null): ParsedRequest {
  const warnings: string[] = [];
  const teamVals = new Set<string>(AO_TEAMS.map((t) => t.value));
  const teams = (sp.get("teams") ?? "").split(",").map((s) => s.trim()).filter((s) => teamVals.has(s));
  const aType = sp.get("type") as AccountType | null;
  const icp = sp.get("icp") as IcpStatus | null;
  const activityTypes = (sp.get("atypes") ?? "").split(",").filter((s): s is AoActivityType => ACTS.includes(s as AoActivityType));

  const periodPreset = sp.get("ppreset") ?? "3m";
  let { fromMs, toMs } = resolveRange(periodPreset === "any" ? "3m" : periodPreset, sp.get("pfrom"), sp.get("pto"), nowMs);
  if (fromMs == null || toMs == null) {
    warnings.push("Custom activity range incomplete — using Last 3 Months.");
    ({ fromMs, toMs } = resolveRange("3m", null, null, nowMs));
  }
  if (windowStartMs != null && fromMs! < windowStartMs) {
    warnings.push(`Activity period starts before the synced window (${new Date(windowStartMs).toISOString().slice(0, 10)}); activity before that date is not counted.`);
  }

  let inactiveDays = Number(sp.get("inact")) || AO_INACTIVE_DAYS;
  let deep = Number(sp.get("deep")) || AO_DEEP_INACTIVE_DAYS;
  inactiveDays = Math.min(Math.max(Math.round(inactiveDays), 1), 3650);
  deep = Math.min(Math.max(Math.round(deep), 1), 3650);
  if (deep <= inactiveDays) { warnings.push("Deep-inactive threshold must exceed the inactive threshold — adjusted."); deep = inactiveDays + 1; }

  const filters: AoFilters = {
    teams,
    member: sp.get("member") || null,
    country: sp.get("country") || "USA",
    companyDate: dateFilter(sp, "c", nowMs),
    rooftopDate: dateFilter(sp, "r", nowMs),
    accountType: aType && TYPES.includes(aType) ? aType : "all",
    icp: icp && ICPS.includes(icp) ? icp : "all",
    owner: sp.get("owner") || null,
    q: (sp.get("q") ?? "").slice(0, 200),
    contactQ: (sp.get("cq") ?? "").slice(0, 200),
    activityTypes,
    activityFrom: fromMs!, activityTo: toMs!,
    inactiveDays, deepInactiveDays: deep,
  };
  const v = sp.get("view") as AoView | null;
  const view: AoView = v && (AO_VIEWS as readonly string[]).includes(v) ? v : "summary";
  const list: ListOpts = {
    drill: sp.get("drill") ?? "",
    sort: sp.get("sort") ?? "",
    dir: sp.get("dir") === "desc" ? "desc" : "asc",
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("size")) || 50,
  };
  return { filters, view, list, csv: sp.get("format") === "csv", periodPreset, warnings };
}

// ── CSV ───────────────────────────────────────────────────────────────────────
const etStamp = (ms: unknown) => (typeof ms === "number"
  ? new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "");

/** Column spec per exportable view: [header, field, kind]. `ms` columns render in US/Eastern. */
export const CSV_COLUMNS: Record<"accounts" | "contacts" | "activities", [string, string, ("ms" | "list" | "raw")?][]> = {
  accounts: [
    ["HubSpot Record ID", "id"], ["Company", "name"], ["Domain", "domain"], ["Country", "country"], ["State", "state"], ["City", "city"],
    ["Account Owner", "owner_name"], ["Assigned Team", "team"], ["Activity Owners (period)", "activity_owners", "list"],
    ["Account Type", "type"], ["Type Review Reason", "type_reason"], ["GD Name", "gd_name"], ["GD ID", "gd_id"], ["Rooftop ID", "rooftop_id"],
    ["Company ICP", "icp"],
    ["Company Last Activity (ET)", "company_last_activity_ms", "ms"], ["Company Days Since", "company_days"], ["Company Status", "company_status"],
    ["Rooftop Last Activity (ET)", "rooftop_last_activity_ms", "ms"], ["Rooftop Days Since", "rooftop_days"], ["Rooftop Status", "rooftop_status"],
    ["HubSpot Last Contacted (ET)", "last_contacted_ms", "ms"], ["Never Contacted (verified)", "never_contacted"],
    ["Last Call (ET)", "last_call_ms", "ms"], ["Last Email (ET)", "last_email_ms", "ms"], ["Last Meeting (ET)", "last_meeting_ms", "ms"], ["Last Demo Booked (ET)", "last_demo_ms", "ms"],
    ["Calls", "calls"], ["Connected", "connected"], ["Emails", "emails"], ["Meetings", "meetings"],
    ["Demos Booked", "demos_booked"], ["Demos Completed", "demos_completed"], ["Touchpoints", "touchpoints"],
    ["Associated Contacts (synced)", "contacts"], ["Associated Contacts (HubSpot)", "hubspot_contacts"],
  ],
  contacts: [
    ["HubSpot Contact ID", "id"], ["Contact", "name"], ["Job Title", "title"], ["Email", "email"], ["Phone", "phone"],
    ["Company ID", "company_id"], ["Company", "company_name"], ["Account Owner", "account_owner"], ["Contact Owner", "contact_owner"],
    ["Assigned Team", "team"], ["Activity Owners (period)", "activity_owners", "list"], ["Company ICP", "company_icp"], ["Contact ICP", "contact_icp"],
    ["Last Activity (ET)", "last_activity_ms", "ms"], ["Last Call (ET)", "last_call_ms", "ms"], ["Last Email (ET)", "last_email_ms", "ms"],
    ["Calls", "calls"], ["Connected", "connected"], ["Emails", "emails"], ["Meetings", "meetings"], ["Demos", "demos"], ["Touchpoints", "touchpoints"],
    ["Engagement", "engagement"],
  ],
  activities: [
    ["Activity ID", "id"], ["Date/Time (ET)", "ts_ms", "ms"], ["Type", "type"], ["Direction", "direction"], ["Outcome / Disposition", "outcome"],
    ["Meeting Status", "meeting_status"], ["Subject", "subject"], ["Companies", "company_names", "list"], ["Company IDs", "company_ids", "list"],
    ["Assigned Team(s)", "teams", "list"], ["Contacts", "contact_names", "list"], ["Activity Owner", "owner_name"], ["Owner Roster Pod", "owner_pod"],
    ["Call Duration (s)", "duration_ms"], ["Connected", "connected"], ["Counted as Touchpoint", "counted_as_touch"], ["Attributed via Contact Only", "via_contact_only"],
  ],
};

export function toCsv(view: "accounts" | "contacts" | "activities", rows: object[]): string {
  const cols = CSV_COLUMNS[view];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Neutralize spreadsheet formula injection from CRM free text.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) => cols.map(([, field, kind]) => {
    const v = (r as Record<string, unknown>)[field];
    if (kind === "ms") return esc(etStamp(v));
    if (kind === "list") return esc(Array.isArray(v) ? v.join("; ") : v);
    if (field === "duration_ms") return esc(typeof v === "number" ? Math.round(v / 1000) : "");
    return esc(v);
  }).join(","));
  return [cols.map(([h]) => esc(h)).join(","), ...lines].join("\n");
}
