"use client";
/**
 * Accounts Overview (/accounts-overview) — account distribution, ownership, activity, ICP coverage
 * and meeting/demo tracking for the Neelima · Prince · Saarthak · Central teams.
 * Data: /api/accounts-overview (isolated sdr_ao_* tables, filtered server-side in memory).
 * Filters live in the URL so every view is deep-linkable; all tabs read the same filter set.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, RotateCcw, RefreshCw, AlertTriangle } from "lucide-react";
import AppNav from "../AppNav";
import { Viewer } from "../../lib/spine/types";
import { cn } from "../ui";
import { Note, etTime } from "./parts";
import { TabBody } from "./tabs";
import ListPanel, { ListSpec } from "./ListPanel";
import AccountDetail from "./AccountDetail";

export const TEAMS = [
  { value: "Neelima", label: "Neelima Team" },
  { value: "Prince", label: "Prince Team" },
  { value: "Saarthak", label: "Saarthak Team" },
  { value: "Central", label: "Central Team" },
];

const TABS: [string, string][] = [
  ["summary", "Summary"], ["teams", "Team Distribution"], ["health", "Account Health"], ["activity", "Activity & Touchpoints"],
  ["icp", "ICP Coverage"], ["meetings", "Meetings & Demos"], ["contacts", "Contacts"], ["quality", "Data Quality"],
];

export interface UiFilters {
  team: string; member: string; country: string; type: string; icp: string; owner: string; q: string; cq: string;
  atypes: string[];
  ppreset: string; pfrom: string; pto: string;
  cpreset: string; cfrom: string; cto: string; cmissing: boolean;
  rpreset: string; rfrom: string; rto: string; rmissing: boolean;
  inact: number; deep: number;
}

export const DEFAULTS: UiFilters = {
  team: "", member: "", country: "USA", type: "all", icp: "all", owner: "", q: "", cq: "", atypes: [],
  ppreset: "3m", pfrom: "", pto: "",
  cpreset: "any", cfrom: "", cto: "", cmissing: false,
  rpreset: "any", rfrom: "", rto: "", rmissing: false,
  inact: 60, deep: 90,
};

/** UiFilters → the API query string (only non-default values, so URLs stay short). */
export function filterQuery(f: UiFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.team) p.set("teams", f.team);
  if (f.member) p.set("member", f.member);
  if (f.country !== "USA") p.set("country", f.country);
  if (f.type !== "all") p.set("type", f.type);
  if (f.icp !== "all") p.set("icp", f.icp);
  if (f.owner) p.set("owner", f.owner);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.cq.trim()) p.set("cq", f.cq.trim());
  if (f.atypes.length) p.set("atypes", f.atypes.join(","));
  if (f.ppreset !== "3m") p.set("ppreset", f.ppreset);
  if (f.ppreset === "custom") { p.set("pfrom", f.pfrom); p.set("pto", f.pto); }
  for (const k of ["c", "r"] as const) {
    const preset = f[`${k}preset`];
    if (preset === "any") continue;
    p.set(`${k}preset`, preset);
    if (preset === "custom") { p.set(`${k}from`, f[`${k}from`]); p.set(`${k}to`, f[`${k}to`]); }
    if (f[`${k}missing`]) p.set(`${k}missing`, "1");
  }
  if (f.inact !== 60) p.set("inact", String(f.inact));
  if (f.deep !== 90) p.set("deep", String(f.deep));
  return p;
}

function fromUrl(sp: URLSearchParams): UiFilters {
  const f = { ...DEFAULTS };
  f.team = sp.get("teams") ?? ""; f.member = sp.get("member") ?? ""; f.country = sp.get("country") ?? "USA";
  f.type = sp.get("type") ?? "all"; f.icp = sp.get("icp") ?? "all"; f.owner = sp.get("owner") ?? "";
  f.q = sp.get("q") ?? ""; f.cq = sp.get("cq") ?? "";
  f.atypes = (sp.get("atypes") ?? "").split(",").filter(Boolean);
  f.ppreset = sp.get("ppreset") ?? "3m"; f.pfrom = sp.get("pfrom") ?? ""; f.pto = sp.get("pto") ?? "";
  f.cpreset = sp.get("cpreset") ?? "any"; f.cfrom = sp.get("cfrom") ?? ""; f.cto = sp.get("cto") ?? ""; f.cmissing = sp.get("cmissing") === "1";
  f.rpreset = sp.get("rpreset") ?? "any"; f.rfrom = sp.get("rfrom") ?? ""; f.rto = sp.get("rto") ?? ""; f.rmissing = sp.get("rmissing") === "1";
  f.inact = Number(sp.get("inact")) || 60; f.deep = Number(sp.get("deep")) || 90;
  return f;
}

