/**
 * Slack Reports scheduler — checked every ~10 min by a self-redispatching GitHub Actions
 * heartbeat (.github/workflows/slack-reports-heartbeat.yml), the same pattern already proven by
 * spine-delta-heartbeat.yml (plain `schedule:` cron is confirmed throttled on this repo).
 *
 * No database involved: reports are a static list (config/slack-reports.ts). Idempotency comes
 * from cadence, not a claimed DB row — dueSlotFor's tolerance window (10 min) equals the
 * heartbeat's loop interval, and `concurrency: cancel-in-progress: true` guarantees only one loop
 * instance runs at a time, so under normal operation each configured time fires exactly once.
 * Accepted tradeoff: a redispatch race could in theory cause one duplicate Slack message — never
 * data loss, and simpler than a DB-backed claim table for two fixed teams.
 */
import { SLACK_REPORTS, SlackReportConfig } from "../../config/slack-reports";
import { assembleCallBlitzReport } from "./build";
import { formatCallBlitzMessage } from "./format";
import { sendSlackMessage } from "./deliver";
import { dueSlotFor } from "./dueSlot";

export { dueSlotFor };

export interface SchedulerRunResult { checked: number; fired: number; skipped: number; errors: number; }

/** Runs one report immediately (bypasses the due-time check) — used by the scheduler once a
 *  report is due, and directly by the "Send Test" / "Run Now" server actions. */
export async function runOneReport(report: SlackReportConfig, opts: { test?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const reportData = await assembleCallBlitzReport({ managerKey: report.managerKey });
    const { text } = formatCallBlitzMessage(reportData, { test: opts.test });
    await sendSlackMessage({ channelLabel: report.channelLabel, envVarKey: report.channelEnvVar }, text);
    console.log(`[slack-reports] ${opts.test ? "TEST " : ""}sent "${report.name}" to ${report.channelLabel}`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[slack-reports] "${report.name}" failed:`, message);
    return { ok: false, error: message };
  }
}

/** The recurring scheduler pass: checks every enabled report and fires the ones that are due.
 *  Never throws out of the loop — one report's failure doesn't block the rest. */
export async function runScheduler(nowMs = Date.now()): Promise<SchedulerRunResult> {
  let fired = 0, skipped = 0, errors = 0;
  for (const report of SLACK_REPORTS) {
    if (!report.enabled) { skipped++; continue; }
    const slot = dueSlotFor(report, nowMs);
    if (!slot) { skipped++; continue; }
    console.log(`[slack-reports] "${report.name}" due for slot ${slot}`);
    const result = await runOneReport(report);
    if (result.ok) fired++; else errors++;
  }
  return { checked: SLACK_REPORTS.length, fired, skipped, errors };
}
