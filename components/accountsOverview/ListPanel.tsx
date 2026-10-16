"use client";
/** Paginated, sortable server-side lists (accounts / contacts / activities) — used inline by the
 *  Contacts tab and as the drill-down drawer behind every clickable metric. */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, X } from "lucide-react";
import { companyUrl, contactUrl } from "../../config/hubspot";
import { cn, SortHeader } from "../ui";
import { etDay, etTime, fmt, ICP_LABEL, StatusChip, TYPE_LABEL } from "./parts";

export interface ListSpec {
  view: "accounts" | "contacts" | "activities"; drill: string; title: string;
  /** Scope added on top of the global filters (e.g. { teams: "Prince" } or { owner: id }). */
  extra?: Record<string, string>;
}

/** Global query + a drill's extra scope → the effective query (extra wins). */
export function scopedQs(qs: string, extra?: Record<string, string>): string {
  const p = new URLSearchParams(qs);
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
  return p.toString();
}
type Th = { inact: number; deep: number };

type Col = { key: string; label: string; right?: boolean; render: (r: any, th: Th, open: (id: string) => void) => React.ReactNode };

const COLS: Record<ListSpec["view"], Col[]> = {
  accounts: [
    { key: "name", label: "Company", render: (r, _t, open) => (
      <div className="min-w-[180px]">
        <button onClick={() => open(r.id)} className="text-left font-semibold text-ink hover:text-primary">{r.name}</button>
        <div className="flex items-center gap-1 text-[10px] text-ink-subtle">
          <span className="font-mono">{r.id}</span>
          <a href={companyUrl(r.id)} target="_blank" rel="noreferrer" title="Open in HubSpot"><ExternalLink className="h-3 w-3" /></a>
          {r.domain && <span className="truncate">· {r.domain}</span>}
        </div>
      </div>) },
    { key: "team", label: "Team", render: (r) => r.team ?? "—" },
    { key: "owner_name", label: "Account owner", render: (r) => r.owner_name },
    { key: "type", label: "Type", render: (r) => <span title={r.type_reason ?? undefined}>{TYPE_LABEL[r.type]}{r.gd_name ? <div className="text-[10px] text-ink-subtle">{r.gd_name}</div> : null}</span> },
    { key: "icp", label: "ICP", render: (r) => ICP_LABEL[r.icp] },
    { key: "company_days", label: "Company activity", render: (r, th) => <div><StatusChip s={r.company_status} th={th} days={r.company_days} /><div className="text-[10px] text-ink-subtle">{etDay(r.company_last_activity_ms)}</div></div> },
    { key: "rooftop_days", label: "Rooftop activity", render: (r, th) => <div><StatusChip s={r.rooftop_status} th={th} days={r.rooftop_days} /><div className="text-[10px] text-ink-subtle">{etDay(r.rooftop_last_activity_ms)}</div></div> },
    { key: "calls", label: "Calls", right: true, render: (r) => fmt(r.calls) },
    { key: "connected", label: "Conn.", right: true, render: (r) => fmt(r.connected) },
    { key: "emails", label: "Emails", right: true, render: (r) => fmt(r.emails) },
    { key: "meetings", label: "Mtgs", right: true, render: (r) => fmt(r.meetings) },
    { key: "demos_booked", label: "Demos", right: true, render: (r) => `${fmt(r.demos_booked)}${r.demos_completed ? ` / ${r.demos_completed}✓` : ""}` },
    { key: "touchpoints", label: "Touch", right: true, render: (r) => fmt(r.touchpoints) },
    { key: "contacts", label: "Contacts", right: true, render: (r) => fmt(r.contacts) },
    { key: "activity_owners", label: "Activity owners", render: (r) => <span className="text-[11px] text-ink-muted">{r.activity_owners.join(", ") || "—"}</span> },
  ],
  contacts: [
    { key: "name", label: "Contact", render: (r) => (
      <div className="min-w-[160px]">
        <a href={contactUrl(r.id)} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:text-primary">{r.name}</a>
        <div className="font-mono text-[10px] text-ink-subtle">{r.id}</div>
      </div>) },
    { key: "title", label: "Title", render: (r) => r.title ?? "—" },
    { key: "email", label: "Email / phone", render: (r) => <div className="text-[11px]">{r.email ?? "—"}<div className="text-ink-subtle">{r.phone ?? ""}</div></div> },
    { key: "company_name", label: "Company", render: (r, _t, open) => <button onClick={() => open(r.company_id)} className="text-left hover:text-primary">{r.company_name}</button> },
    { key: "account_owner", label: "Account owner", render: (r) => r.account_owner },
    { key: "contact_owner", label: "Contact owner", render: (r) => r.contact_owner },
    { key: "team", label: "Team", render: (r) => r.team ?? "—" },
    { key: "company_icp", label: "Co. ICP", render: (r) => ICP_LABEL[r.company_icp] },
    { key: "contact_icp", label: "Contact ICP", render: (r) => ICP_LABEL[r.contact_icp] },
    { key: "last_activity_ms", label: "Last activity", render: (r) => etDay(r.last_activity_ms) },
    { key: "last_call_ms", label: "Last call", render: (r) => etDay(r.last_call_ms) },
    { key: "last_email_ms", label: "Last email", render: (r) => etDay(r.last_email_ms) },
    { key: "calls", label: "Calls", right: true, render: (r) => fmt(r.calls) },
    { key: "connected", label: "Conn.", right: true, render: (r) => fmt(r.connected) },
    { key: "emails", label: "Emails", right: true, render: (r) => fmt(r.emails) },
    { key: "meetings", label: "Mtgs", right: true, render: (r) => fmt(r.meetings) },
    { key: "touchpoints", label: "Touch", right: true, render: (r) => fmt(r.touchpoints) },
    { key: "engagement", label: "Engagement", render: (r) => (
      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.engagement === "engaged" ? "bg-good-weak text-good" : r.engagement === "touched" ? "bg-primary-weak text-primary" : "bg-surface-muted text-ink-muted")}>
        {r.engagement === "engaged" ? "Engaged" : r.engagement === "touched" ? "Touched" : "Not touched"}
      </span>) },
  ],
  activities: [
    { key: "ts_ms", label: "Date / time (ET)", render: (r) => <span className="whitespace-nowrap">{etTime(r.ts_ms)}</span> },
    { key: "type", label: "Type", render: (r) => <span className="capitalize">{r.type}{r.direction ? <span className="text-[10px] text-ink-subtle"> · {r.direction.toLowerCase()}</span> : null}</span> },
    { key: "outcome", label: "Outcome", render: (r) => r.meeting_status ?? r.outcome ?? "—" },
    { key: "subject", label: "Subject", render: (r) => <span className="line-clamp-2 max-w-[260px] text-[11px]">{r.subject ?? "—"}</span> },
    { key: "company_names", label: "Company", render: (r, _t, open) => r.company_ids.map((id: string, i: number) => <button key={id} onClick={() => open(id)} className="mr-1 text-left hover:text-primary">{r.company_names[i]}</button>) },
    { key: "contact_names", label: "Contact", render: (r) => <span className="text-[11px]">{r.contact_names.join(", ") || "—"}</span> },
    { key: "owner_name", label: "Activity owner", render: (r) => <span>{r.owner_name}{r.owner_pod ? <span className="text-[10px] text-ink-subtle"> · pod {r.owner_pod}</span> : null}</span> },
    { key: "teams", label: "Account team", render: (r) => r.teams.join(", ") || "—" },
    { key: "duration_ms", label: "Duration", right: true, render: (r) => (r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : "—") },
    { key: "id", label: "Record", render: (r) => <span className="font-mono text-[10px] text-ink-subtle" title={r.via_contact_only ? "Attributed to the account through a contact" : "Associated directly to the account"}>{r.id}{r.via_contact_only ? " ·c" : ""}</span> },
  ],
};

