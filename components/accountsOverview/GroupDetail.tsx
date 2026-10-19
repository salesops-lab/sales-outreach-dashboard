"use client";
/** Dealership-group drawer: every rooftop with this GD Name in the four teams, with the group's
 *  totals (rooftops, #Potential Rooftops, franchise / independent, 60-day work, latest dates). */
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { companyUrl } from "../../config/hubspot";
import { etDay, fmt, StatusChip, TH } from "./parts";

const TH60 = { inact: 60, deep: 90 };

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-card">
      <div className="text-[11px] font-semibold text-ink-muted">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-subtle">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { value: string; count: number }[] }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-card">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{title}</div>
      {rows.map((r) => (
        <div key={r.value} className="flex justify-between border-b border-line/60 py-1 text-xs last:border-0">
          <span className="text-ink">{r.value}</span><span className="font-mono text-ink-muted">{fmt(r.count)}</span>
        </div>
      ))}
    </div>
  );
}

export default function GroupDetail({ gd, qs, onClose, onOpen }: { gd: string; qs: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [g, setG] = useState<any>(undefined);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(qs);
    p.set("view", "group"); p.set("drill", gd);
    setG(undefined); setErr(null);
    fetch(`/api/accounts-overview?${p}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setG(j.group); })
      .catch((e) => setErr(String(e.message ?? e)));
  }, [gd, qs]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-[1100px] overflow-y-auto bg-canvas p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Dealership group</div>
            <h2 className="text-lg font-bold text-ink">{g?.name ?? gd}</h2>
            <p className="text-[11px] text-ink-subtle">Every rooftop with this GD Name in the Neelima · Prince · Saarthak · Central teams.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-surface-muted"><X className="h-5 w-5" /></button>
        </div>
        {err && <div className="rounded-lg bg-warn-weak p-3 text-sm text-warn">{err}</div>}
        {g === undefined && !err && <div className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}
        {g === null && <div className="text-sm text-ink-muted">No rooftops with this GD Name in the four teams.</div>}
        {g && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Rooftops in HubSpot" value={fmt(g.rooftops)} sub={`${fmt(g.franchise)} franchise · ${fmt(g.independent)} independent`} />
              <Tile label="#Potential Rooftops" value={fmt(g.potential_rooftops)} sub="HubSpot field (highest value in the group)" />
              <Tile label="Worked in last 60 days" value={`${fmt(g.worked_60)} / ${fmt(g.rooftops)}`} sub={`${fmt(g.not_worked_60)} not worked in 60+ days`} />
              <Tile label="Latest activity" value={etDay(g.last_activity_ms)} sub={`Rooftop Last Activity: ${etDay(g.rooftop_last_activity_ms)}`} />
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Breakdown title="Teams" rows={g.teams} />
              <Breakdown title="Account owners" rows={g.owners} />
              <Breakdown title="States" rows={g.states.slice(0, 8)} />
              <Breakdown title="Activity (date range)" rows={[
                { value: "Contacts", count: g.contacts }, { value: "Calls", count: g.calls },
                { value: "Emails", count: g.emails }, { value: "Touchpoints", count: g.touchpoints },
                { value: "Deals last quarter", count: g.quarter_deals },
              ]} />
            </div>
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-xs">
                <thead className="bg-surface-muted/60"><tr>
                  <TH>Rooftop</TH><TH>Team</TH><TH>Account owner</TH><TH>Type of Dealership</TH><TH>State</TH>
                  <TH>Last Activity Date</TH><TH>Rooftop Last Activity</TH><TH right>Calls</TH><TH right>Emails</TH>
                </tr></thead>
                <tbody>{g.rows.map((r: any) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <button onClick={() => onOpen(r.id)} className="text-left font-semibold text-ink hover:text-primary">{r.name}</button>
                      <a href={companyUrl(r.id)} target="_blank" rel="noreferrer" className="ml-1 inline-block text-ink-subtle hover:text-primary"><ExternalLink className="h-3 w-3" /></a>
                    </td>
                    <td className="px-2 py-1.5">{r.team ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.owner_name}</td>
                    <td className="px-2 py-1.5">{r.dealer_type ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.state ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5"><span className="mr-1">{etDay(r.company_last_activity_ms)}</span><StatusChip s={r.company_status} th={TH60} days={r.company_days} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5"><span className="mr-1">{etDay(r.rooftop_last_activity_ms)}</span><StatusChip s={r.rooftop_status} th={TH60} days={r.rooftop_days} /></td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(r.calls)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(r.emails)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
