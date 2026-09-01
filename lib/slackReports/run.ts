/**
 * On-demand Call Blitz Report execution — the single entrypoint Preview/Send Test/Run Now (and
 * this module's tests) all funnel through. No scheduler, no database, no headless browser: a
 * webhook POST has no browser dependency, so this runs inline in a Vercel server action.
 */
import { SlackReportConfig } from "../../config/slack-reports";
import { assembleCallBlitzReport } from "./build";
import { buildCallBlitzBlocks } from "./blockKit";
import { sendSlackMessage } from "./deliver";

export async function runOneReport(report: SlackReportConfig, opts: { test?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const reportData = await assembleCallBlitzReport({ managerKey: report.managerKey, excludeOwnerNames: report.excludeOwnerNames });
    const { blocks, text } = buildCallBlitzBlocks(reportData, { test: opts.test });
    await sendSlackMessage({ channelLabel: report.channelLabel, envVarKey: report.channelEnvVar }, { text, blocks });
    console.log(`[slack-reports] ${opts.test ? "TEST " : ""}sent "${report.name}" to ${report.channelLabel}`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[slack-reports] "${report.name}" failed:`, message);
    return { ok: false, error: message };
  }
}
