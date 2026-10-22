/**
 * Call Blitz Report execution — the single entrypoint for Send Test, Run Now and the scheduler.
 * A webhook POST has no browser dependency, so this runs inline in a Vercel server action or the
 * scheduler route (/api/slack-reports/cron).
 */
import { assembleCallBlitzReport } from "./build";
import { formatCallBlitzMessage } from "./format";
import { sendSlackMessage } from "./deliver";
import { SlackDestination, SlackReport } from "./types";

export async function runOneReport(
  report: SlackReport, dest: SlackDestination, opts: { test?: boolean; label?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    const reportData = await assembleCallBlitzReport({ managerKey: report.managerKey, excludeOwnerNames: report.excludeOwnerNames });
    const { text } = formatCallBlitzMessage(reportData, {
      test: opts.test, label: opts.label, reportName: report.name, sentAtMs: Date.now(), tz: report.schedule.tz,
    });
    await sendSlackMessage(dest, text);
    console.log(`[slack-reports] ${opts.test ? "TEST " : ""}sent "${report.name}"${opts.label ? ` (${opts.label})` : ""} to ${report.channelLabel}`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[slack-reports] "${report.name}" failed:`, message);
    return { ok: false, error: message };
  }
}
