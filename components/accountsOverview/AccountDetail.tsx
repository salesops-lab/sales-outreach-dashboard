"use client";
/** Complete account detail drawer: every field (ownership concepts kept apart), contacts, and the
 *  company/contact activity timeline over the whole synced window. */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { companyUrl, contactUrl, dealUrl, callUrl, meetingUrl } from "../../config/hubspot";
import { cn } from "../ui";
import { etDay, etTime, fmt, ICP_LABEL, StatusChip, TYPE_LABEL } from "./parts";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/60 py-1 text-xs">
      <span className="text-ink-subtle">{k}</span><span className="text-right text-ink">{v ?? "—"}</span>
    </div>
  );
}

export default function AccountDetail({ id, qs, th, onClose }: { id: string; qs: string; th: { inact: number; deep: number }; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [type, setType] = useState("all");

  useEffect(() => {
    setD(null); setErr(null); setContact(null);
    fetch(`/api/accounts-overview/account/${encodeURIComponent(id)}?${qs}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setD(j); })
      .catch((e) => setErr(String(e.message ?? e)));
  }, [id, qs]);

  const timeline = useMemo(() => (d?.activities ?? []).filter((a: any) =>
    (!contact || a.contact_ids.includes(contact)) && (type === "all" || a.type === type)), [d, contact, type]);

  const a = d?.account;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-[1100px] overflow-y-auto bg-canvas p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">{a?.name ?? "Account"}</h2>
            <div className="flex items-center gap-2 text-[11px] text-ink-subtle">
              <span className="font-mono">HubSpot ID {id}</span>
              <a href={companyUrl(id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary">HubSpot <ExternalLink className="h-3 w-3" /></a>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-surface-muted"><X className="h-5 w-5" /></button>
        </div>
        {err && <div className="rounded-lg bg-warn-weak p-3 text-sm text-warn">{err}</div>}
        {!d && !err && <div className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}
        {a && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-card border border-line bg-surface p-3 shadow-card">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Account</div>
                <Row k="Domain" v={a.domain} />
                <Row k="Country / State / City" v={[a.country, a.state, a.city].filter(Boolean).join(" · ")} />
                <Row k="Dealership type" v={<span title={a.type_reason ?? undefined}>{TYPE_LABEL[a.type]}</span>} />
                {a.type_reason && <Row k="Why needs review" v={<span className="text-warn">{a.type_reason}</span>} />}
                <Row k="Group Dealership" v={a.gd_name ? `${a.gd_name}${a.gd_id ? ` (GD ${a.gd_id})` : ""}` : "—"} />
                <Row k="Rooftop identifier" v={<span className="font-mono">{a.rooftop_id}</span>} />
                <Row k="Company ICP" v={ICP_LABEL[a.icp]} />
                <Row k="Raw HubSpot values" v={<span className="font-mono text-[10px]">type={d.raw.type_of_dealership ?? "∅"} · gdflag={d.raw.is_group ?? "∅"} · icp={d.raw.icp ?? "∅"}</span>} />
              </div>
              <div className="rounded-card border border-line bg-surface p-3 shadow-card">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Ownership (kept separate)</div>
                <Row k="Account owner" v={a.owner_name} />
                <Row k="Assigned team" v={a.team} />
                <Row k="Activity owners (period)" v={a.activity_owners.join(", ") || "—"} />
                <div className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Inactivity (measured independently)</div>
                <Row k="Company last activity" v={<span>{etDay(a.company_last_activity_ms)} <StatusChip s={a.company_status} th={th} days={a.company_days} /></span>} />
                <Row k="Rooftop last activity" v={<span>{etDay(a.rooftop_last_activity_ms)} <StatusChip s={a.rooftop_status} th={th} days={a.rooftop_days} /></span>} />
                <Row k="HubSpot last contacted" v={etDay(a.last_contacted_ms)} />
                <Row k="Never contacted (verified)" v={a.never_contacted ? "Yes" : "No"} />
              </div>
              <div className="rounded-card border border-line bg-surface p-3 shadow-card">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Reporting period</div>
                <Row k="Calls / connected" v={`${fmt(a.calls)} / ${fmt(a.connected)}`} />
                <Row k="Emails" v={fmt(a.emails)} />
                <Row k="Meetings" v={fmt(a.meetings)} />
                <Row k="Demos booked / completed" v={`${fmt(a.demos_booked)} / ${fmt(a.demos_completed)}`} />
                <Row k="Touchpoints" v={fmt(a.touchpoints)} />
                <Row k="Contacts (synced / HubSpot)" v={`${fmt(a.contacts)} / ${fmt(a.hubspot_contacts)}`} />
                <div className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Last dates (synced window)</div>
                <Row k="Call · Email" v={`${etDay(a.last_call_ms)} · ${etDay(a.last_email_ms)}`} />
                <Row k="Meeting · Demo booked" v={`${etDay(a.last_meeting_ms)} · ${etDay(a.last_demo_ms)}`} />
              </div>
            </div>

            <div className="mt-4 rounded-card border border-line bg-surface p-3 shadow-card">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Contacts ({d.contacts.length}) — click to filter the timeline</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-ink-subtle">
                    <th className="px-2 py-1">Contact</th><th className="px-2 py-1">Title</th><th className="px-2 py-1">Email / phone</th><th className="px-2 py-1">Contact owner</th>
                    <th className="px-2 py-1">Contact ICP</th><th className="px-2 py-1">Last activity</th><th className="px-2 py-1 text-right">Calls</th><th className="px-2 py-1 text-right">Conn.</th><th className="px-2 py-1 text-right">Emails</th><th className="px-2 py-1 text-right">Mtgs</th><th className="px-2 py-1">Engagement (window)</th>
                  </tr></thead>
                  <tbody>
                    {d.contacts.map((c: any) => (
                      <tr key={c.id} onClick={() => setContact(contact === c.id ? null : c.id)}
                        className={cn("cursor-pointer border-t border-line hover:bg-surface-muted/50", contact === c.id && "bg-primary-weak")}>
                        <td className="px-2 py-1"><a href={contactUrl(c.id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-primary">{c.name}</a><div className="font-mono text-[10px] text-ink-subtle">{c.id}</div></td>
                        <td className="px-2 py-1">{c.title ?? "—"}</td>
                        <td className="px-2 py-1 text-[11px]">{c.email ?? "—"}<div className="text-ink-subtle">{c.phone ?? ""}</div></td>
                        <td className="px-2 py-1">{c.contact_owner}</td>
                        <td className="px-2 py-1">{ICP_LABEL[c.contact_icp]}</td>
                        <td className="px-2 py-1">{etDay(c.last_activity_ms)}</td>
                        <td className="px-2 py-1 text-right font-mono">{c.calls}</td><td className="px-2 py-1 text-right font-mono">{c.connected}</td>
                        <td className="px-2 py-1 text-right font-mono">{c.emails}</td><td className="px-2 py-1 text-right font-mono">{c.meetings}</td>
                        <td className="px-2 py-1">{c.engagement === "engaged" ? "Engaged" : c.engagement === "touched" ? "Touched" : "Not touched"}</td>
                      </tr>
                    ))}
                    {d.contacts.length === 0 && <tr><td colSpan={11} className="px-2 py-4 text-center text-ink-subtle">No associated contacts synced.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {d.deals.length > 0 && (
              <div className="mt-4 rounded-card border border-line bg-surface p-3 shadow-card">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Auto-Pipeline deals (demo source)</div>
                {d.deals.map((x: any) => (
                  <div key={x.hs_id} className="flex flex-wrap items-center gap-3 border-t border-line py-1 text-xs first:border-t-0">
                    <a href={dealUrl(x.hs_id)} target="_blank" rel="noreferrer" className="font-mono text-primary">{x.hs_id}</a>
                    <span>{x.stage_key}</span>
                    <span className="text-ink-muted">SDR {x.sdr_owner} · AE {x.ae_owner}</span>
                    <span>Booked {etDay(x.demo_booked_ms)}</span><span>Completed {etDay(x.demo_completed_ms)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 rounded-card border border-line bg-surface p-3 shadow-card">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">
                  Activity timeline {contact ? "· filtered to one contact" : "· company level"} ({timeline.length}) — since {etDay(d.window.from)}
                </div>
                <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs">
                  <option value="all">All types</option><option value="call">Calls</option><option value="email">Emails</option>
                  <option value="meeting">Meetings</option><option value="note">Notes</option><option value="task">Tasks</option>
                </select>
              </div>
              <ol className="space-y-1.5">
                {timeline.map((t: any) => (
                  <li key={t.id} className="grid grid-cols-[140px_80px_1fr_160px] gap-2 border-t border-line pt-1.5 text-xs first:border-t-0">
                    <span className="whitespace-nowrap text-ink-muted">{etTime(t.ts_ms)}</span>
                    <span className="capitalize">{t.type}{t.direction ? <div className="text-[10px] text-ink-subtle">{t.direction.toLowerCase()}</div> : null}</span>
                    <span>
                      <span className="font-medium">{t.meeting_status ?? t.outcome ?? ""}</span>
                      {t.subject ? <span className="text-ink-muted"> · {t.subject}</span> : null}
                      {t.contact_names.length ? <div className="text-[10px] text-ink-subtle">with {t.contact_names.join(", ")}</div> : null}
                      {t.duration_ms ? <span className="text-[10px] text-ink-subtle"> · {Math.round(t.duration_ms / 1000)}s</span> : null}
                    </span>
                    <span className="text-right text-ink-muted">
                      {t.owner_name}
                      <div className="font-mono text-[10px] text-ink-subtle">
                        {t.type === "call" ? <a href={callUrl(t.id)} target="_blank" rel="noreferrer">{t.id}</a> : t.type === "meeting" ? <a href={meetingUrl(t.id)} target="_blank" rel="noreferrer">{t.id}</a> : t.id}
                        {t.via_contact_only ? " · via contact" : ""}
                      </div>
                    </span>
                  </li>
                ))}
                {timeline.length === 0 && <li className="py-4 text-center text-xs text-ink-subtle">No activity in the synced window.</li>}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
