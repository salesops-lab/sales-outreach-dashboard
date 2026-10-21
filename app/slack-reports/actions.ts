"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../lib/access/requireAdmin";
import { runOneReport } from "../../lib/slackReports/run";
import { createReport, deleteReport, getReportWithDestination, logRun, saveReport } from "../../lib/slackReports/store";
import { ReportSchedule, ScheduleSlot } from "../../lib/slackReports/schedule";
import { loadTeamStructure } from "../../lib/team/load";

type ActionResult = { ok: boolean; message: string };
const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

async function send(formData: FormData, test: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
    const found = await getReportWithDestination(String(formData.get("key") ?? ""));
    if (!found) return { ok: false, message: "Unknown report." };
    const result = await runOneReport(found.report, found.dest, { test });
    if (found.report.source === "db") await logRun(found.report.id, test ? "test" : "manual", result.ok, result.error);
    revalidatePath("/slack-reports");
    return result.ok
      ? { ok: true, message: `✓ ${test ? "Test report" : "Report"} sent to ${found.report.channelLabel}.` }
      : { ok: false, message: `${test ? "Test send" : "Run"} failed: ${result.error}` };
  } catch (e) { return fail(e); }
}

export async function sendTestReport(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return send(formData, true);
}

export async function runReportNow(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return send(formData, false);
}

/** New report from the page. The webhook must be a Slack Incoming Webhook URL; it is stored on the
 *  row (service-role only) and never sent back to the browser. */
export async function addReport(input: {
  name: string; managerKey: string; channelLabel: string; webhookUrl: string;
  excludeOwnerNames: string[]; schedule: ReportSchedule;
}): Promise<ActionResult> {
  try {
    const email = await requireAdmin();
    const name = input.name.trim();
    const channel = input.channelLabel.trim();
    const url = input.webhookUrl.trim();
    if (!name) return { ok: false, message: "Give the report a name." };
    if (!channel) return { ok: false, message: "Add the Slack channel name (e.g. #team-vaibhav)." };
    if (!/^https:\/\/hooks\.slack\.com\/services\/\S+$/.test(url)) {
      return { ok: false, message: "The webhook must be a Slack Incoming Webhook URL (https://hooks.slack.com/services/…)." };
    }
    const ts = await loadTeamStructure();
    if (!ts.managers[input.managerKey]) return { ok: false, message: "That team no longer exists — refresh the page." };
    await createReport({
      name, managerKey: input.managerKey, channelLabel: channel.startsWith("#") ? channel : `#${channel}`, webhookUrl: url,
      excludeOwnerNames: input.excludeOwnerNames.map((n) => n.trim()).filter(Boolean), schedule: input.schedule, createdBy: email,
    });
    revalidatePath("/slack-reports");
    return { ok: true, message: `✓ "${name}" added.` };
  } catch (e) { return fail(e); }
}

export async function removeReport(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await deleteReport(id);
    revalidatePath("/slack-reports");
    return { ok: true, message: "Report deleted." };
  } catch (e) { return fail(e); }
}

/** Rename the report and/or change its schedule (send names, days, times). */
export async function updateReport(id: string, name: string, input: { enabled: boolean; days: number[]; slots: ScheduleSlot[]; tz: string }): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!name.trim()) return { ok: false, message: "The report needs a name." };
    const s = await saveReport(id, name.trim(), input);
    revalidatePath("/slack-reports");
    if (input.enabled && !s.enabled) return { ok: false, message: "Saved, but the schedule is OFF — pick at least one day and one valid time." };
    return { ok: true, message: s.enabled ? "✓ Saved — reports will send automatically." : "✓ Saved (schedule off)." };
  } catch (e) { return fail(e); }
}
