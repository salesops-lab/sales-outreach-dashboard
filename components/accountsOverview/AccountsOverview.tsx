"use client";
/**
 * Accounts Overview (/accounts-overview) — two tabs, one shared filter bar, no filter applied by default.
 *   · Accounts — HubSpot US TAM (all companies, not filtered) → filters → "By team" + "Members" tables
 *     (accounts by type + worked / not worked in 60 days) → 8 cards → the account list (everything drills it).
 *   · Deals & Pipeline — last-quarter demos and deals (by team, by stage) → team members → each member's
 *     deals grouped by stage → a per-member funnel of how they use their own accounts and contacts.
 * Data: /api/accounts-overview (isolated sdr_ao_* tables, computed server-side in memory).
 * Filters live in the URL so every view is shareable.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Building2, CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Globe2, Loader2, RotateCcw, Search,
  Layers, SlidersHorizontal, Target, UserRound, Users, X, type LucideIcon,
} from "lucide-react";
import AppNav from "../AppNav";
import { Viewer } from "../../lib/spine/types";
import { companyUrl, dealUrl } from "../../config/hubspot";
import { cn, SortHeader } from "../ui";
import { Card, etDay, etTime, fmt, Note, pct, StatusChip, TH, TYPE_LABEL } from "./parts";
import AccountDetail from "./AccountDetail";
import GroupDetail from "./GroupDetail";
import { ALL_COLUMNS, ManageColumns, useColumns } from "./columns";
import { CARD_TONE, LOOK, TONE, Tone, teamTone } from "./tones";

const TEAMS = [
  { value: "Neelima", label: "Neelima Team" },
  { value: "Prince", label: "Prince Team" },
  { value: "Saarthak", label: "Saarthak Team" },
  { value: "Central", label: "Central Team" },
];
const TH60 = { inact: 60, deep: 90 };

interface UiFilters {
  team: string; owner: string; gd: string; dtype: string; country: string; state: string; icp: string;
  cpreset: string; cfrom: string; cto: string;
  atypes: string[];
  ppreset: string; pfrom: string; pto: string;
}
/** Nothing is filtered by default. */
const DEFAULTS: UiFilters = {
  team: "", owner: "", gd: "", dtype: "all", country: "all", state: "all", icp: "all",
  cpreset: "any", cfrom: "", cto: "", atypes: [], ppreset: "all", pfrom: "", pto: "",
};

/** Only non-default values go into the URL / API query. */
function filterQuery(f: UiFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.team) p.set("teams", f.team);
  if (f.owner) p.set("owner", f.owner);
  if (f.gd.trim()) p.set("gd", f.gd.trim());
  if (f.dtype !== "all") p.set("dtype", f.dtype);
  if (f.country !== "all") p.set("country", f.country);
  if (f.state !== "all") p.set("state", f.state);
  if (f.icp !== "all") p.set("icp", f.icp);
  if (f.cpreset !== "any") p.set("cpreset", f.cpreset);
  if (f.cpreset === "custom") { p.set("cfrom", f.cfrom); p.set("cto", f.cto); }
  if (f.atypes.length) p.set("atypes", f.atypes.join(","));
  if (f.ppreset !== "all") p.set("ppreset", f.ppreset);
  if (f.ppreset === "custom") { p.set("pfrom", f.pfrom); p.set("pto", f.pto); }
  return p;
}
function fromUrl(sp: URLSearchParams): UiFilters {
  const g = (k: string, d: string) => sp.get(k) ?? d;
  return {
    team: g("teams", ""), owner: g("owner", ""), gd: g("gd", ""), dtype: g("dtype", "all"), country: g("country", "all"),
    state: g("state", "all"), icp: g("icp", "all"), cpreset: g("cpreset", "any"), cfrom: g("cfrom", ""), cto: g("cto", ""),
    atypes: g("atypes", "").split(",").filter(Boolean), ppreset: g("ppreset", "all"), pfrom: g("pfrom", ""), pto: g("pto", ""),
  };
}

const RANGE: [string, string][] = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["60d", "Last 60 days"], ["90d", "Last 90 days"], ["custom", "Custom range"]];
const ACT_TYPES: [string, string][] = [["call", "Calls"], ["email", "Emails"], ["meeting", "Meetings"], ["note", "Notes"], ["task", "Tasks"]];
const sel = "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-primary/30";
/** List titles for drills opened from the Deals & Pipeline tab (not one of the 8 cards). */
const DRILL_LABEL: Record<string, string> = {
  contacted: "Contacted in the date range", not_contacted: "Not contacted in the date range",
  "icp:yes": "ICP accounts", icp_contacted: "ICP accounts contacted",
};
const ROLE_CLS: Record<string, string> = {
  Manager: "bg-good-weak text-good", "Team Lead": "bg-good-weak text-good", "Team Lead / AE": "bg-good-weak text-good",
  SDR: "bg-primary/10 text-primary", "SDR-TL": "bg-primary/10 text-primary", AE: "bg-warm-weak text-warm",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
      {children}
    </label>
  );
}