const PERIOD_PRESETS: [string, string][] = [["7d", "Last 7 Days"], ["30d", "Last 30 Days"], ["60d", "Last 60 Days"], ["90d", "Last 90 Days"], ["3m", "Last 3 Months"], ["custom", "Custom Range"]];
const DATE_PRESETS: [string, string][] = [["any", "Any date"], ...PERIOD_PRESETS, ["none", "No date recorded"]];
const ACT_TYPES: [string, string][] = [["call", "Calls"], ["email", "Emails"], ["meeting", "Meetings"], ["note", "Notes"], ["task", "Tasks"]];

const sel = "rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-primary/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
      {children}
    </label>
  );
}

function DateFilter({ label, prefix, f, set }: { label: string; prefix: "p" | "c" | "r"; f: UiFilters; set: (p: Partial<UiFilters>) => void }) {
  const preset = f[`${prefix}preset`];
  const presets = prefix === "p" ? PERIOD_PRESETS : DATE_PRESETS;
  return (
    <Field label={label}>
      <div className="flex flex-wrap items-center gap-1">
        <select className={sel} value={preset} onChange={(e) => set({ [`${prefix}preset`]: e.target.value } as Partial<UiFilters>)}>
          {presets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {preset === "custom" && (
          <>
            <input type="date" className={sel} value={f[`${prefix}from`]} onChange={(e) => set({ [`${prefix}from`]: e.target.value } as Partial<UiFilters>)} />
            <input type="date" className={sel} value={f[`${prefix}to`]} onChange={(e) => set({ [`${prefix}to`]: e.target.value } as Partial<UiFilters>)} />
          </>
        )}
        {prefix !== "p" && preset !== "any" && preset !== "none" && (
          <label className="flex items-center gap-1 text-[11px] text-ink-muted" title="Also include records where this date is empty">
            <input type="checkbox" checked={f[`${prefix}missing`] as boolean} onChange={(e) => set({ [`${prefix}missing`]: e.target.checked } as Partial<UiFilters>)} />
            +missing
          </label>
        )}
      </div>
    </Field>
  );
}

export default function AccountsOverview({ viewer }: { viewer: Viewer }) {
  const [f, setF] = useState<UiFilters>(DEFAULTS);
  const [tab, setTab] = useState("summary");
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<ListSpec | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Hydrate from the URL once (deep links), then mirror state back into it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setF(fromUrl(sp));
    const t = sp.get("tab");
    if (t && TABS.some(([k]) => k === t)) setTab(t);
    setReady(true);
  }, []);

  const set = useCallback((p: Partial<UiFilters>) => setF((cur) => {
    const next = { ...cur, ...p };
    if ("team" in p && p.team !== cur.team) next.member = ""; // member options depend on the team
    return next;
  }), []);

  // Debounce free-text search so typing doesn't fire a request per keystroke.
  const [debounced, setDebounced] = useState(f);
  useEffect(() => { const t = setTimeout(() => setDebounced(f), f.q !== debounced.q || f.cq !== debounced.cq ? 350 : 0); return () => clearTimeout(t); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = useMemo(() => filterQuery(debounced), [debounced]);
  const qs = query.toString();

  useEffect(() => {
    if (!ready) return;
    const url = new URLSearchParams(qs);
    if (tab !== "summary") url.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}${url.toString() ? `?${url}` : ""}`);
  }, [qs, tab, ready]);

  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!ready) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setLoading(true); setError(null);
    const p = new URLSearchParams(qs);
    p.set("view", tab === "contacts" ? "contacts" : tab);
    if (nonce) p.set("refresh", "1");
    fetch(`/api/accounts-overview?${p}`, { signal: ac.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error === "setup_required"
          ? "Accounts Overview data is not available yet. Apply supabase/accounts_overview_schema.sql and run the “Accounts Overview sync” workflow (npm run ao:sync)."
          : j.error || `HTTP ${r.status}`);
        setData({ ...j, __tab: tab });
      })
      .catch((e) => { if (e.name !== "AbortError") setError(String(e.message ?? e)); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [qs, tab, ready, nonce]);

  const meta = data?.meta;
  const opts = meta?.options;
  const th = { inact: f.inact, deep: f.deep };
  const memberOptions = useMemo(() => {
    if (!opts) return { roster: [] as any[], others: [] as any[] };
    const roster = (opts.members as any[]).filter((m) => !f.team || m.team === f.team);
    const rosterIds = new Set(roster.map((m) => m.owner_id));
    return { roster, others: (opts.activity_owners as any[]).filter((o) => !rosterIds.has(o.id)) };
  }, [opts, f.team]);

  const openList = (spec: ListSpec) => setList(spec);
  const csvHref = (view: string, drill = "") => {
    const p = new URLSearchParams(qs); p.set("view", view); p.set("format", "csv"); if (drill) p.set("drill", drill);
    return `/api/accounts-overview?${p}`;
  };

  const syncStale = meta?.synced_at && Date.now() - Date.parse(meta.synced_at) > 26 * 3_600_000;

  return (
    <div className="min-h-screen bg-canvas">
      <AppNav active="accounts-overview" viewer={viewer} />
      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-ink">Accounts Overview</h1>
            <p className="text-xs text-ink-muted">
              Team accounts from HubSpot <span className="font-mono">team_accounts</span> · account owner, assigned team and activity owner shown separately
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {meta && (
              <span className={cn("rounded-full px-2.5 py-1 font-medium", meta.sync_status === "ok" && !syncStale ? "bg-good-weak text-good" : "bg-warn-weak text-warn")}
                title={meta.window_start_ms ? `Activity synced from ${etTime(meta.window_start_ms)}` : undefined}>
                {meta.sync_status === "running" ? "Sync running · " : meta.sync_status === "error" ? "Last sync failed · " : syncStale ? "Stale · " : ""}
                Synced {meta.synced_at ? etTime(Date.parse(meta.synced_at)) : "never"}
              </span>
            )}
            <button onClick={() => setNonce((n) => n + 1)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-ink-muted hover:bg-surface-muted" title="Re-read the synced tables (does not call HubSpot)">
              <RefreshCw className="h-3.5 w-3.5" /> Reload
            </button>
            <button onClick={() => setF(DEFAULTS)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-ink-muted hover:bg-surface-muted">
              <RotateCcw className="h-3.5 w-3.5" /> Reset filters
            </button>
            <a href={csvHref(tab === "contacts" ? "contacts" : tab === "activity" ? "activities" : "accounts")} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 font-medium text-primary-fg">
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
          </div>
        </div>

        {/* Global filters — one row group above every tab */}
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-3 shadow-card sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Team">
            <select className={sel} value={f.team} onChange={(e) => set({ team: e.target.value })}>
              <option value="">All Teams</option>
              {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Team member (activity owner)">
            <select className={sel} value={f.member} onChange={(e) => set({ member: e.target.value })}>
              <option value="">Everyone</option>
              {memberOptions.roster.length > 0 && (
                <optgroup label={f.team ? "Roster — this team's pod" : "Roster — team pods"}>
                  {memberOptions.roster.map((m: any) => <option key={`${m.team}-${m.owner_id}`} value={m.owner_id}>{m.name}{f.team ? "" : ` (${m.team})`}</option>)}
                </optgroup>
              )}
              {memberOptions.others.length > 0 && (
                <optgroup label="Other activity owners on these accounts">
                  {memberOptions.others.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </optgroup>
              )}
            </select>
          </Field>
          <Field label="Country">
            <select className={sel} value={f.country} onChange={(e) => set({ country: e.target.value })}>
              <option value="USA">USA</option>
              <option value="all">All countries</option>
              {(opts?.countries ?? []).filter((c: any) => c.value !== "USA").map((c: any) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}
            </select>
          </Field>
          <Field label="Account type">
            <select className={sel} value={f.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="all">All types</option>
              <option value="single_franchise">Single Franchise</option>
              <option value="independent">Independent</option>
              <option value="group">Group Dealership</option>
              <option value="unknown">Unknown / Needs Review</option>
            </select>
          </Field>
          <Field label="ICP status (company)">
            <select className={sel} value={f.icp} onChange={(e) => set({ icp: e.target.value })}>
              <option value="all">All</option><option value="yes">ICP</option><option value="no">Non-ICP</option><option value="unknown">Not set</option>
            </select>
          </Field>
          <Field label="Account owner">
            <select className={sel} value={f.owner} onChange={(e) => set({ owner: e.target.value })}>
              <option value="">All owners</option>
              {(opts?.account_owners ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Company / domain / record ID">
            <input className={sel} value={f.q} placeholder="Search accounts" onChange={(e) => set({ q: e.target.value })} />
          </Field>
          <Field label="Contact name / email / phone">
            <input className={sel} value={f.cq} placeholder="Search contacts" onChange={(e) => set({ cq: e.target.value })} />
          </Field>
          <DateFilter label="Activity date range (reporting period)" prefix="p" f={f} set={set} />
          <DateFilter label="Company last activity" prefix="c" f={f} set={set} />
          <DateFilter label="Rooftop last activity" prefix="r" f={f} set={set} />
          <Field label="Inactive thresholds (days)">
            <div className="flex items-center gap-1">
              <input type="number" min={1} className={cn(sel, "w-16")} value={f.inact} onChange={(e) => set({ inact: Math.max(1, Number(e.target.value) || 60) })} />
              <span className="text-ink-subtle">/</span>
              <input type="number" min={2} className={cn(sel, "w-16")} value={f.deep} onChange={(e) => set({ deep: Math.max(2, Number(e.target.value) || 90) })} />
            </div>
          </Field>
          <div className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-3 lg:col-span-6">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Activity type</span>
            {ACT_TYPES.map(([v, l]) => {
              const on = f.atypes.includes(v);
              return (
                <button key={v} onClick={() => set({ atypes: on ? f.atypes.filter((x) => x !== v) : [...f.atypes, v] })}
                  className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", on ? "bg-primary text-primary-fg" : "bg-surface-muted text-ink-muted hover:text-ink")}>
                  {l}
                </button>
              );
            })}
            <span className="text-[11px] text-ink-subtle">{f.atypes.length ? "" : "All types (demos are deal events — shown only when no type is selected)"}</span>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition", tab === k ? "bg-primary text-primary-fg shadow-sm" : "text-ink-muted hover:bg-surface-muted hover:text-ink")}>
              {l}
            </button>
          ))}
          {loading && <Loader2 className="ml-auto mr-2 h-4 w-4 self-center animate-spin text-ink-subtle" />}
        </div>

        {error && <div className="mb-4 flex items-start gap-2 rounded-card border border-warn/30 bg-warn-weak p-4 text-sm text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {(data?.warnings ?? []).map((w: string) => <div key={w} className="mb-2"><Note tone="warn">{w}</Note></div>)}
        {meta?.sync_status === "error" && meta.error && <div className="mb-2"><Note tone="warn">Last sync failed: {meta.error}. Figures below are from the previous successful sync.</Note></div>}
        {meta && meta.sync_status === "never" && <div className="mb-2"><Note tone="warn">No sync has completed yet — run the “Accounts Overview sync” workflow. Nothing below is real data until it does.</Note></div>}

        {data && !error && data.__tab === tab && (
          <div className={cn("transition-opacity", loading && "opacity-60")}>
            <TabBody tab={tab} data={data} th={th} f={f} openList={openList} openDetail={setDetail} qs={qs} />
          </div>
        )}
        {(!data || data.__tab !== tab) && !error && <div className="flex items-center gap-2 py-16 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading accounts…</div>}
      </main>

      {list && <ListPanel spec={list} qs={qs} th={th} onClose={() => setList(null)} onOpenAccount={setDetail} />}
      {detail && <AccountDetail id={detail} qs={qs} th={th} onClose={() => setDetail(null)} />}
    </div>
  );
}
