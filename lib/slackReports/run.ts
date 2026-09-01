/**
 * On-demand Call Blitz Report execution — no scheduler, no database. An admin triggers this from
 * /slack-reports (Run Now / Send Test), which dispatches slack-reports-run-once.yml (rendering
 * needs a real headless Chromium, a poor fit for a Vercel serverless function but comfortable on
 * a GitHub Actions runner). Renders an image matching the web Preview panel exactly (same
 * CallBlitzReport data, same excludeOwnerNames) and posts it via the Slack Bot Token file-upload
 * flow — Incoming Webhooks can't upload files.
 */
import { SlackReportConfig } from "../../config/slack-reports";
import { assembleCallBlitzReport } from "./build";
import { renderCallBlitzImage } from "./renderImage";
import { sendSlackImage } from "./deliver";

export async function runOneReport(report: SlackReportConfig, opts: { test?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const reportData = await assembleCallBlitzReport({ managerKey: report.managerKey, excludeOwnerNames: report.excludeOwnerNames });
    const png = await renderCallBlitzImage(reportData, { test: opts.test });
    await sendSlackImage(report.channelId, png, {
      title: `Call Blitz Report — ${report.name}`,
      caption: `📊 CALL BLITZ REPORT\n${reportData.reportDateEt} · ${reportData.teamName}`,
      test: opts.test,
    });
    console.log(`[slack-reports] ${opts.test ? "TEST " : ""}sent "${report.name}" to channel ${report.channelId}`);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[slack-reports] "${report.name}" failed:`, message);
    return { ok: false, error: message };
  }
}
