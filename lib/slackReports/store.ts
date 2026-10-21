/** Slack report persistence (server-only — service role). Reads `sdr_slack_reports` and the run log;
 *  falls back to the read-only config list (config/slack-reports.ts) while the table is missing, so
 *  the page and "Run Now" keep working before supabase/slack_reports_schema.sql is applied. */
import "server-only";
import { supabaseAdmin } from "../supabase/admin";
import { SLACK_REPORTS } from "../../config/slack-reports";
import { cleanSchedule, DEFAULT_SCHEDULE, ReportSchedule } from "./schedule";
import { SlackDestination, SlackReport, SlackRunLog } from "./types";

const COLS = "id, name, report_type, manager_key, channel_label, exclude_owner_names, schedule_enabled, schedule_days, schedule_slots, schedule_tz";

type Row = {
  id: string; name: string; report_type: string; manager_key: string; channel_label: string;
  exclude_owner_names: string[] | null; schedule_enabled: boolean; schedule_days: number[] | null;
  schedule_slots: unknown; schedule_tz: string | null;
};

const toReport = (r: Row): SlackReport => ({
  id: r.id, name: r.name, reportType: "call_blitz", managerKey: r.manager_key, channelLabel: r.channel_label,
  excludeOwnerNames: r.exclude_owner_names ?? [],
  schedule: {
    enabled: r.schedule_enabled, days: r.schedule_days ?? [],
    slots: Array.isArray(r.schedule_slots) ? (r.schedule_slots as ReportSchedule["slots"]) : [],
    tz: r.schedule_tz ?? DEFAULT_SCHEDULE.tz,
  },
  source: "db",
});

const configReports = (): SlackReport[] => SLACK_REPORTS.map((c) => ({
  id: c.key, name: c.name, reportType: c.reportType, managerKey: c.managerKey, channelLabel: c.channelLabel,
  excludeOwnerNames: c.excludeOwnerNames ?? [], schedule: { ...DEFAULT_SCHEDULE, enabled: false }, source: "config",
}));

function db() {
  const c = supabaseAdmin();
  if (!c) throw new Error("Supabase is not configured on the server.");
  return c;
}

/** All reports + whether the table exists (false → config fallback, add/delete/schedule disabled). */
export async function listReports(): Promise<{ reports: SlackReport[]; tableReady: boolean }> {
  try {
    const { data, error } = await db().from("sdr_slack_reports").select(COLS).order("created_at");
    if (error) throw error;
    return { reports: (data as Row[]).map(toReport), tableReady: true };
  } catch {
    return { reports: configReports(), tableReady: false };
  }
}

/** One report plus its server-side destination (webhook URL / env var name). Never send the
 *  destination to the browser. */
export async function getReportWithDestination(id: string): Promise<{ report: SlackReport; dest: SlackDestination } | null> {
  const { reports, tableReady } = await listReports();
  if (!tableReady) {
    const c = SLACK_REPORTS.find((x) => x.key === id);
    const r = reports.find((x) => x.id === id);
    return c && r ? { report: r, dest: { channelLabel: c.channelLabel, envVarKey: c.channelEnvVar } } : null;
  }
  const { data, error } = await db().from("sdr_slack_reports")
    .select(`${COLS}, webhook_url, channel_env_var`).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as Row & { webhook_url: string | null; channel_env_var: string | null };
  return { report: toReport(row), dest: { channelLabel: row.channel_label, webhookUrl: row.webhook_url, envVarKey: row.channel_env_var } };
}

export interface NewReport {
  name: string; managerKey: string; channelLabel: string; webhookUrl: string;
  excludeOwnerNames: string[]; schedule: ReportSchedule; createdBy: string;
}

export async function createReport(n: NewReport): Promise<string> {
  const s = cleanSchedule(n.schedule);
  const { data, error } = await db().from("sdr_slack_reports").insert({
    name: n.name, report_type: "call_blitz", manager_key: n.managerKey, channel_label: n.channelLabel,
    webhook_url: n.webhookUrl, exclude_owner_names: n.excludeOwnerNames,
    schedule_enabled: s.enabled, schedule_days: s.days, schedule_slots: s.slots, schedule_tz: s.tz,
    created_by: n.createdBy,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function deleteReport(id: string): Promise<void> {
  const { error } = await db().from("sdr_slack_reports").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function saveReport(id: string, name: string, input: Partial<ReportSchedule>): Promise<ReportSchedule> {
  const s = cleanSchedule(input);
  const { error } = await db().from("sdr_slack_reports").update({
    name,
    schedule_enabled: s.enabled, schedule_days: s.days, schedule_slots: s.slots, schedule_tz: s.tz,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error(error.message);
  return s;
}

/** Claim a scheduled slot. Returns the run id, or null when it was already claimed (sent/sending). */
export async function claimSlot(reportId: string, slotKey: string, label: string): Promise<number | null> {
  const { data, error } = await db().from("sdr_slack_report_runs")
    .insert({ report_id: reportId, kind: "scheduled", slot_key: slotKey, label, status: "sending" })
    .select("id").single();
  if (error) {
    if (error.code === "23505") return null; // unique (report_id, slot_key) — already claimed
    throw new Error(error.message);
  }
  return (data as { id: number }).id;
}

export async function logRun(reportId: string, kind: "manual" | "test", ok: boolean, err?: string): Promise<void> {
  try {
    await db().from("sdr_slack_report_runs").insert({ report_id: reportId, kind, status: ok ? "ok" : "error", error: err ?? null });
  } catch { /* history is best-effort */ }
}

export async function finishRun(runId: number, ok: boolean, err?: string): Promise<void> {
  await db().from("sdr_slack_report_runs").update({ status: ok ? "ok" : "error", error: err ?? null }).eq("id", runId);
}

/** The last few runs per report (newest first), for the "Recent sends" line. */
export async function recentRuns(limitPerReport = 3): Promise<Record<string, SlackRunLog[]>> {
  try {
    const { data, error } = await db().from("sdr_slack_report_runs")
      .select("report_id, kind, slot_key, label, status, error, created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    const out: Record<string, SlackRunLog[]> = {};
    for (const r of data as SlackRunLog[]) {
      const l = (out[r.report_id] ??= []);
      if (l.length < limitPerReport) l.push(r);
    }
    return out;
  } catch {
    return {};
  }
}
