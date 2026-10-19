"use client";
/**
 * Accounts Overview (/accounts-overview) — two tabs, one shared filter bar, no filter applied by default.
 *   · Accounts — HubSpot US TAM (all companies, not filtered) → filters → team cards → member cards
 *     of the chosen team → the account list (cards drill it).
 *   · Deals & Activity — accounts worked / not worked in 60 days (team → members), last-quarter
 *     demos and deals (team → members → deal details), and account/contact coverage per member.
 * Data: /api/accounts-overview (isolated sdr_ao_* tables, computed server-side in memory).
 * Filters live in the URL so every view is shareable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Building2, CalendarCheck, ChevronLeft, ChevronRight, Download, ExternalLink, Globe2, Loader2, RotateCcw, Search,
  SlidersHorizontal, Target, UserRound, Users, X, type LucideIcon,
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
/** List titles for drills opened from the Deals & Activity tab (not one of the 8 cards). */
const DRILL_LABEL: Record<string, string> = {
  contacted: "Contacted in the date range", not_contacted: "Not contacted in the date range",
  "icp:yes": "ICP accounts", icp_contacted: "ICP accounts contacted",
};
const ROLE_CLS: Record<string, string> = { Manager: "bg-good-weak text-good", SDR: "bg-primary/10 text-primary", AE: "bg-warm-weak text-warm" };

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

  /** Jump from a Deals & Activity number to the matching account list. */
  const openAccounts = (owner: string, team: string, drill: string) => {
    setF((cur) => ({ ...cur, owner, team: team || cur.team }));
    setCard(drill); setQ(""); setPageNo(1); setTab("accounts");
    window.scrollTo({ top: 0 });
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
          {([["accounts", "Accounts", Building2], ["activity", "Deals & Activity", Activity]] as const).map(([k, l, Icon]) => (
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

function Stat({ label, value, sub, active, onClick, tone = "indigo" }: { label: string; value: string; sub?: string; active?: boolean; onClick?: () => void; tone?: Tone }) {
  const Tag = onClick ? "button" : "div";
  const t = TONE[tone];
  return (
    <Tag onClick={onClick} className={cn("relative overflow-hidden rounded-card border px-3 py-2.5 text-left", t.card, t.lift, active && t.ring)}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted"><span className={cn("h-2 w-2 rounded-full", t.dot)} />{label}</div>
      <div className={cn("mt-0.5 font-mono text-xl font-bold tabular-nums", t.text)}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{sub}</div>}
    </Tag>
  );
}

function Avatar({ name, tone }: { name: string; tone: Tone }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold", TONE[tone].soft)}>{initials}</span>;
}

// ── Accounts tab ─────────────────────────────────────────────────────────────
function AccountsTab({ data, f, filterBar, card, q, sort, dir, csvHref, onTeam, onOwner, onCard, onQ, onSort, onPage, onOpen, onGroup }: {
  data: any; f: UiFilters; filterBar: React.ReactNode; card: string; q: string; sort: string; dir: "asc" | "desc"; csvHref: string;
  onTeam: (t: string) => void; onOwner: (o: string) => void; onCard: (k: string) => void; onQ: (v: string) => void;
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

      {/* 3. Teams */}
      <SectionTitle icon={Users} tone="violet" sub="Click a team to see its members">Teams</SectionTitle>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {data.teams.map((t: any) => {
          const tt = TONE[teamTone(t.team)];
          return (
          <button key={t.team} onClick={() => onTeam(t.team)}
            className={cn("rounded-card border px-3 py-2.5 text-left", tt.card, tt.lift, f.team === t.team && tt.ring)}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-ink"><span className={cn("h-2.5 w-2.5 rounded-full", tt.dot)} />{t.label}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", tt.soft)}>{t.members} member{t.members === 1 ? "" : "s"}</span>
            </div>
            <div className={cn("mt-1 font-mono text-2xl font-bold tabular-nums", tt.text)}>{fmt(t.total)}</div>
            <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px]">
              <div><div className="text-ink-subtle">Group</div><div className="font-mono font-semibold">{fmt(t.group)}</div></div>
              <div><div className="text-ink-subtle">Single Fr.</div><div className="font-mono font-semibold">{fmt(t.single_franchise)}</div></div>
              <div><div className="text-ink-subtle">Single Ind.</div><div className="font-mono font-semibold">{fmt(t.independent)}</div></div>
            </div>
            <div className="mt-1.5 border-t border-line pt-1 text-[10px] text-ink-subtle">
              Accounts by owner role: {t.by_role.map((r: any) => `${r.role} ${fmt(r.accounts)}`).join(" · ")}
            </div>
          </button>
          );
        })}
      </div>

      {/* 4. Members of the chosen team */}
      <SectionTitle icon={UserRound} tone={f.team ? teamTone(f.team) : "sky"} sub={f.team ? "Click a member to list their accounts below" : "Pick a team above to see only its members"}>
        Team members — {teamLabel ?? "all teams"}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {data.members.map((m: any) => (
          <button key={m.owner_id} onClick={() => onOwner(m.owner_id)}
            className={cn("rounded-card border border-line bg-surface p-2 text-left", TONE[teamTone(m.team)].lift,
              f.owner === m.owner_id && TONE[teamTone(m.team)].ring, !m.in_team && "opacity-80")}>
            <div className="flex items-center gap-2">
              <Avatar name={m.name} tone={teamTone(m.team)} />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-ink" title={m.name}>{m.name}</div>
                <div className="flex items-center gap-1"><RoleChip role={m.role} />
                  <span className="truncate text-[10px] text-ink-subtle">{m.in_team ? `${m.team} Team` : m.owner_id === "none" ? "" : m.team ? `${m.team} Team member` : "not in a team"}</span></div>
              </div>
            </div>
            <div className={cn("mt-1 font-mono text-lg font-bold tabular-nums", TONE[teamTone(m.team)].text)}>{fmt(m.total)}</div>
            <div className="text-[10px] text-ink-subtle">accounts · G {fmt(m.group)} · SF {fmt(m.single_franchise)} · SI {fmt(m.independent)}</div>
          </button>
        ))}
        {data.members.length === 0 && <p className="col-span-full text-xs text-ink-subtle">No members match these filters.</p>}
      </div>

      {/* 5. Accounts */}
      <SectionTitle icon={Building2} tone="indigo" sub="Click a card to narrow the list">Accounts</SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {data.cards.map((c: any) => (
          <Stat key={c.key} tone={CARD_TONE[c.key] ?? "indigo"} label={c.label} value={fmt(c.count)} active={card === c.key} onClick={() => onCard(c.key)}
            sub={c.key === "type:group" ? `${fmt(data.unique_gds)} groups` : undefined} />
        ))}
      </div>
      <div className="mt-2.5">
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
  onTeam: (t: string) => void; openAccounts: (owner: string, team: string, drill: string) => void;
}) {
  const qLabel = data.meta.quarter?.label ?? "last quarter";
  const period = data.meta.period;
  const teamLabel = TEAMS.find((t) => t.value === f.team)?.label ?? "All teams";
  const showDeals = (team: string, owner: string, kind: string, title: string) => { setDealSel({ team, owner, kind, title }); };

  return (
    <div>
      {filterBar}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <TeamChips team={f.team} onTeam={onTeam} />
        <span className="text-[11px] text-ink-subtle">Activity date range: {etDay(period.from)} – {etDay(period.to - 1)}</span>
      </div>

      {/* 1. Worked in the last 60 days */}
      <SectionTitle icon={Activity} tone="teal" sub="Based on each company's HubSpot Last Activity Date. Click a number to see those accounts.">
        Accounts worked in the last 60 days
      </SectionTitle>
      <div className="grid gap-3 xl:grid-cols-[2fr_3fr]">
        <Card title="By team">
          <table className="w-full text-xs">
            <thead className={THEAD}><tr><TH>Team</TH><TH right>Accounts</TH><TH right>Worked &lt;60d</TH><TH right>Not worked 60+d</TH><TH right>No activity</TH><TH right>% worked</TH></tr></thead>
            <tbody>{data.activity_teams.map((t: any) => (
              <tr key={t.team} className={cn("border-b border-line/60", f.team === t.team && cn("font-semibold", TONE[teamTone(t.team)].soft))}>
                <td className="px-2 py-1"><TeamName team={t.team} label={t.label} onClick={() => onTeam(t.team)} /></td>
                <td className="px-2 py-1 text-right"><Num v={t.accounts} onClick={() => openAccounts("", t.team, "")} /></td>
                <td className="px-2 py-1 text-right"><Num v={t.worked_60} onClick={() => openAccounts("", t.team, "cstatus:active")} /></td>
                <td className="px-2 py-1 text-right"><Num v={t.not_worked_60} onClick={() => openAccounts("", t.team, "cstatus:inactive_60plus")} /></td>
                <td className="px-2 py-1 text-right"><Num v={t.no_activity} onClick={() => openAccounts("", t.team, "cstatus:no_activity")} /></td>
                <td className="px-2 py-1 text-right"><PctBar v={t.pct_worked} /></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title={`Members — ${teamLabel}`}>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className={THEAD}><tr><TH>Member</TH><TH>Role</TH><TH right>Accounts</TH><TH right>Worked &lt;60d</TH><TH right>Not worked 60+d</TH><TH right>No activity</TH><TH right>% worked</TH></tr></thead>
              <tbody>{data.activity_members.map((m: any) => (
                <tr key={m.owner_id} className="border-b border-line/60">
                  <td className="px-2 py-1"><TeamName team={m.team} label={m.name} />{!m.in_team && m.owner_id !== "none" && <span className="ml-1 text-[10px] text-ink-subtle">(not in team)</span>}</td>
                  <td className="px-2 py-1"><RoleChip role={m.role} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.accounts} onClick={() => openAccounts(m.owner_id, "", "")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.worked_60} onClick={() => openAccounts(m.owner_id, "", "cstatus:active")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.not_worked_60} strong onClick={() => openAccounts(m.owner_id, "", "cstatus:inactive_60plus")} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.no_activity} onClick={() => openAccounts(m.owner_id, "", "cstatus:no_activity")} /></td>
                  <td className="px-2 py-1 text-right"><PctBar v={m.pct_worked} /></td>
                </tr>
              ))}
              {data.activity_members.length === 0 && <tr><td colSpan={7} className="px-2 py-6 text-center text-ink-subtle">No members in these filters.</td></tr>}</tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 2. Demos and deals — last quarter */}
      <SectionTitle icon={CalendarCheck} tone="sky" sub="Only last-quarter deals are stored. Deals follow the Team and Team member filters. Click a number for the deal details.">
        Demos &amp; deals — {qLabel}
      </SectionTitle>
      <div className="grid grid-cols-3 gap-2.5">
        <Stat tone="sky" label="Demos booked" value={fmt(data.deal_totals.booked)} sub="Deal reached Discovery Call Done" onClick={() => showDeals(f.team, f.owner, "booked", `Demos booked — ${teamLabel}`)} />
        <Stat tone="emerald" label="Demos conducted" value={fmt(data.deal_totals.conducted)} sub="Deal reached Demo Done / Accepted / In Discussion" onClick={() => showDeals(f.team, f.owner, "conducted", `Demos conducted — ${teamLabel}`)} />
        <Stat tone="violet" label="Deals in the quarter" value={fmt(data.deal_totals.deals)} sub="Created, booked or demo done in the quarter" onClick={() => showDeals(f.team, f.owner, "all", `All deals — ${teamLabel}`)} />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[2fr_3fr]">
        <div className="space-y-3">
          <Card title="By team">
            <table className="w-full text-xs">
              <thead className={THEAD}><tr><TH>Team</TH><TH right>Demos booked</TH><TH right>Demos conducted</TH><TH right>Deals</TH></tr></thead>
              <tbody>{data.deal_teams.map((t: any) => (
                <tr key={t.team} className={cn("border-b border-line/60", f.team === t.team && cn("font-semibold", TONE[teamTone(t.team)].soft))}>
                  <td className="px-2 py-1"><TeamName team={t.team} label={t.label} onClick={() => onTeam(t.team)} /></td>
                  <td className="px-2 py-1 text-right"><Num v={t.booked} onClick={() => showDeals(t.team, "", "booked", `Demos booked — ${t.label}`)} /></td>
                  <td className="px-2 py-1 text-right"><Num v={t.conducted} onClick={() => showDeals(t.team, "", "conducted", `Demos conducted — ${t.label}`)} /></td>
                  <td className="px-2 py-1 text-right"><Num v={t.deals} onClick={() => showDeals(t.team, "", "all", `All deals — ${t.label}`)} /></td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
          <Card title={`Pipeline by current stage — ${teamLabel}`}>
            {data.deal_stages.length === 0 ? <p className="text-xs text-ink-subtle">No deals in the quarter for these filters.</p> : (
              <table className="w-full text-xs">
                <tbody>{data.deal_stages.map((s: any) => {
                  const max = Math.max(...data.deal_stages.map((x: any) => x.count));
                  return (
                    <tr key={s.key} className="border-b border-line/60">
                      <td className="w-40 px-2 py-1">{s.label}</td>
                      <td className="px-2 py-1"><div className={cn("h-2.5 rounded-full bg-gradient-to-r", TONE.sky.bar)} style={{ width: `${(s.count / max) * 100}%` }} /></td>
                      <td className="w-14 px-2 py-1 text-right font-mono">{fmt(s.count)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
          </Card>
        </div>
        <Card title={`Members — ${teamLabel}`}>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-xs">
              <thead className={THEAD}><tr><TH>Member</TH><TH>Role</TH><TH right>Demos booked</TH><TH right>Demos conducted</TH><TH right>Deals in their name</TH></tr></thead>
              <tbody>{data.deal_members.map((m: any) => (
                <tr key={m.owner_id} className="border-b border-line/60">
                  <td className="px-2 py-1"><TeamName team={m.team} label={m.name} />{!m.in_team && <span className="ml-1 text-[10px] text-ink-subtle">(not in team)</span>}</td>
                  <td className="px-2 py-1"><RoleChip role={m.role} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.booked} onClick={() => showDeals(f.team, m.owner_id, "booked", `Demos booked by ${m.name}`)} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.conducted} onClick={() => showDeals(f.team, m.owner_id, "conducted", `Demos conducted by ${m.name}`)} /></td>
                  <td className="px-2 py-1 text-right"><Num v={m.deals} strong onClick={() => showDeals(f.team, m.owner_id, "all", `Deals of ${m.name}`)} /></td>
                </tr>
              ))}
              {data.deal_members.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-ink-subtle">No deals in the quarter for these filters.</td></tr>}</tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-ink-subtle">Demos booked are credited to the deal&apos;s SDR (SDR Owner); demos conducted to the deal owner (the AE). Deals in their name = either.</p>
        </Card>
      </div>
      {dealSel && <DealList sel={dealSel} qs={qs} onClose={() => setDealSel(null)} />}

      {/* 3. Account & contact coverage */}
      <SectionTitle icon={Target} tone="rose" sub="Each member's OWN accounts, within the activity date range">
        Are members using their accounts and contacts?
      </SectionTitle>
      <Card title={`Members — ${teamLabel}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={THEAD}><tr>
              <TH>Member</TH><TH>Role</TH><TH right>Accounts</TH><TH right>Accounts contacted</TH><TH right>Not contacted</TH>
              <TH right>Contacts</TH><TH right>Contacts reached</TH><TH right>Not reached</TH>
              <TH right>ICP accounts</TH><TH right>ICP contacted</TH><TH right>Avg calls / ICP</TH><TH right>Avg emails / ICP</TH>
            </tr></thead>
            <tbody>{data.utilization.map((m: any) => (
              <tr key={m.owner_id} className="border-b border-line/60">
                <td className="px-2 py-1"><TeamName team={m.team} label={m.name} />{!m.in_team && <span className="ml-1 text-[10px] text-ink-subtle">(not in team)</span>}</td>
                <td className="px-2 py-1"><RoleChip role={m.role} /></td>
                <td className="px-2 py-1 text-right"><Num v={m.accounts} onClick={() => openAccounts(m.owner_id, "", "")} /></td>
                <td className="px-2 py-1 text-right"><Num v={m.accounts_contacted} onClick={() => openAccounts(m.owner_id, "", "contacted")} /></td>
                <td className="px-2 py-1 text-right"><Num v={m.accounts_not_contacted} strong onClick={() => openAccounts(m.owner_id, "", "not_contacted")} /></td>
                <td className="px-2 py-1 text-right font-mono">{fmt(m.contacts)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(m.contacts_reached)}</td>
                <td className="px-2 py-1 text-right font-mono font-semibold text-rose-500">{fmt(m.contacts_not_reached)}</td>
                <td className="px-2 py-1 text-right"><Num v={m.icp_accounts} onClick={() => openAccounts(m.owner_id, "", "icp:yes")} /></td>
                <td className="px-2 py-1 text-right"><Num v={m.icp_contacted} onClick={() => openAccounts(m.owner_id, "", "icp_contacted")} /></td>
                <td className="px-2 py-1 text-right font-mono">{m.avg_calls_per_icp == null ? "—" : m.avg_calls_per_icp.toFixed(1)}</td>
                <td className="px-2 py-1 text-right font-mono">{m.avg_emails_per_icp == null ? "—" : m.avg_emails_per_icp.toFixed(1)}</td>
              </tr>
            ))}
            {data.utilization.length === 0 && <tr><td colSpan={12} className="px-2 py-6 text-center text-ink-subtle">No members in these filters.</td></tr>}</tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
          Accounts = companies the member owns. Contacted = at least one call or email (by anyone) in the date range.
          Contacts reached = contacts on their accounts who were called or emailed. Avg calls / emails per ICP = the member&apos;s
          own calls / emails on their ICP accounts ÷ their ICP accounts.
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
