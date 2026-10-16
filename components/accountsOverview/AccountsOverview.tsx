"use client";
/**
 * Accounts Overview (/accounts-overview) — kept deliberately simple:
 *   one filter bar (HubSpot-style) → two tabs:
 *   · Accounts — 8 count cards; clicking a card filters the searchable account list below it.
 *   · Pipeline & Activity — demos + deal pipeline, ICP contacted vs not, per-team-member work.
 * Data: /api/accounts-overview (isolated sdr_ao_* tables, filtered server-side in memory).
 * Filters live in the URL so every view is shareable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, RotateCcw, Search } from "lucide-react";
import AppNav from "../AppNav";
import { Viewer } from "../../lib/spine/types";
import { companyUrl } from "../../config/hubspot";
import { cn, SortHeader } from "../ui";
import { Card, etDay, etTime, fmt, ICP_LABEL, Note, pct, StatusChip, TH, TYPE_LABEL } from "./parts";
import AccountDetail from "./AccountDetail";

const TEAMS = [
  { value: "Neelima", label: "Neelima Team" },
  { value: "Prince", label: "Prince Team" },
  { value: "Saarthak", label: "Saarthak Team" },
  { value: "Central", label: "Central Team" },
];
const TH60 = { inact: 60, deep: 90 };

interface UiFilters {
  team: string; member: string; gd: string; dtype: string; country: string; state: string; owner: string;
  cpreset: string; cfrom: string; cto: string;
  atypes: string[];
  ppreset: string; pfrom: string; pto: string;
}
const DEFAULTS: UiFilters = {
  team: "", member: "", gd: "", dtype: "all", country: "USA", state: "all", owner: "",
  cpreset: "any", cfrom: "", cto: "", atypes: [], ppreset: "3m", pfrom: "", pto: "",
};

/** Only non-default values go into the URL / API query. */
function filterQuery(f: UiFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.team) p.set("teams", f.team);
  if (f.member) p.set("member", f.member);
  if (f.gd.trim()) p.set("gd", f.gd.trim());
  if (f.dtype !== "all") p.set("dtype", f.dtype);
  if (f.country !== "USA") p.set("country", f.country);
  if (f.state !== "all") p.set("state", f.state);
  if (f.owner) p.set("owner", f.owner);
  if (f.cpreset !== "any") p.set("cpreset", f.cpreset);
  if (f.cpreset === "custom") { p.set("cfrom", f.cfrom); p.set("cto", f.cto); }
  if (f.atypes.length) p.set("atypes", f.atypes.join(","));
  if (f.ppreset !== "3m") p.set("ppreset", f.ppreset);
  if (f.ppreset === "custom") { p.set("pfrom", f.pfrom); p.set("pto", f.pto); }
  return p;
}
function fromUrl(sp: URLSearchParams): UiFilters {
  const g = (k: string, d: string) => sp.get(k) ?? d;
  return {
    team: g("teams", ""), member: g("member", ""), gd: g("gd", ""), dtype: g("dtype", "all"), country: g("country", "USA"),
    state: g("state", "all"), owner: g("owner", ""), cpreset: g("cpreset", "any"), cfrom: g("cfrom", ""), cto: g("cto", ""),
    atypes: g("atypes", "").split(",").filter(Boolean), ppreset: g("ppreset", "3m"), pfrom: g("pfrom", ""), pto: g("pto", ""),
  };
}

const RANGE: [string, string][] = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["60d", "Last 60 days"], ["90d", "Last 90 days"], ["3m", "Last 3 months"], ["custom", "Custom range"]];
const ACT_TYPES: [string, string][] = [["call", "Calls"], ["email", "Emails"], ["meeting", "Meetings"], ["note", "Notes"], ["task", "Tasks"]];
const sel = "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-primary/30";

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