function DateRangeField({ label, preset, from, to, presets, onChange }: {
  label: string; preset: string; from: string; to: string; presets: [string, string][];
  onChange: (p: { preset?: string; from?: string; to?: string }) => void;
}) {
  return (
    <Field label={label}>
      <select className={sel} value={preset} onChange={(e) => onChange({ preset: e.target.value })}>
        {presets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {preset === "custom" && (
        <div className="flex gap-1">
          <input type="date" className={sel} value={from} onChange={(e) => onChange({ from: e.target.value })} />
          <input type="date" className={sel} value={to} onChange={(e) => onChange({ to: e.target.value })} />
        </div>
      )}
    </Field>
  );
}

function RoleChip({ role }: { role: string | null }) {
  if (!role) return null;
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", ROLE_CLS[role])}>{role}</span>;
}

/** A number that, when clicked, opens what it counts. */
function Num({ v, onClick, strong }: { v: number | null | undefined; onClick?: () => void; strong?: boolean }) {
  if (!onClick || !v) return <span className={cn("font-mono tabular-nums", strong && "font-semibold")}>{fmt(v)}</span>;
  return <button onClick={onClick} className={cn("font-mono tabular-nums text-primary hover:underline", strong && "font-semibold")}>{fmt(v)}</button>;
}

export default function AccountsOverview({ viewer }: { viewer: Viewer }) {
  const [f, setF] = useState<UiFilters>(DEFAULTS);
  const [tab, setTab] = useState<"accounts" | "activity">("accounts");
  const [ready, setReady] = useState(false);
  const [card, setCard] = useState("");          // selected count card = list drill
  const [q, setQ] = useState("");                // list search
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [pageNo, setPageNo] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [group, setGroup] = useState<string | null>(null);
  const [dealSel, setDealSel] = useState<{ team: string; owner: string; kind: string; title: string } | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setF(fromUrl(sp));
    if (sp.get("tab") === "activity") setTab("activity");
    setReady(true);
  }, []);

  const set = useCallback((p: Partial<UiFilters>) => {
    setF((cur) => ({ ...cur, ...p, ...("team" in p && p.team !== cur.team ? { owner: "" } : {}) }));
    setPageNo(1);
    setDealSel(null);
  }, []);

  // Debounce the text inputs (GD Name, search) so typing doesn't fire a request per key.
  const [dq, setDq] = useState(q);
  const [dgd, setDgd] = useState(f.gd);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setDgd(f.gd); }, 350); return () => clearTimeout(t); }, [q, f.gd]);
  const qs = useMemo(() => filterQuery({ ...f, gd: dgd }).toString(), [f, dgd]);

  useEffect(() => {
    if (!ready) return;
    const url = new URLSearchParams(qs);
    if (tab === "activity") url.set("tab", "activity");
    window.history.replaceState(null, "", `${window.location.pathname}${url.toString() ? `?${url}` : ""}`);
  }, [qs, tab, ready]);

  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!ready) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const p = new URLSearchParams(qs);
    p.set("view", tab);
    if (tab === "accounts") {
      if (card) p.set("drill", card);
      if (dq.trim()) p.set("q", dq.trim());
      p.set("sort", sort); p.set("dir", dir); p.set("page", String(pageNo)); p.set("size", "50");
    }
    setLoading(true); setError(null);
    fetch(`/api/accounts-overview?${p}`, { signal: ac.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(
          j.error === "setup_required" ? "Data not available yet — the Accounts Overview sync has not run."
          : j.error === "load_failed" ? `Couldn't load the data (${j.detail ?? "unknown error"}). Press Try again; if it keeps happening, send this message to the admin.`
          : r.status === 504 ? "Loading took too long. Press Try again."
          : j.error || `HTTP ${r.status}`);
        setData({ ...j, __tab: tab });
      })
      .catch((e) => { if (e.name !== "AbortError") setError(String(e.message ?? e)); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [qs, tab, ready, card, dq, sort, dir, pageNo, retry]);

  const meta = data?.meta;
  const opts = meta?.options;
  const memberOptions = useMemo(() => {
    if (!opts) return { members: [] as any[], others: [] as any[] };
    const seen = new Set<string>();
    const members = (opts.members as any[]).filter((m) => (!f.team || m.team === f.team) && !seen.has(m.owner_id) && seen.add(m.owner_id));
    return { members, others: (opts.account_owners as any[]).filter((o) => !seen.has(o.id)) };
  }, [opts, f.team]);

  const csvHref = useMemo(() => {
    const p = new URLSearchParams(qs); p.set("view", "accounts"); p.set("format", "csv");
    if (card) p.set("drill", card);
    if (dq.trim()) p.set("q", dq.trim());
    return `/api/accounts-overview?${p}`;
  }, [qs, card, dq]);

  /** Jump from a Deals & Pipeline number to the matching account list (same date range as the number). */
  const openAccounts = (owner: string, team: string, drill: string, preset?: string) => {
    setF((cur) => ({ ...cur, owner, team: team || cur.team, ...(preset && cur.ppreset === "all" ? { ppreset: preset } : {}) }));
    setCard(drill); setQ(""); setPageNo(1); setTab("accounts");
    setTimeout(() => document.getElementById("ao-account-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
  };

  const shown = data && data.__tab === tab ? data : null;
  const filterBar = (
    <FilterBar f={f} set={set} opts={opts} memberOptions={memberOptions} />
  );

  return (
    <div className="relative isolate min-h-screen bg-canvas">
      {LOOK !== "subtle" && <div className={cn("ao-bg", LOOK === "balanced" && "ao-bg-soft")} aria-hidden><span /><span /><span /></div>}
      <AppNav active="accounts-overview" viewer={viewer} />
      <main className="mx-auto max-w-[1500px] px-4 py-4 sm:px-6">
        <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3",
          LOOK === "vivid" ? "ao-hero text-white shadow-lg" : LOOK === "balanced" ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md" : "ao-plain-hero border border-line bg-surface text-ink shadow-card")}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Accounts Overview</h1>
            <p className="text-[11px] text-white/80">HubSpot accounts, teams and members — Neelima · Prince · Saarthak · Central</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {meta && (
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium", meta.sync_status === "ok" ? "bg-white/20" : "bg-amber-300 text-amber-950")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", meta.sync_status === "ok" ? "bg-emerald-300" : "bg-amber-700")} />
                {meta.sync_status === "error" ? "Last sync failed · " : meta.sync_status === "running" ? "Sync running · " : ""}
                Updated {meta.synced_at ? etTime(Date.parse(meta.synced_at)) : "never"}
              </span>
            )}
            <button onClick={() => { setF(DEFAULTS); setCard(""); setQ(""); setPageNo(1); setDealSel(null); }}
              className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1.5 font-medium hover:bg-white/25">
              <RotateCcw className="h-3.5 w-3.5" /> Reset filters
            </button>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-1 rounded-xl border border-line bg-surface/80 p-1 shadow-card backdrop-blur">
          {([["accounts", "Accounts", Building2], ["activity", "Deals & Pipeline", Activity]] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition",
                tab === k ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md" : "text-ink-muted hover:bg-surface-muted hover:text-ink")}>
              <Icon className="h-4 w-4" />{l}
            </button>
          ))}
          {loading && <Loader2 className="ml-auto mr-2 h-4 w-4 animate-spin text-indigo-500" />}
        </div>

        {error && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warn/30 bg-warn-weak p-4 text-sm text-warn">
            <span>{error}</span>
            <button onClick={() => setRetry((n) => n + 1)} className="rounded-lg bg-warn px-3 py-1.5 text-xs font-semibold text-white">Try again</button>
          </div>
        )}
        {(shown?.warnings ?? []).map((w: string) => <div key={w} className="mb-2"><Note tone="warn">{w}</Note></div>)}
        {!shown && !error && <div className="flex items-center gap-2 py-16 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}

        {shown && tab === "accounts" && (
          <AccountsTab data={shown} f={f} filterBar={filterBar} card={card} q={q} sort={sort} dir={dir} csvHref={csvHref}
            onTeam={(t) => set({ team: f.team === t ? "" : t })}
            onOwner={(o) => { set({ owner: f.owner === o ? "" : o }); setCard(""); }}
            onPick={(team, owner, drill) => {
              // A number in the team / member tables: narrow to that team or person + card, then show the list.
              setF((cur) => ({ ...cur, team: team ?? cur.team, owner }));
              setCard(drill); setPageNo(1); setDealSel(null);
              if (drill || owner) setTimeout(() => document.getElementById("ao-account-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }}
            onCard={(k) => { setCard(k); setPageNo(1); }}
            onQ={(v) => { setQ(v); setPageNo(1); }}
            onSort={(k) => { if (sort === k) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k); setDir(k === "name" ? "asc" : "desc"); } setPageNo(1); }}
            onPage={setPageNo} onOpen={setDetail} onGroup={setGroup} />
        )}
        {shown && tab === "activity" && (
          <ActivityTab data={shown} f={f} qs={qs} filterBar={filterBar} dealSel={dealSel} setDealSel={setDealSel}
            onTeam={(t) => set({ team: t })} openAccounts={openAccounts} />
        )}
      </main>
      {group && <GroupDetail gd={group} qs={qs} onClose={() => setGroup(null)} onOpen={(id) => setDetail(id)} />}
      {detail && <AccountDetail id={detail} qs={qs} th={TH60} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ── shared filter bar ────────────────────────────────────────────────────────
function FilterBar({ f, set, opts, memberOptions }: { f: UiFilters; set: (p: Partial<UiFilters>) => void; opts: any; memberOptions: { members: any[]; others: any[] } }) {
  return (
    <div className="space-y-2 rounded-card border border-indigo-500/20 bg-surface/90 p-2.5 shadow-[0_6px_20px_-10px_rgba(79,70,229,0.25)] backdrop-blur">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        <Field label="Team">
          <select className={sel} value={f.team} onChange={(e) => set({ team: e.target.value })}>
            <option value="">All teams</option>
            {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Team member (account owner)">
          <select className={sel} value={f.owner} onChange={(e) => set({ owner: e.target.value })}>
            <option value="">Everyone</option>
            {memberOptions.members.length > 0 && (
              <optgroup label={f.team ? `${f.team} Team members` : "Team members"}>
                {memberOptions.members.map((m: any) => <option key={m.owner_id} value={m.owner_id}>{m.name}{m.role ? ` · ${m.role}` : ""}{f.team ? "" : ` (${m.team})`}</option>)}
              </optgroup>
            )}
            {memberOptions.others.length > 0 && (
              <optgroup label="Other account owners">
                {memberOptions.others.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </optgroup>
            )}
            <option value="none">No owner</option>
          </select>
        </Field>
        <Field label="GD Name">
          <input className={sel} list="ao-gd-names" value={f.gd} placeholder="Any group" onChange={(e) => set({ gd: e.target.value })} />
          <datalist id="ao-gd-names">{(opts?.gd_names ?? []).map((g: any) => <option key={g.value} value={g.value} />)}</datalist>
        </Field>
        <Field label="Type of Dealership">
          <select className={sel} value={f.dtype} onChange={(e) => set({ dtype: e.target.value })}>
            <option value="all">All</option><option value="franchise">Franchise</option>
            <option value="independent">Independent</option><option value="none">Not set</option>
          </select>
        </Field>
        <Field label="Company ICP">
          <select className={sel} value={f.icp} onChange={(e) => set({ icp: e.target.value })}>
            <option value="all">All</option><option value="yes">ICP</option><option value="no">Non-ICP</option><option value="unknown">Not set</option>
          </select>
        </Field>
        <Field label="Country">
          <select className={sel} value={f.country} onChange={(e) => set({ country: e.target.value })}>
            <option value="all">All countries</option>
            {(opts?.countries ?? []).map((c: any) => <option key={c.value} value={c.value}>{c.value} ({fmt(c.count)})</option>)}
          </select>
        </Field>
        <Field label="State">
          <select className={sel} value={f.state} onChange={(e) => set({ state: e.target.value })}>
            <option value="all">All states</option>
            {(opts?.states ?? []).map((s: any) => <option key={s.value} value={s.value}>{s.value} ({fmt(s.count)})</option>)}
          </select>
        </Field>
        <DateRangeField label="Last Activity Date (company)" preset={f.cpreset} from={f.cfrom} to={f.cto}
          presets={[["any", "Any date"], ...RANGE, ["none", "No activity date"]]}
          onChange={(p) => set({ ...(p.preset != null && { cpreset: p.preset }), ...(p.from != null && { cfrom: p.from }), ...(p.to != null && { cto: p.to }) })} />
        <div className="col-span-2">
          <DateRangeField label="Activity date range (calls, emails, meetings)" preset={f.ppreset} from={f.pfrom} to={f.pto}
            presets={[["all", "All synced activity (last 180 days)"], ["lq", "Last quarter"], ...RANGE]}
            onChange={(p) => set({ ...(p.preset != null && { ppreset: p.preset }), ...(p.from != null && { pfrom: p.from }), ...(p.to != null && { pto: p.to }) })} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Activity type</span>
        {ACT_TYPES.map(([v, l]) => {
          const on = f.atypes.includes(v);
          return (
            <button key={v} onClick={() => set({ atypes: on ? f.atypes.filter((x) => x !== v) : [...f.atypes, v] })}
              className={cn("rounded-full px-3 py-0.5 text-[11px] font-semibold", on ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white" : "bg-surface-muted text-ink-muted hover:text-ink")}>
              {l}
            </button>
          );
        })}
        {f.atypes.length === 0 && <span className="text-[11px] text-ink-subtle">All types</span>}
      </div>
    </div>
  );
}

function SectionTitle({ children, sub, icon: Icon, tone = "indigo" }: { children: React.ReactNode; sub?: React.ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <div className="mb-2 mt-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
        {Icon && <span className={cn("grid h-6 w-6 place-items-center rounded-lg", TONE[tone].soft)}><Icon className="h-3.5 w-3.5" /></span>}
        {children}
      </h2>
      {sub && <span className="text-[11px] text-ink-subtle">{sub}</span>}
    </div>
  );
}

function Stat({ label, value, sub, active, onClick, tone = "indigo", compact }: { label: string; value: string; sub?: string; active?: boolean; onClick?: () => void; tone?: Tone; compact?: boolean }) {
  const Tag = onClick ? "button" : "div";
  const t = TONE[tone];
  return (
    <Tag onClick={onClick} className={cn("relative overflow-hidden rounded-card border text-left", compact ? "px-2.5 py-1.5" : "px-3 py-2.5", t.card, t.lift, active && t.ring)}>
      <div className={cn("flex items-center gap-1.5 font-semibold text-ink-muted", compact ? "text-[10px] leading-tight" : "text-[11px]")}><span className={cn("h-2 w-2 shrink-0 rounded-full", t.dot)} />{label}</div>
      <div className={cn("mt-0.5 font-mono font-bold tabular-nums", compact ? "text-lg" : "text-xl", t.text)}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{sub}</div>}
    </Tag>
  );
}

// ── Accounts tab ─────────────────────────────────────────────────────────────
function AccountsTab({ data, f, filterBar, card, q, sort, dir, csvHref, onTeam, onOwner, onPick, onCard, onQ, onSort, onPage, onOpen, onGroup }: {
  data: any; f: UiFilters; filterBar: React.ReactNode; card: string; q: string; sort: string; dir: "asc" | "desc"; csvHref: string;
  onTeam: (t: string) => void; onOwner: (o: string) => void; onCard: (k: string) => void; onQ: (v: string) => void;
  onPick: (team: string | null, owner: string, drill: string) => void;
  onSort: (k: string) => void; onPage: (p: number) => void; onOpen: (id: string) => void; onGroup: (gd: string) => void;
}) {
  const tam = data.tam;
  const share = (n: number) => (tam?.total ? `${((n / tam.total) * 100).toFixed(1)}% of US accounts` : "");
  const list = data.list;
  const teamLabel = TEAMS.find((t) => t.value === f.team)?.label;
  const [colKeys, setColKeys] = useColumns();
  const cols = colKeys.map((k) => ALL_COLUMNS.find((c) => c.key === k)!).filter(Boolean);
  const ctx = { onOpen, onGroup };
  return (
    <div>
      {/* 1. HubSpot TAM — every US company, never filtered */}
      <SectionTitle icon={Globe2} tone="indigo" sub="All HubSpot companies with Country = United States · not affected by the filters">HubSpot US accounts (TAM)</SectionTitle>
      {tam ? (
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Stat tone="indigo" label="Total US accounts" value={fmt(tam.total)} sub="Groups + single rooftops" />
          <Stat tone="amber" label="Single Independent" value={fmt(tam.independent)} sub={`GD Name empty · Independent · ${share(tam.independent)}`} />
          <Stat tone="emerald" label="Single Franchise" value={fmt(tam.single_franchise)} sub={`GD Name empty · Franchise · ${share(tam.single_franchise)}`} />
          <Stat tone="violet" label="Group Dealership" value={fmt(tam.group)} sub={`GD Name set · ${fmt(tam.unique_gds)} dealership groups`} />
        </div>
      ) : <Note>The US totals appear after the next Accounts Overview sync.</Note>}
      {tam?.unknown > 0 && <p className="mt-1 text-[11px] text-ink-subtle">{fmt(tam.unknown)} US accounts have no GD Name and no Type of Dealership.</p>}

      {/* 2. Filters — everything below follows them */}
      <SectionTitle icon={SlidersHorizontal} tone="slate" sub="Everything below follows these filters">Filters</SectionTitle>
      {filterBar}

      {/* 3–4. Teams and the chosen team's members — accounts by type + worked in the last 60 days */}
      <SectionTitle icon={Users} tone="violet" sub="Group worked = Rooftop Last Activity in the last 60 days · Single worked = Last Activity Date in the last 60 days · click a number to list those accounts">
        Teams &amp; members
      </SectionTitle>
      <TeamChips team={f.team} onTeam={(t) => onPick(t, "", "")} />
      <div className="mt-2 space-y-3">
        <Card title="By team">
          <table className="w-full text-xs">
            <thead className={THEAD}>
              <tr>
                <TH rowSpan={2}>Team</TH><TH right rowSpan={2}>Members</TH><TH right rowSpan={2}>Group accounts</TH>
                <TH right rowSpan={2}>Single Fr.</TH><TH right rowSpan={2}>Single Ind.</TH>
                <TH center colSpan={2} className="border-l border-line/60 pb-0">Group · Rooftop Last Activity</TH>
                <TH center colSpan={2} className="border-l border-line/60 pb-0">Single · Last Activity Date</TH>
                <TH center colSpan={2} className="border-l border-line/60 pb-0">No activity</TH>
              </tr>
              <tr>
                <TH right className="border-l border-line/60 pt-1">Worked &lt;60d</TH><TH right className="pt-1">Not worked 60+d</TH>
                <TH right className="border-l border-line/60 pt-1">Worked &lt;60d</TH><TH right className="pt-1">Not worked 60+d</TH>
                <TH right className="border-l border-line/60 pt-1">Group</TH><TH right className="pt-1">Single</TH>
              </tr>
            </thead>
            <tbody>{data.teams.map((t: any) => {
              const g = t.split?.group; const s = t.split?.single;
              return (
                <tr key={t.team} className={cn("border-b border-line/60", f.team === t.team && cn("font-semibold", TONE[teamTone(t.team)].soft))}>
                  <td className="px-2 py-1"><TeamName team={t.team} label={t.label} onClick={() => onTeam(t.team)} /></td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(t.members)}</td>
                  <td className="px-2 py-1 text-right"><Num v={t.group} strong onClick={() => onPick(t.team, "", "type:group")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={t.single_franchise} onClick={() => onPick(t.team, "", "type:single_franchise")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={t.independent} onClick={() => onPick(t.team, "", "type:independent")} /></td>
                  <td className="border-l border-line/60 px-2 py-1 text-right"><Num v={g?.worked_60 ?? 0} onClick={() => onPick(t.team, "", "work:active:group")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={g?.not_worked_60 ?? 0} strong onClick={() => onPick(t.team, "", "work:inactive_60plus:group")} /></td>
                  <td className="border-l border-line/60 px-2 py-1 text-right"><Num v={s?.worked_60 ?? 0} onClick={() => onPick(t.team, "", "work:active:single")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={s?.not_worked_60 ?? 0} strong onClick={() => onPick(t.team, "", "work:inactive_60plus:single")} /></td>
                  <td className="border-l border-line/60 px-2 py-1 text-right"><Num v={g?.no_activity ?? 0} onClick={() => onPick(t.team, "", "work:no_activity:group")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={s?.no_activity ?? 0} onClick={() => onPick(t.team, "", "work:no_activity:single")} /></td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="mt-1.5 text-[10px] text-ink-subtle">
            Accounts by owner role — {data.teams.map((t: any) => `${t.team}: ${t.by_role.map((r: any) => `${r.role} ${fmt(r.accounts)}`).join(" · ")}`).join("  |  ")}
          </p>
        </Card>
        <Card title={`Members — ${teamLabel ?? "All teams"}`}>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className={THEAD}><tr><TH>Member</TH><TH>Role</TH><TH right>Accounts</TH><TH right>Group</TH><TH right>Single Fr.</TH><TH right>Single Ind.</TH><TH right>Worked &lt;60d</TH><TH right>Not worked 60+d</TH><TH right>No activity</TH><TH right>% worked</TH></tr></thead>
              <tbody>{data.members.map((m: any) => (
                <tr key={m.owner_id} className={cn("border-b border-line/60", f.owner === m.owner_id && cn("font-semibold", TONE[teamTone(m.team)].soft))}>
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center gap-1">
                      <TeamName team={m.team} label={m.name} onClick={() => onOwner(m.owner_id)} />
                      {!m.in_team && m.owner_id !== "none" && <span className="text-[10px] text-ink-subtle">(not in team)</span>}
                    </span>
                  </td>
                  <td className="px-2 py-1"><RoleChip role={m.role} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.total} strong onClick={() => onPick(null, m.owner_id, "")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.group} onClick={() => onPick(null, m.owner_id, "type:group")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.single_franchise} onClick={() => onPick(null, m.owner_id, "type:single_franchise")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.independent} onClick={() => onPick(null, m.owner_id, "type:independent")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.worked_60} onClick={() => onPick(null, m.owner_id, "work:active")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.not_worked_60} strong onClick={() => onPick(null, m.owner_id, "work:inactive_60plus")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.no_activity} onClick={() => onPick(null, m.owner_id, "work:no_activity")} /></td>
                  <td className="px-2 py-1 text-right"><PctBar v={m.pct_worked} /></td>
                </tr>
              ))}
              {data.members.length === 0 && <tr><td colSpan={10} className="px-2 py-6 text-center text-ink-subtle">No members match these filters.</td></tr>}</tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 5. Accounts — one compact strip of cards that narrow the list */}
      <SectionTitle icon={Building2} tone="indigo" sub="Click a card to narrow the list">Accounts</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {data.cards.map((c: any) => (
          <Stat key={c.key} compact tone={CARD_TONE[c.key] ?? "indigo"} label={c.label} value={fmt(c.count)} active={card === c.key} onClick={() => onCard(c.key)}
            sub={c.key === "type:group" ? `${fmt(data.unique_gds)} groups` : undefined} />
        ))}
      </div>
      <div className="mt-2.5 scroll-mt-4" id="ao-account-list">
        <Card title={`${data.cards.find((c: any) => c.key === card)?.label ?? DRILL_LABEL[card] ?? "Accounts"}${f.owner ? ` · ${data.members.find((m: any) => m.owner_id === f.owner)?.name ?? ""}` : ""} — ${fmt(list.total)}`}
          right={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
                <input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Search company, domain or ID"
                  className="w-64 rounded-lg border border-line bg-surface py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <ManageColumns cols={colKeys} onChange={setColKeys} />
              <a href={csvHref} className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm"><Download className="h-3.5 w-3.5" />CSV</a>
            </div>
          }>
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-gradient-to-r from-indigo-500/15 via-violet-500/10 to-sky-500/10 backdrop-blur [&_th]:text-ink">
                <tr>{cols.map((c) => (
                  <SortHeader key={c.key} active={sort === c.key} dir={dir} onClick={() => onSort(c.key)} right={c.right}><span className="whitespace-nowrap text-[10px] uppercase tracking-wide">{c.label}</span></SortHeader>
                ))}</tr>
              </thead>
              <tbody>
                {list.rows.map((r: any) => (
                  <tr key={r.id} className="border-t border-line odd:bg-surface even:bg-surface-muted/40 hover:bg-indigo-500/[0.06]">
                    {cols.map((c) => <td key={c.key} className={cn("whitespace-nowrap px-2.5 py-1", c.right && "text-right")}>{c.cell(r, ctx)}</td>)}
                  </tr>
                ))}
                {list.rows.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-ink-subtle">No accounts match.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
            <span>Calls, emails and touchpoints are within the activity date range. Click a company or a GD Name for full details.</span>
            {list.pages > 1 && (
              <span className="inline-flex items-center gap-1">
                <button disabled={list.page <= 1} onClick={() => onPage(list.page - 1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
                Page {list.page} of {list.pages}
                <button disabled={list.page >= list.pages} onClick={() => onPage(list.page + 1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Deals & Activity tab ─────────────────────────────────────────────────────
function TeamChips({ team, onTeam }: { team: string; onTeam: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {[{ value: "", label: "All teams" }, ...TEAMS].map((t) => {
        const tt = TONE[t.value ? teamTone(t.value) : "indigo"];
        const on = team === t.value;
        return (
          <button key={t.value} onClick={() => onTeam(t.value)}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition",
              on ? cn("bg-gradient-to-r text-white shadow-sm", tt.bar) : "bg-surface/90 text-ink-muted ring-1 ring-line hover:text-ink")}>
            <span className={cn("h-2 w-2 rounded-full", on ? "bg-white" : tt.dot)} />{t.label}
          </button>
        );
      })}
    </div>
  );
}

/** "% worked" with a small coloured bar. */
function PctBar({ v }: { v: number | null }) {
  const w = v == null ? 0 : Math.round(v * 100);
  const bar = w >= 60 ? TONE.emerald.bar : w >= 30 ? TONE.amber.bar : TONE.rose.bar;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-muted"><span className={cn("block h-full rounded-full bg-gradient-to-r", bar)} style={{ width: `${w}%` }} /></span>
      <span className="w-11 text-right font-mono">{pct(v)}</span>
    </span>
  );
}

function TeamName({ team, label, onClick }: { team: string | null; label: string; onClick?: () => void }) {
  const dot = <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE[teamTone(team)].dot)} />;
  return onClick
    ? <button onClick={onClick} className="inline-flex items-center gap-1.5 whitespace-nowrap hover:text-primary">{dot}{label}</button>
    : <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{dot}{label}</span>;
}

const THEAD = "sticky top-0 z-[1] bg-gradient-to-r from-indigo-500/10 via-violet-500/[0.07] to-sky-500/10 backdrop-blur";

function ActivityTab({ data, f, qs, filterBar, dealSel, setDealSel, onTeam, openAccounts }: {
  data: any; f: UiFilters; qs: string; filterBar: React.ReactNode;
  dealSel: { team: string; owner: string; kind: string; title: string } | null;
  setDealSel: (d: { team: string; owner: string; kind: string; title: string } | null) => void;
  onTeam: (t: string) => void; openAccounts: (owner: string, team: string, drill: string, preset?: string) => void;
}) {
  const qLabel = data.meta.quarter?.label ?? "last quarter";
  const teamLabel = TEAMS.find((t) => t.value === f.team)?.label ?? "All teams";
  const showDeals = (team: string, owner: string, kind: string, title: string) => { setDealSel({ team, owner, kind, title }); };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const focusMember = (id: string) => {
    setOpen((cur) => new Set(cur).add(id));
    setTimeout(() => document.getElementById(`pipe-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const pipeMembers = (data.deal_members as any[]).filter((m) => m.deals > 0);
  const dealsOf = (id: string) => (data.deal_rows as any[]).filter((d) => d.sdr_id === id || d.owner_id === id);
  const up = data.util_period;
  const preset = up?.default_3m ? "3m" : undefined;

  return (
    <div>
      {filterBar}

      {/* 1. Demos & deals — last completed quarter */}
      <SectionTitle icon={CalendarCheck} tone="sky" sub="Only last-quarter deals are stored. Deals follow the Team and Team member filters. Click a number for the deal details.">
        Demos &amp; deals — {qLabel}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat tone="sky" label="Demos booked" value={fmt(data.deal_totals.booked)} sub={`HubSpot "Demo Scheduled for Date" in ${qLabel}`} onClick={() => showDeals(f.team, f.owner, "booked", `Demos booked — ${teamLabel}`)} />
        <Stat tone="emerald" label="Conducted" value={fmt(data.deal_totals.conducted)} sub={`HubSpot "Demo Completed Date" in ${qLabel}`} onClick={() => showDeals(f.team, f.owner, "conducted", `Demos conducted — ${teamLabel}`)} />
        <Stat tone="rose" label="Not conducted" value={fmt(data.deal_totals.not_conducted)} sub="Scheduled in the quarter, no Demo Completed Date" onClick={() => showDeals(f.team, f.owner, "not_conducted", `Demos not conducted — ${teamLabel}`)} />
        <Stat tone="violet" label="Total deals" value={fmt(data.deal_totals.deals)} sub="Created, booked or demo done in the quarter" onClick={() => showDeals(f.team, f.owner, "all", `All deals — ${teamLabel}`)} />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Card title="By team">
          <table className="w-full text-xs">
            <thead className={THEAD}><tr><TH>Team</TH><TH right>Members</TH><TH right>Demos booked</TH><TH right>Conducted</TH><TH right>Not conducted</TH><TH right>Total deals</TH></tr></thead>
            <tbody>{data.deal_teams.map((t: any) => (
              <tr key={t.team} className={cn("border-b border-line/60", f.team === t.team && cn("font-semibold", TONE[teamTone(t.team)].soft))}>
                <td className="px-2 py-1"><TeamName team={t.team} label={t.label} onClick={() => onTeam(t.team)} /></td>
                <td className="px-2 py-1 text-right font-mono">{fmt(t.members)}</td>
                <td className="px-2 py-1 text-right"><Num v={t.booked} strong onClick={() => showDeals(t.team, "", "booked", `Demos booked — ${t.label}`)} /></td>
                <td className="px-2 py-1 text-right"><Num v={t.conducted} onClick={() => showDeals(t.team, "", "conducted", `Demos conducted — ${t.label}`)} /></td>
                <td className="px-2 py-1 text-right"><Num v={t.not_conducted} onClick={() => showDeals(t.team, "", "not_conducted", `Demos not conducted — ${t.label}`)} /></td>
                <td className="px-2 py-1 text-right"><Num v={t.deals} onClick={() => showDeals(t.team, "", "all", `All deals — ${t.label}`)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title={`Deals by current stage — ${teamLabel}`}>
          {data.deal_stages.length === 0 ? <p className="text-xs text-ink-subtle">No deals in the quarter for these filters.</p> : (
            <table className="w-full text-xs">
              <tbody>{data.deal_stages.map((st: any) => {
                const max = Math.max(...data.deal_stages.map((x: any) => x.count));
                return (
                  <tr key={st.key} className="border-b border-line/60">
                    <td className="w-40 px-2 py-1">{st.label}</td>
                    <td className="px-2 py-1"><div className={cn("h-2.5 rounded-full bg-gradient-to-r", TONE.sky.bar)} style={{ width: `${(st.count / max) * 100}%` }} /></td>
                    <td className="w-14 px-2 py-1 text-right font-mono">{fmt(st.count)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </Card>
      </div>
      {dealSel && <DealList sel={dealSel} qs={qs} onClose={() => setDealSel(null)} />}

      {/* 2. Team selection + members */}
      <SectionTitle icon={Users} tone="violet" sub="Click a member to open their pipeline below">Team members — {teamLabel}</SectionTitle>
      <TeamChips team={f.team} onTeam={onTeam} />
      <div className="mt-2">
        <Card title={`Members — ${teamLabel}`}>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className={THEAD}><tr><TH>Member</TH><TH>Role</TH><TH right>Demos booked</TH><TH right>Conducted</TH><TH right>Not conducted</TH><TH right>Total deals</TH></tr></thead>
              <tbody>{data.deal_members.map((m: any) => (
                <tr key={m.owner_id} className="border-b border-line/60">
                  <td className="px-2 py-1"><TeamName team={m.team} label={m.name} onClick={m.deals ? () => focusMember(m.owner_id) : undefined} /></td>
                  <td className="px-2 py-1"><RoleChip role={m.role} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.booked} strong onClick={() => showDeals("", m.owner_id, "booked", `Demos booked — ${m.name}`)} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.conducted} onClick={() => showDeals("", m.owner_id, "conducted", `Demos conducted — ${m.name}`)} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.not_conducted} onClick={() => showDeals("", m.owner_id, "not_conducted", `Demos not conducted — ${m.name}`)} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.deals} onClick={() => focusMember(m.owner_id)} /></td>
                </tr>
              ))}
              {data.deal_members.length === 0 && <tr><td colSpan={6} className="px-2 py-6 text-center text-ink-subtle">No members in this team.</td></tr>}</tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-ink-subtle">
            Members = each person&apos;s HubSpot main team. A team&apos;s deals = deals whose HubSpot Team is that team (Auto Pipeline only).
            A member&apos;s numbers = every deal in their name (as SDR or deal owner). Booked = Demo Scheduled for Date, Conducted = Demo Completed Date
            (both in the quarter); Not conducted = scheduled in the quarter with no Demo Completed Date.
          </p>
        </Card>
      </div>

      {/* 3. Pipeline of the chosen team — every member, their deals grouped by stage */}
      <SectionTitle icon={Layers} tone="emerald" sub={`${qLabel} deals per member, grouped by current stage · click a name to open`}>
        Pipeline — {teamLabel}
      </SectionTitle>
      <div className="mb-2 flex gap-2 text-[11px]">
        <button onClick={() => setOpen(new Set(pipeMembers.map((m) => m.owner_id)))} className="rounded-lg border border-line bg-surface px-2 py-1 text-ink-muted hover:text-ink">Open all</button>
        <button onClick={() => setOpen(new Set())} className="rounded-lg border border-line bg-surface px-2 py-1 text-ink-muted hover:text-ink">Close all</button>
      </div>
      <div className="space-y-2">
        {pipeMembers.map((m) => {
          const rows = dealsOf(m.owner_id);
          const stages = [...new Map(rows.map((d) => [d.stage_key, { key: d.stage_key, label: d.stage, rank: d.stage_rank }])).values()]
            .sort((a, b) => a.rank - b.rank);
          const isOpen = open.has(m.owner_id);
          return (
            <div key={m.owner_id} id={`pipe-${m.owner_id}`} className="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
              <button onClick={() => toggle(m.owner_id)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-surface-muted/50">
                <ChevronDown className={cn("h-4 w-4 text-ink-subtle transition", !isOpen && "-rotate-90")} />
                <TeamName team={m.team} label={m.name} />
                <RoleChip role={m.role} />
                <span className="text-[11px] text-ink-subtle">{fmt(rows.length)} deal{rows.length === 1 ? "" : "s"}</span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {stages.map((st) => (
                    <span key={st.key} className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-ink-muted">
                      {st.label} <b className="font-mono text-ink">{rows.filter((d) => d.stage_key === st.key).length}</b>
                    </span>
                  ))}
                </span>
              </button>
              {isOpen && (
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full text-xs">
                    <thead className={THEAD}><tr><TH>Deal</TH><TH>Company</TH><TH right>Amount</TH><TH>Their role</TH><TH>SDR</TH><TH>Deal owner</TH><TH>Created</TH><TH>Demo booked</TH><TH>Demo done</TH><TH>Close date</TH></tr></thead>
                    <tbody>{stages.map((st) => (
                      <Fragment key={st.key}>
                        <tr className="bg-surface-muted/60"><td colSpan={10} className="px-2 py-1 text-[11px] font-bold text-ink">{st.label} · {rows.filter((d) => d.stage_key === st.key).length}</td></tr>
                        {rows.filter((d) => d.stage_key === st.key).map((d) => (
                          <tr key={d.id} className="border-b border-line/60">
                            <td className="whitespace-nowrap px-2 py-1"><a href={dealUrl(d.id)} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:text-primary">{d.name}</a></td>
                            <td className="whitespace-nowrap px-2 py-1">{d.company_id ? <a href={companyUrl(d.company_id)} target="_blank" rel="noreferrer" className="hover:text-primary">{d.company_name ?? d.company_id}</a> : <span className="text-ink-subtle">No company</span>}</td>
                            <td className="px-2 py-1 text-right font-mono">{d.amount == null ? "—" : `$${fmt(Math.round(d.amount))}`}</td>
                            <td className="px-2 py-1 text-[11px]">{d.sdr_id === m.owner_id && d.owner_id === m.owner_id ? "SDR + owner" : d.sdr_id === m.owner_id ? "SDR" : "Deal owner"}</td>
                            <td className="whitespace-nowrap px-2 py-1">{d.sdr}</td>
                            <td className="whitespace-nowrap px-2 py-1">{d.owner}</td>
                            <td className="whitespace-nowrap px-2 py-1">{etDay(d.created_ms)}</td>
                            <td className="whitespace-nowrap px-2 py-1">{etDay(d.booked_ms)}</td>
                            <td className="whitespace-nowrap px-2 py-1">{etDay(d.conducted_ms)}</td>
                            <td className="whitespace-nowrap px-2 py-1">{etDay(d.close_ms)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {pipeMembers.length === 0 && <p className="text-xs text-ink-subtle">No deals in the quarter for these filters.</p>}
      </div>

      {/* 4. Are members using their accounts and contacts? — a funnel per member */}
      <SectionTitle icon={Target} tone="rose"
        sub={`Each member's OWN accounts · ${etDay(up.from)} – ${etDay(up.to - 1)}${up.default_3m ? " (last 3 months — set an Activity date range to change it)" : ""} · demos are ${qLabel}`}>
        Are members using their accounts and contacts?
      </SectionTitle>
      <Card title={`Members — ${teamLabel}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={THEAD}>
              <tr className="text-[9px] uppercase tracking-wide text-ink-subtle">
                <th colSpan={2} />
                <th colSpan={3} className="border-l border-line px-2 pt-1 text-center">Their accounts</th>
                <th colSpan={3} className="border-l border-line px-2 pt-1 text-center">Contacts</th>
                <th colSpan={4} className="border-l border-line px-2 pt-1 text-center">ICP accounts</th>
                <th colSpan={4} className="border-l border-line px-2 pt-1 text-center">Meetings &amp; demos</th>
                <th className="border-l border-line" />
              </tr>
              <tr>
                <TH>Member</TH><TH>Role</TH>
                <TH right>Owned</TH><TH right>Worked</TH><TH right>% worked</TH>
                <TH right>Contacts</TH><TH right>Reached</TH><TH right>Connected</TH>
                <TH right>ICP</TH><TH right>Worked</TH><TH right>Connected</TH><TH right>Meeting / demo</TH>
                <TH right>Meetings booked</TH><TH right>Meetings logged</TH><TH right>Demos booked</TH><TH right>Demos done</TH>
                <TH right>Touches / worked acct</TH>
              </tr>
            </thead>
            <tbody>{data.utilization.map((m: any) => (
              <tr key={m.owner_id} className="border-b border-line/60">
                <td className="px-2 py-1"><TeamName team={m.team} label={m.name} />{!m.in_team && <span className="ml-1 text-[10px] text-ink-subtle">(not in team)</span>}</td>
                <td className="px-2 py-1"><RoleChip role={m.role} /></td>
                <td className="border-l border-line/60 px-2 py-1 text-right"><Num v={m.accounts} onClick={() => openAccounts(m.owner_id, "", "", preset)} /></td>
                <td className="px-2 py-1 text-right"><Num v={m.worked} onClick={() => openAccounts(m.owner_id, "", "contacted", preset)} /></td>
                <td className="px-2 py-1 text-right"><PctBar v={m.pct_worked} /></td>
                <td className="border-l border-line/60 px-2 py-1 text-right font-mono">{fmt(m.contacts)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(m.contacts_reached)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(m.contacts_connected)}</td>
                <td className="border-l border-line/60 px-2 py-1 text-right"><Num v={m.icp_accounts} onClick={() => openAccounts(m.owner_id, "", "icp:yes", preset)} /></td>
                <td className="px-2 py-1 text-right"><Num v={m.icp_worked} onClick={() => openAccounts(m.owner_id, "", "icp_contacted", preset)} /></td>
                <td className="px-2 py-1 text-right font-mono">{fmt(m.icp_connected)}</td>
                <td className="px-2 py-1 text-right font-mono font-semibold">{fmt(m.icp_meeting_or_demo)}</td>
                <td className="border-l border-line/60 px-2 py-1 text-right font-mono">{fmt(m.meetings_booked)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(m.meetings_logged)}</td>
                <td className="px-2 py-1 text-right font-mono font-semibold text-sky-500">{fmt(m.demos_booked)}</td>
                <td className="px-2 py-1 text-right font-mono font-semibold text-emerald-500">{fmt(m.demos_done)}</td>
                <td className="border-l border-line/60 px-2 py-1 text-right font-mono">{m.touches_per_worked == null ? "—" : m.touches_per_worked.toFixed(1)}</td>
              </tr>
            ))}
            {data.utilization.length === 0 && <tr><td colSpan={17} className="px-2 py-6 text-center text-ink-subtle">No members in these filters.</td></tr>}</tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
          Everything is about the accounts the member OWNS (HubSpot company owner), whoever did the work.
          Worked = at least one call or email in the date range. Reached = contacts called or emailed; Connected = a live
          conversation (the 11 connected call outcomes), a meeting or an email reply. ICP Meeting / demo = ICP accounts with a
          meeting booked on a call, a meeting logged, or a demo booked. Meetings booked = calls logged with the outcome
          Meeting Scheduled / Rescheduled; Meetings logged = HubSpot meeting records (their outcome is rarely filled in).
          Demos booked / done = Auto-Pipeline deals on their accounts in {qLabel}.
        </p>
      </Card>
    </div>
  );
}

function DealList({ sel, qs, onClose }: { sel: { team: string; owner: string; kind: string; title: string }; qs: string; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(qs);
    p.set("view", "deals"); p.set("dkind", sel.kind);
    if (sel.team) p.set("dteam", sel.team);
    if (sel.owner) p.set("downer", sel.owner);
    setRows(null); setErr(null);
    fetch(`/api/accounts-overview?${p}`).then((r) => r.json()).then((j) => setRows(j.deals ?? [])).catch((e) => setErr(String(e)));
  }, [sel, qs]);
  return (
    <div className="mt-4">
      <Card title={`${sel.title}${rows ? ` — ${fmt(rows.length)}` : ""}`}
        right={<button onClick={onClose} className="rounded p-1 text-ink-subtle hover:bg-surface-muted"><X className="h-4 w-4" /></button>}>
        {err && <Note tone="warn">{err}</Note>}
        {!rows && !err && <div className="flex items-center gap-2 py-6 text-xs text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading deals…</div>}
        {rows && (
          <div className="max-h-[480px] overflow-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-muted"><tr>
                <TH>Deal</TH><TH>Company</TH><TH>Stage</TH><TH right>Amount</TH><TH>SDR</TH><TH>Deal owner</TH><TH>Team</TH>
                <TH>Created</TH><TH>Demo booked</TH><TH>Demo conducted</TH><TH>Close date</TH>
              </tr></thead>
              <tbody>{rows.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="px-2 py-1"><a href={dealUrl(d.id)} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:text-primary">{d.name}</a></td>
                  <td className="px-2 py-1">{d.company_id ? <a href={companyUrl(d.company_id)} target="_blank" rel="noreferrer" className="hover:text-primary">{d.company_name ?? d.company_id}</a> : <span className="text-ink-subtle">No company</span>}</td>
                  <td className="px-2 py-1">{d.stage}</td>
                  <td className="px-2 py-1 text-right font-mono">{d.amount == null ? "—" : `$${fmt(Math.round(d.amount))}`}</td>
                  <td className="px-2 py-1">{d.sdr}</td>
                  <td className="px-2 py-1">{d.owner}</td>
                  <td className="px-2 py-1">{d.team ?? "—"}</td>
                  <td className="px-2 py-1">{etDay(d.created_ms)}</td>
                  <td className="px-2 py-1">{etDay(d.booked_ms)}</td>
                  <td className="px-2 py-1">{etDay(d.conducted_ms)}</td>
                  <td className="px-2 py-1">{etDay(d.close_ms)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="px-2 py-6 text-center text-ink-subtle">No deals.</td></tr>}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
