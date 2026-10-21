"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { CalendarClock, Plus, Radio, Trash2, X } from "lucide-react";
import { sendTestReport, runReportNow, addReport, removeReport, updateReport } from "../../app/slack-reports/actions";
import { Surface } from "../ui";
import { CallBlitzReport } from "../../lib/slackReports/callBlitz";
import { SlackReport, SlackRunLog } from "../../lib/slackReports/types";
import {
  DEFAULT_SCHEDULE, fmtSlotTime, nextSend, ReportSchedule, ScheduleSlot, tzLabel, validTime, WEEKDAYS,
} from "../../lib/slackReports/schedule";
import PreviewTable from "./PreviewTable";

type ActionResult = { ok: boolean; message: string } | null;
export interface TeamOption { key: string; name: string; members: string[] }

const REPORT_TYPE_LABEL: Record<string, string> = { call_blitz: "Call Blitz Report" };
const BTN = "rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-muted disabled:opacity-50";
const INPUT = "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-primary focus:outline-none";

function SmallSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} className={BTN}>{pending ? "…" : label}</button>;
}

function ActionButton({ action, reportKey, label }: { action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>; reportKey: string; label: string }) {
  const [state, formAction] = useFormState<ActionResult, FormData>(action, null);
  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="key" value={reportKey} />
      <SmallSubmit label={label} />
      {state && <span className={`text-xs ${state.ok ? "text-good" : "text-danger"}`}>{state.message}</span>}
    </form>
  );
}

const Msg = ({ r }: { r: ActionResult }) => (r ? <p className={`text-xs ${r.ok ? "text-good" : "text-danger"}`}>{r.message}</p> : null);

/** "Mon–Fri · 9:30 PM, 12:30 AM, 2:55 AM IST" */
function scheduleSummary(s: ReportSchedule) {
  const d = [...s.days].sort();
  const days = d.join(",") === "1,2,3,4,5" ? "Mon–Fri" : d.map((x) => WEEKDAYS[x - 1]).join(", ");
  return `${days} · ${s.slots.map((x) => fmtSlotTime(x.time)).join(", ")} ${tzLabel(s.tz)}`;
}

const fmtWhen = (ms: number, tz: string) =>
  `${new Date(ms).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${tzLabel(tz)}`;