export default function AccountsOverview({ viewer }: { viewer: Viewer }) {
  const [f, setF] = useState<UiFilters>(DEFAULTS);
  const [tab, setTab] = useState<"accounts" | "pipeline">("accounts");
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

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setF(fromUrl(sp));
    if (sp.get("tab") === "pipeline") setTab("pipeline");
    setReady(true);
  }, []);

  const set = useCallback((p: Partial<UiFilters>) => {
    setF((cur) => ({ ...cur, ...p, ...("team" in p && p.team !== cur.team ? { member: "" } : {}) }));
    setPageNo(1);
  }, []);

  // Debounce the text inputs (GD Name, search) so typing doesn't fire a request per key.
  const [dq, setDq] = useState(q);
  const [dgd, setDgd] = useState(f.gd);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setDgd(f.gd); }, 350); return () => clearTimeout(t); }, [q, f.gd]);
  const qs = useMemo(() => filterQuery({ ...f, gd: dgd }).toString(), [f, dgd]);

  useEffect(() => {
    if (!ready) return;
    const url = new URLSearchParams(qs);
    if (tab === "pipeline") url.set("tab", "pipeline");
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
        if (!r.ok) throw new Error(j.error === "setup_required" ? "Data not available yet — the Accounts Overview sync has not run." : j.error || `HTTP ${r.status}`);
        setData({ ...j, __tab: tab });
      })
      .catch((e) => { if (e.name !== "AbortError") setError(String(e.message ?? e)); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [qs, tab, ready, card, dq, sort, dir, pageNo]);

  const meta = data?.meta;
  const opts = meta?.options;
  const memberOptions = useMemo(() => {
    if (!opts) return { roster: [] as any[], others: [] as any[] };
    const roster = (opts.members as any[]).filter((m) => !f.team || m.team === f.team);
    const ids = new Set(roster.map((m) => m.owner_id));
    return { roster, others: (opts.activity_owners as any[]).filter((o) => !ids.has(o.id)) };
  }, [opts, f.team]);

  const csvHref = useMemo(() => {
    const p = new URLSearchParams(qs); p.set("view", "accounts"); p.set("format", "csv");
    if (card) p.set("drill", card);
    if (dq.trim()) p.set("q", dq.trim());
    return `/api/accounts-overview?${p}`;
  }, [qs, card, dq]);

  const shown = data && data.__tab === tab ? data : null;

  return (
    <div className="min-h-screen bg-canvas">
      <AppNav active="accounts-overview" viewer={viewer} />
      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-ink">Accounts Overview</h1>
            <p className="text-xs text-ink-muted">Companies in the Neelima · Prince · Saarthak · Central HubSpot Teams</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {meta && (
              <span className={cn("rounded-full px-2.5 py-1 font-medium", meta.sync_status === "ok" ? "bg-good-weak text-good" : "bg-warn-weak text-warn")}>
                {meta.sync_status === "error" ? "Last sync failed · " : meta.sync_status === "running" ? "Sync running · " : ""}
                Updated {meta.synced_at ? etTime(Date.parse(meta.synced_at)) : "never"}
              </span>
            )}
            <button onClick={() => { setF(DEFAULTS); setCard(""); setQ(""); setPageNo(1); }}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-ink-muted hover:bg-surface-muted">
              <RotateCcw className="h-3.5 w-3.5" /> Reset filters
            </button>
          </div>
        </div>

        {/* Filters — apply to both tabs */}
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-3 shadow-card sm:grid-cols-4 lg:grid-cols-8">
          <Field label="Team">
            <select className={sel} value={f.team} onChange={(e) => set({ team: e.target.value })}>
              <option value="">All teams</option>
              {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Team member">
            <select className={sel} value={f.member} onChange={(e) => set({ member: e.target.value })} title="Shows accounts this person worked in the activity date range">
              <option value="">Everyone</option>
              {memberOptions.roster.length > 0 && (
                <optgroup label="Team members">
                  {memberOptions.roster.map((m: any) => <option key={`${m.team}-${m.owner_id}`} value={m.owner_id}>{m.name}{f.team ? "" : ` (${m.team})`}</option>)}
                </optgroup>
              )}
              {memberOptions.others.length > 0 && (
                <optgroup label="Others who worked these accounts">
                  {memberOptions.others.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </optgroup>
              )}
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
          <Field label="Country">
            <select className={sel} value={f.country} onChange={(e) => set({ country: e.target.value })}>
              <option value="USA">USA</option>
              <option value="all">All countries</option>
              {(opts?.countries ?? []).filter((c: any) => c.value !== "USA").map((c: any) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}
            </select>
          </Field>
          <Field label="State">
            <select className={sel} value={f.state} onChange={(e) => set({ state: e.target.value })}>
              <option value="all">All states</option>
              {(opts?.states ?? []).map((s: any) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}
            </select>
          </Field>
          <Field label="Account owner">
            <select className={sel} value={f.owner} onChange={(e) => set({ owner: e.target.value })}>
              <option value="">All owners</option>
              {(opts?.account_owners ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <DateRangeField label="Last Activity Date" preset={f.cpreset} from={f.cfrom} to={f.cto}
            presets={[["any", "Any date"], ...RANGE, ["none", "No activity date"]]}
            onChange={(p) => set({ ...(p.preset != null && { cpreset: p.preset }), ...(p.from != null && { cfrom: p.from }), ...(p.to != null && { cto: p.to }) })} />
          <div className="col-span-2 flex flex-wrap items-end gap-1.5 sm:col-span-4 lg:col-span-6">
            <span className="mr-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Activity type</span>
            {ACT_TYPES.map(([v, l]) => {
              const on = f.atypes.includes(v);
              return (
                <button key={v} onClick={() => set({ atypes: on ? f.atypes.filter((x) => x !== v) : [...f.atypes, v] })}
                  className={cn("rounded-full px-3 py-1 text-[11px] font-semibold", on ? "bg-primary text-primary-fg" : "bg-surface-muted text-ink-muted hover:text-ink")}>
                  {l}
                </button>
              );
            })}
            {f.atypes.length === 0 && <span className="pb-1 text-[11px] text-ink-subtle">All types</span>}
          </div>
          <div className="col-span-2">
            <DateRangeField label="Activity date range (calls, emails, demos)" preset={f.ppreset} from={f.pfrom} to={f.pto} presets={RANGE}
              onChange={(p) => set({ ...(p.preset != null && { ppreset: p.preset }), ...(p.from != null && { pfrom: p.from }), ...(p.to != null && { pto: p.to }) })} />
          </div>
        </div>

        <div className="mb-4 flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
          {([["accounts", "Accounts"], ["pipeline", "Pipeline & Activity"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("rounded-lg px-4 py-1.5 text-sm font-medium transition", tab === k ? "bg-primary text-primary-fg shadow-sm" : "text-ink-muted hover:bg-surface-muted hover:text-ink")}>
              {l}
            </button>
          ))}
          {loading && <Loader2 className="ml-auto mr-2 h-4 w-4 animate-spin text-ink-subtle" />}
        </div>

        {error && <div className="mb-4 rounded-card border border-warn/30 bg-warn-weak p-4 text-sm text-warn">{error}</div>}
        {(shown?.warnings ?? []).map((w: string) => <div key={w} className="mb-2"><Note tone="warn">{w}</Note></div>)}
        {!shown && !error && <div className="flex items-center gap-2 py-16 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}

        {shown && tab === "accounts" && (
          <AccountsTab data={shown} card={card} q={q} sort={sort} dir={dir} csvHref={csvHref}
            onCard={(k) => { setCard(k); setPageNo(1); }} onQ={(v) => { setQ(v); setPageNo(1); }}
            onSort={(k) => { if (sort === k) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k); setDir(k === "name" ? "asc" : "desc"); } setPageNo(1); }}
            onPage={setPageNo} onOpen={setDetail} />
        )}
        {shown && tab === "pipeline" && <PipelineTab data={shown} />}
      </main>
      {detail && <AccountDetail id={detail} qs={qs} th={TH60} onClose={() => setDetail(null)} />}
    </div>
  );
}

function AccountsTab({ data, card, q, sort, dir, csvHref, onCard, onQ, onSort, onPage, onOpen }: {
  data: any; card: string; q: string; sort: string; dir: "asc" | "desc"; csvHref: string;
  onCard: (k: string) => void; onQ: (v: string) => void; onSort: (k: string) => void; onPage: (p: number) => void; onOpen: (id: string) => void;
}) {
  const list = data.list;
  const SUB: Record<string, string> = {
    "": "Groups + single rooftops",
    "type:single_franchise": "GD Name empty · Franchise",
    "type:independent": "GD Name empty · Independent",
    "type:group": `GD Name set · ${fmt(data.unique_gds)} groups`,
    "cstatus:active": "Last Activity Date < 60 days",
    "cstatus:inactive_60plus": "Last Activity Date 60+ days ago",
    "never_contacted": "No call, email or meeting ever",
    "cstatus:no_activity": "Last Activity Date empty",
  };
  const cols: [string, string, boolean?][] = [
    ["name", "Company"], ["team", "Team"], ["owner_name", "Account owner"], ["type", "Type"], ["gd_name", "GD Name"],
    ["state", "State"], ["company_days", "Last activity"], ["calls", "Calls", true], ["emails", "Emails", true], ["touchpoints", "Touchpoints", true],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.cards.map((c: any) => (
          <button key={c.key} onClick={() => onCard(c.key)}
            className={cn("rounded-card border bg-surface p-3 text-left shadow-card transition hover:border-primary/40",
              card === c.key ? "border-primary ring-2 ring-primary/20" : "border-line")}>
            <div className="text-[11px] font-semibold text-ink-muted">{c.label}</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">{fmt(c.count)}</div>
            <div className="mt-0.5 text-[11px] text-ink-subtle">{SUB[c.key]}</div>
          </button>
        ))}
      </div>
      {data.unknown_type > 0 && (
        <p className="text-[11px] text-ink-subtle">{fmt(data.unknown_type)} accounts have no GD Name and no Type of Dealership, so they are in the total but not in any type card.</p>
      )}

      <Card title={`${data.cards.find((c: any) => c.key === card)?.label ?? "Accounts"} — ${fmt(list.total)}`}
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
              <input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Search company, domain or ID"
                className="w-64 rounded-lg border border-line bg-surface py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <a href={csvHref} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-fg"><Download className="h-3.5 w-3.5" />CSV</a>
          </div>
        }>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="bg-surface-muted/60">
              <tr>{cols.map(([k, l, right]) => (
                <SortHeader key={k} active={sort === k} dir={dir} onClick={() => onSort(k)} right={right}><span className="text-[10px] uppercase tracking-wide">{l}</span></SortHeader>
              ))}</tr>
            </thead>
            <tbody>
              {list.rows.map((r: any) => (
                <tr key={r.id} className="border-t border-line hover:bg-surface-muted/40">
                  <td className="px-3 py-1.5">
                    <button onClick={() => onOpen(r.id)} className="text-left font-semibold text-ink hover:text-primary">{r.name}</button>
                    <a href={companyUrl(r.id)} target="_blank" rel="noreferrer" title="Open in HubSpot" className="ml-1 inline-block text-ink-subtle hover:text-primary"><ExternalLink className="h-3 w-3" /></a>
                  </td>
                  <td className="px-3 py-1.5">{r.team ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.owner_name}</td>
                  <td className="px-3 py-1.5">{TYPE_LABEL[r.type]}</td>
                  <td className="px-3 py-1.5">{r.gd_name ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.state ?? "—"}</td>
                  <td className="px-3 py-1.5"><span className="mr-1">{etDay(r.company_last_activity_ms)}</span><StatusChip s={r.company_status} th={TH60} days={r.company_days} /></td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(r.calls)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(r.emails)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(r.touchpoints)}</td>
                </tr>
              ))}
              {list.rows.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-ink-subtle">No accounts match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
          <span>Calls, emails and touchpoints are within the activity date range. Click a company for full details.</span>
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
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-card">
      <div className="text-[11px] font-semibold text-ink-muted">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-subtle">{sub}</div>}
    </div>
  );
}

function PipelineTab({ data }: { data: any }) {
  const period = `${etDay(data.meta.period.from)} – ${etDay(data.meta.period.to - 1)}`;
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">Date range: <b>{period}</b> (change it with “Activity date range” above).</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Demos booked" value={fmt(data.demos.booked)} sub="Deals that reached Discovery Call Done" />
        <Stat label="Demos completed" value={fmt(data.demos.completed)} sub="Deals that reached Demo Done" />
        <Stat label="Accounts contacted" value={fmt(data.contacted)} sub={`of ${fmt(data.accounts)} accounts (called or emailed)`} />
        <Stat label="Demo booking rate" value={pct(data.demo_rate)} sub="Accounts with a demo ÷ accounts contacted" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Deal pipeline — demos booked in this range, by current stage">
          {data.stages.length === 0 ? <p className="text-xs text-ink-subtle">No demos booked in this date range.</p> : (
            <table className="w-full text-xs">
              <thead className="border-b border-line"><tr><TH>Current stage</TH><TH right>Deals</TH></tr></thead>
              <tbody>{data.stages.map((s: any) => (
                <tr key={s.key} className="border-b border-line/60"><td className="px-2 py-1.5">{s.label}</td><td className="px-2 py-1.5 text-right font-mono">{fmt(s.count)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
        <Card title="ICP — contacted vs not, and demos">
          <table className="w-full text-xs">
            <thead className="border-b border-line"><tr><TH>Company ICP</TH><TH right>Accounts</TH><TH right>Contacted</TH><TH right>Not contacted</TH><TH right>Demo booked</TH><TH right>Contacted, no demo</TH></tr></thead>
            <tbody>{data.icp.map((r: any) => (
              <tr key={r.icp} className={cn("border-b border-line/60", r.icp === "yes" && "font-semibold")}>
                <td className="px-2 py-1.5">{ICP_LABEL[r.icp]}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.accounts)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.contacted)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.not_contacted)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.demo_booked)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(r.contacted_no_demo)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-subtle">“Contacted” = at least one call or email in the date range.</p>
        </Card>
      </div>

      <Card title="Team members — accounts and touchpoints">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-line"><tr>
              <TH>Team member</TH><TH>Team</TH><TH right>Accounts owned</TH><TH right>Accounts worked</TH>
              <TH right>Calls</TH><TH right>Emails</TH><TH right>Touchpoints</TH><TH right>Touchpoints per account</TH>
            </tr></thead>
            <tbody>{data.members.map((m: any) => (
              <tr key={m.owner_id} className="border-b border-line/60">
                <td className="px-2 py-1.5">{m.name}{!m.in_team && <span className="ml-1 text-[10px] text-ink-subtle">(not in these teams)</span>}</td>
                <td className="px-2 py-1.5">{m.team ?? "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(m.accounts_owned)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(m.accounts_worked)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(m.calls)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(m.emails)}</td>
                <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmt(m.touchpoints)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{m.touch_per_account == null ? "—" : m.touch_per_account.toFixed(1)}</td>
              </tr>
            ))}
            {data.members.length === 0 && <tr><td colSpan={8} className="px-2 py-6 text-center text-ink-subtle">No team members in these filters.</td></tr>}</tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink-subtle">
          Accounts owned = HubSpot company owner. Accounts worked = accounts they called or emailed in the date range.
          Touchpoints = calls + emails. Touchpoints per account = touchpoints ÷ accounts worked.
        </p>
      </Card>
    </div>
  );
}
