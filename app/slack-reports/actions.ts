"use server";

import { requireAdmin } from "../../lib/access/requireAdmin";
import { getSlackReport } from "../../config/slack-reports";
import { runOneReport } from "../../lib/slackReports/scheduler";

type ActionResult = { ok: boolean; message: string };

export async function sendTestReport(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const key = String(formData.get("key") ?? "");
    const report = getSlackReport(key);
    if (!report) return { ok: false, message: "Unknown report." };
    const result = await runOneReport(report, { test: true });
    return result.ok
      ? { ok: true, message: `✓ Test report sent to ${report.channelLabel}.` }
      : { ok: false, message: `Test send failed: ${result.error}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function runReportNow(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const key = String(formData.get("key") ?? "");
    const report = getSlackReport(key);
    if (!report) return { ok: false, message: "Unknown report." };
    const result = await runOneReport(report, { test: false });
    return result.ok
      ? { ok: true, message: `✓ Report sent to ${report.channelLabel}.` }
      : { ok: false, message: `Run failed: ${result.error}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