// ── schedule editor (used by the new-report form and each card) ─────────────
function ScheduleFields({ value, onChange }: { value: ReportSchedule; onChange: (s: ReportSchedule) => void }) {
  const set = (p: Partial<ReportSchedule>) => onChange({ ...value, ...p });
  const setSlot = (i: number, p: Partial<ScheduleSlot>) => set({ slots: value.slots.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
        Send automatically
      </label>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Days (US working day)</p>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d, i) => {
            const on = value.days.includes(i + 1);
            return (
              <button key={d} type="button" onClick={() => set({ days: on ? value.days.filter((x) => x !== i + 1) : [...value.days, i + 1] })}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${on ? "border-primary bg-primary text-primary-fg" : "border-line text-ink-muted hover:bg-surface-muted"}`}>
                {d}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Send times ({tzLabel(value.tz)}) · name of each send</p>
        <div className="space-y-1.5">
          {value.slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="time" value={s.time} onChange={(e) => setSlot(i, { time: e.target.value })}
                className={`${INPUT} w-36 shrink-0 ${validTime(s.time) ? "" : "border-danger"}`} />
              <input value={s.label} onChange={(e) => setSlot(i, { label: e.target.value })} placeholder="Name, e.g. Final Report" className={`${INPUT} w-full max-w-xs`} />
              <button type="button" onClick={() => set({ slots: value.slots.filter((_, j) => j !== i) })} className="rounded p-1 text-ink-subtle hover:bg-surface-muted hover:text-danger" aria-label="Remove time">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => set({ slots: [...value.slots, { time: "", label: "Update" }] })} className={`${BTN} inline-flex items-center gap-1`}>
            <Plus className="h-3.5 w-3.5" /> Add time
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-subtle">
          Each send shows today&apos;s US (ET) numbers so far. Times after midnight IST still belong to the same US working day.
        </p>
      </div>
    </div>
  );
}

// ── new report ───────────────────────────────────────────────────────────────
function NewReportForm({ teams, onClose }: { teams: TeamOption[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult>(null);
  const [name, setName] = useState("");
  const [team, setTeam] = useState(teams[0]?.key ?? "");
  const [channel, setChannel] = useState("");
  const [url, setUrl] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<ReportSchedule>({ ...DEFAULT_SCHEDULE, enabled: true });
  const members = teams.find((t) => t.key === team)?.members ?? [];

  function submit() {
    start(async () => {
      const r = await addReport({ name, managerKey: team, channelLabel: channel, webhookUrl: url, excludeOwnerNames: excluded, schedule });
      setRes(r);
      if (r.ok) { router.refresh(); onClose(); }
    });
  }

  return (
    <Surface className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-ink">New report</h3>
        <button onClick={onClose} className="rounded p-1 text-ink-subtle hover:bg-surface-muted" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-ink-muted">Report name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kshitij Call Blitz" className={`${INPUT} mt-1 w-full`} />
          </label>
          <label className="block text-xs font-semibold text-ink-muted">Team (SDR manager)
            <select value={team} onChange={(e) => { setTeam(e.target.value); setExcluded([]); }} className={`${INPUT} mt-1 w-full`}>
              {teams.map((t) => <option key={t.key} value={t.key}>{t.name} ({t.members.length} reps)</option>)}
            </select>
          </label>
          {members.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ink-muted">Leave out of the report (optional)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const on = excluded.includes(m);
                  return (
                    <button key={m} type="button" onClick={() => setExcluded(on ? excluded.filter((x) => x !== m) : [...excluded, m])}
                      className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-danger bg-danger-weak text-danger line-through" : "border-line text-ink-muted hover:bg-surface-muted"}`}>
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <label className="block text-xs font-semibold text-ink-muted">Slack channel
            <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="#team-kshitij" className={`${INPUT} mt-1 w-full`} />
          </label>
          <label className="block text-xs font-semibold text-ink-muted">Slack webhook URL
            <input type="password" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" className={`${INPUT} mt-1 w-full font-mono`} />
            <span className="mt-1 block text-[11px] font-normal text-ink-subtle">
              In Slack: Apps → Incoming Webhooks → Add to the channel → copy the URL. It is saved securely and never shown again.
            </span>
          </label>
        </div>
        <div className="rounded-xl border border-line p-3">
          <ScheduleFields value={schedule} onChange={setSchedule} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={submit} disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg disabled:opacity-50">
          {pending ? "Saving…" : "Add report"}
        </button>
        <Msg r={res} />
      </div>
    </Surface>
  );
}

// ── one report ───────────────────────────────────────────────────────────────
function ReportCard({ report, runs, teams, editable }: { report: SlackReport; runs: SlackRunLog[]; teams: TeamOption[]; editable: boolean }) {
  const router = useRouter();
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<CallBlitzReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [schedule, setSchedule] = useState<ReportSchedule>(report.schedule);
  const [name, setName] = useState(report.name);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult>(null);
  const next = nextSend(report.schedule, Date.now());
  const teamName = teams.find((t) => t.key === report.managerKey)?.name ?? report.managerKey;

  async function togglePreview() {
    const nextShow = !showPreview;
    setShowPreview(nextShow);
    if (!nextShow || preview || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/slack-reports/preview?key=${encodeURIComponent(report.id)}`);
      const data = await r.json();
      setPreview(data.error ? null : data);
    } catch { setPreview(null); } finally { setLoading(false); }
  }

  const save = () => start(async () => {
    const r = await updateReport(report.id, name, schedule);
    setRes(r);
    if (r.ok) { setEditing(false); router.refresh(); }
  });
  const del = () => {
    if (!window.confirm(`Delete "${report.name}"? Scheduled sends stop and it is removed from this page. This cannot be undone.`)) return;
    start(async () => { const r = await removeReport(report.id); setRes(r); if (r.ok) router.refresh(); });
  };

  return (
    <Surface className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" strokeWidth={2.4} />
            <h3 className="font-semibold text-ink">{report.name}</h3>
            {report.schedule.enabled
              ? <span className="rounded-full bg-good-weak px-2 py-0.5 text-[10px] font-bold uppercase text-good">Scheduled</span>
              : <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold uppercase text-ink-subtle">Manual</span>}
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-muted">
            <dt>Type</dt><dd>{REPORT_TYPE_LABEL[report.reportType] ?? report.reportType}</dd>
            <dt>Team</dt><dd>{teamName}{report.excludeOwnerNames.length > 0 && <span className="text-ink-subtle"> · leaves out {report.excludeOwnerNames.join(", ")}</span>}</dd>
            <dt>Channel</dt><dd>{report.channelLabel}</dd>
            <dt>Schedule</dt>
            <dd>
              {report.schedule.enabled ? scheduleSummary(report.schedule) : "Off — sends only when you click Run Now"}
              {next && <span className="text-ink-subtle"> · next: {next.label}, {fmtWhen(next.slotMs, report.schedule.tz)}</span>}
            </dd>
            {runs.length > 0 && (<>
              <dt>Last sends</dt>
              <dd className="space-y-0.5">
                {runs.map((r, i) => (
                  <div key={i} className={r.status === "error" ? "text-danger" : ""}>
                    {r.status === "ok" ? "✓" : r.status === "error" ? "✗" : "…"} {r.kind === "scheduled" ? r.label : r.kind === "test" ? "Test" : "Run Now"}
                    {" · "}{new Date(r.created_at).toLocaleString("en-US", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} IST
                    {r.error && <span> — {r.error}</span>}
                  </div>
                ))}
              </dd>
            </>)}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={togglePreview} className={BTN}>{showPreview ? "Hide preview" : "Preview"}</button>
          <ActionButton action={runReportNow} reportKey={report.id} label="Run Now" />
          <ActionButton action={sendTestReport} reportKey={report.id} label="Send Test" />
          {editable && (<>
            <button onClick={() => { setSchedule(report.schedule); setName(report.name); setEditing(!editing); }} className={`${BTN} inline-flex items-center gap-1`}>
              <CalendarClock className="h-3.5 w-3.5" /> Edit / Schedule
            </button>
            <button onClick={del} disabled={pending} className={`${BTN} inline-flex items-center gap-1 text-danger hover:bg-danger-weak`}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </>)}
        </div>
      </div>
      {editing && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <label className="mb-3 block max-w-sm text-xs font-semibold text-ink-muted">Report name
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${INPUT} mt-1 w-full`} />
          </label>
          <ScheduleFields value={schedule} onChange={setSchedule} />
          <div className="mt-3 flex items-center gap-3">
            <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg disabled:opacity-50">
              {pending ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className={BTN}>Cancel</button>
          </div>
        </div>
      )}
      <div className="mt-2"><Msg r={res} /></div>
      {showPreview && (
        <div className="mt-4">
          {loading && <p className="text-sm text-ink-muted">Loading preview…</p>}
          {!loading && preview && <PreviewTable report={preview} />}
          {!loading && !preview && <p className="text-sm text-danger">Could not load preview.</p>}
        </div>
      )}
    </Surface>
  );
}