export function ListTable({ spec, qs: globalQs, th, onOpenAccount, compact, initialSort, initialDir }: {
  spec: ListSpec; qs: string; th: Th; onOpenAccount: (id: string) => void; compact?: boolean;
  initialSort?: string; initialDir?: "asc" | "desc";
}) {
  const qs = scopedQs(globalQs, spec.extra);
  const csv = (() => { const p = new URLSearchParams(qs); p.set("view", spec.view); p.set("format", "csv"); if (spec.drill) p.set("drill", spec.drill); return `/api/accounts-overview?${p}`; })();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(initialSort ?? (spec.view === "activities" ? "ts_ms" : "name"));
  const [dir, setDir] = useState<"asc" | "desc">(initialDir ?? (spec.view === "activities" ? "desc" : "asc"));
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [qs, spec.drill, spec.view]);
  useEffect(() => {
    const ac = new AbortController();
    const p = new URLSearchParams(qs);
    p.set("view", spec.view); p.set("page", String(page)); p.set("size", compact ? "25" : "50");
    if (spec.drill) p.set("drill", spec.drill);
    if (spec.view !== "activities") { p.set("sort", sort); p.set("dir", dir); }
    setLoading(true); setErr(null);
    fetch(`/api/accounts-overview?${p}`, { signal: ac.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setRes(j); })
      .catch((e) => { if (e.name !== "AbortError") setErr(String(e.message ?? e)); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [qs, spec.view, spec.drill, page, sort, dir, compact]);

  const list = res?.list;
  const cols = COLS[spec.view];
  const toggle = (k: string) => { if (spec.view === "activities") return; if (sort === k) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k); setDir("asc"); } };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>{list ? `${fmt(list.total)} ${spec.view}` : "…"}{loading && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}</span>
        <div className="flex items-center gap-2">
          <a href={csv} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:bg-surface-muted"><Download className="h-3 w-3" />CSV (all {list ? fmt(list.total) : ""})</a>
          {list && list.pages > 1 && (
            <span className="inline-flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
              {list.page} / {list.pages}
              <button disabled={page >= list.pages} onClick={() => setPage(page + 1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
            </span>
          )}
        </div>
      </div>
      {err && <div className="rounded-lg bg-warn-weak p-3 text-xs text-warn">{err}</div>}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead className="bg-surface-muted/60">
            <tr>{cols.map((c) => spec.view === "activities"
              ? <th key={c.key} className={cn("whitespace-nowrap px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle", c.right ? "text-right" : "text-left")}>{c.label}</th>
              : <SortHeader key={c.key} active={sort === c.key} dir={dir} onClick={() => toggle(c.key)} right={c.right}><span className="text-[10px] uppercase tracking-wide">{c.label}</span></SortHeader>)}</tr>
          </thead>
          <tbody>
            {(list?.rows ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-line align-top hover:bg-surface-muted/40">
                {cols.map((c) => <td key={c.key} className={cn("px-2 py-1.5", c.right && "text-right font-mono tabular-nums")}>{c.render(r, th, onOpenAccount)}</td>)}
              </tr>
            ))}
            {list && list.rows.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-ink-subtle">No records match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ListPanel({ spec, qs, th, onClose, onOpenAccount }: {
  spec: ListSpec; qs: string; th: Th; onClose: () => void; onOpenAccount: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-[1200px] overflow-y-auto bg-canvas p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink">{spec.title}</h2>
            <p className="text-[11px] text-ink-subtle">All global filters apply · list total equals the metric clicked</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-surface-muted"><X className="h-5 w-5" /></button>
        </div>
        <ListTable spec={spec} qs={qs} th={th} onOpenAccount={onOpenAccount} />
      </div>
    </div>
  );
}
