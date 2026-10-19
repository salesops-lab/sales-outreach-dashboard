"use client";
/** Account-list columns: every column the list can show, the default set + order, and a
 *  "Manage columns" panel to show / hide / re-order them (remembered per browser). */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, ExternalLink, RotateCcw } from "lucide-react";
import { companyUrl } from "../../config/hubspot";
import { cn } from "../ui";
import { etDay, fmt, ICP_LABEL, StatusChip, TYPE_LABEL } from "./parts";

const TH60 = { inact: 60, deep: 90 };

export interface ColCtx { onOpen: (id: string) => void; onGroup: (gd: string) => void }
export interface ColDef {
  key: string;                 // also the server sort key
  label: string;
  right?: boolean;
  fixed?: boolean;             // always shown, always first
  cell: (r: any, ctx: ColCtx) => React.ReactNode;
}

function num(k: string) {
  return function NumCell(r: any) { return <span className="font-mono">{fmt(r[k])}</span>; };
}
function dateWithStatus(ms: string, status: string, days: string) {
  return function DateCell(r: any) {
    return <span className="whitespace-nowrap"><span className="mr-1">{etDay(r[ms])}</span><StatusChip s={r[status]} th={TH60} days={r[days]} /></span>;
  };
}

export const ALL_COLUMNS: ColDef[] = [
  { key: "name", label: "Company", fixed: true, cell: (r, ctx) => (
    <span className="whitespace-nowrap">
      <button onClick={() => ctx.onOpen(r.id)} className="text-left font-semibold text-ink hover:text-primary">{r.name}</button>
      <a href={companyUrl(r.id)} target="_blank" rel="noreferrer" title="Open in HubSpot" className="ml-1 inline-block text-ink-subtle hover:text-primary"><ExternalLink className="h-3 w-3" /></a>
    </span>
  ) },
  { key: "team", label: "Team", cell: (r) => r.team ?? "—" },
  { key: "owner_name", label: "Account owner", cell: (r) => r.owner_name },
  { key: "type", label: "Account type", cell: (r) => TYPE_LABEL[r.type] },
  { key: "dealer_type", label: "Type of Dealership", cell: (r) => r.dealer_type ?? "—" },
  { key: "gd_name", label: "GD Name", cell: (r, ctx) => (r.gd_name
    ? <button onClick={() => ctx.onGroup(r.gd_name)} className="text-left text-primary hover:underline" title="View the whole group">{r.gd_name}</button>
    : "—") },
  { key: "potential_rooftops", label: "#Potential Rooftops", right: true, cell: num("potential_rooftops") },
  { key: "company_days", label: "Last Activity Date", cell: dateWithStatus("company_last_activity_ms", "company_status", "company_days") },
  { key: "rooftop_days", label: "Rooftop Last Activity", cell: dateWithStatus("rooftop_last_activity_ms", "rooftop_status", "rooftop_days") },
  { key: "state", label: "State", cell: (r) => r.state ?? "—" },
  { key: "city", label: "City", cell: (r) => r.city ?? "—" },
  { key: "country", label: "Country", cell: (r) => r.country },
  { key: "icp", label: "Company ICP", cell: (r) => ICP_LABEL[r.icp] },
  { key: "last_contacted_ms", label: "Last Contacted", cell: (r) => etDay(r.last_contacted_ms) },
  { key: "calls", label: "Calls", right: true, cell: num("calls") },
  { key: "connected", label: "Connected", right: true, cell: num("connected") },
  { key: "emails", label: "Emails", right: true, cell: num("emails") },
  { key: "touchpoints", label: "Touchpoints", right: true, cell: num("touchpoints") },
  { key: "meetings", label: "Meetings", right: true, cell: num("meetings") },
  { key: "demos_booked", label: "Demos booked", right: true, cell: num("demos_booked") },
  { key: "contacts", label: "Contacts", right: true, cell: num("contacts") },
  { key: "domain", label: "Domain", cell: (r) => r.domain ?? "—" },
  { key: "id", label: "HubSpot Record ID", cell: (r) => <span className="font-mono">{r.id}</span> },
];

export const DEFAULT_COLUMNS = [
  "name", "team", "owner_name", "type", "dealer_type", "gd_name", "potential_rooftops",
  "company_days", "rooftop_days", "state", "calls", "emails", "touchpoints",
];

const STORE_KEY = "ao-list-columns-v1";

/** The visible column keys, in order. Remembered in this browser; unknown keys are dropped. */
export function useColumns(): [string[], (keys: string[]) => void] {
  const [cols, setCols] = useState<string[]>(DEFAULT_COLUMNS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
      if (Array.isArray(saved)) {
        const valid = saved.filter((k) => ALL_COLUMNS.some((c) => c.key === k && !c.fixed));
        if (valid.length) setCols(["name", ...valid]);
      }
    } catch { /* storage unavailable — keep the defaults */ }
  }, []);
  const save = (keys: string[]) => {
    const next = ["name", ...keys.filter((k) => k !== "name")];
    setCols(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next.slice(1))); } catch { /* ignore */ }
  };
  return [cols, save];
}

/** "Manage columns" button + panel: tick to show, arrows to move, reset to the default set. */
export function ManageColumns({ cols, onChange }: { cols: string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const shown = cols.filter((k) => k !== "name");
  const hidden = ALL_COLUMNS.filter((c) => !c.fixed && !shown.includes(c.key));
  const label = (k: string) => ALL_COLUMNS.find((c) => c.key === k)?.label ?? k;
  const move = (i: number, d: -1 | 1) => {
    const next = shown.slice();
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className={cn("inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium", open ? "border-primary text-primary" : "border-line text-ink-muted hover:bg-surface-muted")}>
        <Columns3 className="h-3.5 w-3.5" /> Manage columns
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-card border border-line bg-surface p-3 text-xs shadow-pop">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Shown — in this order</span>
            <button onClick={() => onChange(DEFAULT_COLUMNS.slice(1))} className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-primary">
              <RotateCcw className="h-3 w-3" /> Default
            </button>
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-auto">
            <li className="flex items-center gap-2 rounded px-1 py-1 text-ink-subtle"><input type="checkbox" checked disabled /> Company (always shown)</li>
            {shown.map((k, i) => (
              <li key={k} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-muted">
                <input id={`col-${k}`} type="checkbox" checked onChange={() => onChange(shown.filter((x) => x !== k))} />
                <label htmlFor={`col-${k}`} className="flex-1 cursor-pointer">{label(k)}</label>
                <button onClick={() => move(i, -1)} disabled={i === 0} title="Move left" className="rounded p-0.5 text-ink-subtle hover:text-primary disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => move(i, 1)} disabled={i === shown.length - 1} title="Move right" className="rounded p-0.5 text-ink-subtle hover:text-primary disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
          {hidden.length > 0 && (
            <>
              <div className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">More columns</div>
              <ul className="max-h-48 space-y-0.5 overflow-auto">
                {hidden.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-muted">
                    <input id={`col-${c.key}`} type="checkbox" checked={false} onChange={() => onChange([...shown, c.key])} />
                    <label htmlFor={`col-${c.key}`} className="flex-1 cursor-pointer">{c.label}</label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