export default function SlackReportsHub({ reports, runs, teams, tableReady }: {
  reports: SlackReport[]; runs: Record<string, SlackRunLog[]>; teams: TeamOption[]; tableReady: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-subtle">Reports</h2>
        {tableReady && !adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg">
            <Plus className="h-4 w-4" /> New report
          </button>
        )}
      </div>

      {!tableReady && (
        <Surface className="border-warn p-4 text-sm text-ink">
          <p className="font-semibold">One-time setup needed to add, delete and schedule reports.</p>
          <p className="mt-1 text-ink-muted">Run <code>supabase/slack_reports_schema.sql</code> in the Supabase SQL editor. Until then the two original reports below work with Run Now only.</p>
        </Surface>
      )}

      {adding && <NewReportForm teams={teams} onClose={() => setAdding(false)} />}

      {reports.length === 0 ? (
        <Surface className="p-10 text-center">
          <p className="text-sm font-semibold text-ink">No Slack reports yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">Click “New report” to add one.</p>
        </Surface>
      ) : (
        <div className="grid gap-3">
          {reports.map((r) => <ReportCard key={r.id} report={r} runs={runs[r.id] ?? []} teams={teams} editable={tableReady} />)}
        </div>
      )}

      <Surface className="p-4">
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">How sending works</h3>
        <p className="text-xs text-ink-muted">
          Every report posts a table to its Slack channel through an Incoming Webhook. <b>Run Now</b> and <b>Send Test</b> send
          immediately. A <b>scheduled</b> report sends by itself at each time you set (checked every minute) with today&apos;s US
          numbers so far — each send carries its own name as the Slack title (e.g. “Call Blitz-1”, “Final Report”) and is sent only once. Webhook URLs are kept
          on the server and never shown in the browser.
        </p>
      </Surface>
    </div>
  );
}
