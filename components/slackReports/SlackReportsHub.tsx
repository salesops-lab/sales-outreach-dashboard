"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Radio } from "lucide-react";
import { sendTestReport, runReportNow } from "../../app/slack-reports/actions";
import { Chip, Surface } from "../ui";
import { SlackReportConfig } from "../../config/slack-reports";
import { CallBlitzReport } from "../../lib/slackReports/callBlitz";
import PreviewTable from "./PreviewTable";

type ActionResult = { ok: boolean; message: string } | null;

const REPORT_TYPE_LABEL: Record<string, string> = { call_blitz: "Call Blitz Report" };
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtSchedule(r: SlackReportConfig): string {
  const days = [...r.schedule.daysOfWeek].sort();
  const daysStr = days.length === 7 ? "Every day"
    : JSON.stringify(days) === JSON.stringify([1, 2, 3, 4, 5]) ? "Mon–Fri"
    : days.map((d) => DAY_LABELS[d]).join(", ");
  const times = [r.schedule.time1, r.schedule.time2].filter(Boolean).join(" · ");
  return `${daysStr} · ${times}`;
}

function SmallSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-muted disabled:opacity-50">
      {pending ? "…" : label}
    </button>
  );
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

function ReportCard({ report }: { report: SlackReportConfig }) {
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<CallBlitzReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function togglePreview() {
    const next = !showPreview;
    setShowPreview(next);
    if (!next || preview || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/slack-reports/preview?managerKey=${encodeURIComponent(report.managerKey)}`);
      const data = await res.json();
      setPreview(data.error ? null : data);
    } catch {
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Surface className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" strokeWidth={2.4} />
            <h3 className="font-semibold text-ink">{report.name}</h3>
            <Chip tone={report.enabled ? "good" : "neutral"}>{report.enabled ? "● Active" : "○ Disabled"}</Chip>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-muted">
            <dt>Type</dt><dd>{REPORT_TYPE_LABEL[report.reportType] ?? report.reportType}</dd>
            <dt>Channel</dt><dd>{report.channelLabel}</dd>
            <dt>Schedule</dt><dd>{fmtSchedule(report)}</dd>
            <dt>Timezone</dt><dd>{report.timezone}</dd>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={togglePreview} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-muted">
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          <ActionButton action={runReportNow} reportKey={report.key} label="Run Now" />
          <ActionButton action={sendTestReport} reportKey={report.key} label="Send Test" />
        </div>
      </div>
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

export default function SlackReportsHub({ reports }: { reports: SlackReportConfig[] }) {
  return (
    <div className="grid gap-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-ink-subtle">Active Reports</h2>

      {reports.length === 0 ? (
        <Surface className="p-10 text-center">
          <p className="text-sm font-semibold text-ink">No Slack reports configured.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
            Add an entry to <code>config/slack-reports.ts</code> and redeploy to enable one.
          </p>
        </Surface>
      ) : (
        <div className="grid gap-3">
          {reports.map((r) => <ReportCard key={r.key} report={r} />)}
        </div>
      )}

      <Surface className="p-4">
        <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Slack Connections</h3>
        <p className="text-xs text-ink-muted">
          Reports and their Slack channels are configured in <code>config/slack-reports.ts</code>. Each
          entry names a server-side env var (e.g. <code>SLACK_VAIBHAV_WEBHOOK</code>) that holds the
          webhook URL — the URL itself never lives in code, a database, or the browser.
        </p>
      </Surface>
    </div>
  );
}
