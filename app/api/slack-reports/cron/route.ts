/** Scheduled Slack reports — GET /api/slack-reports/cron, pinged every minute by
 *  .github/workflows/slack-reports-scheduler.yml with `Authorization: Bearer $CRON_SECRET`.
 *  Public in middleware (pingers have no session) and self-authenticates like /api/sync/delta.
 *  Sends every slot that is due (`dueSlots`), each claimed once in the run log first so overlapping
 *  pings can never double-send. Runs on Vercel so the env-var webhooks of the original reports work. */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { claimSlot, finishRun, getReportWithDestination, listReports } from "../../../../lib/slackReports/store";
import { dueSlots } from "../../../../lib/slackReports/schedule";
import { runOneReport } from "../../../../lib/slackReports/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = Date.now();
  const { reports, tableReady } = await listReports();
  if (!tableReady) return NextResponse.json({ ok: true, sent: [], note: "sdr_slack_reports not set up" });

  const sent: { report: string; slot: string; ok: boolean; error?: string }[] = [];
  for (const r of reports) {
    for (const slot of dueSlots(r.schedule, now)) {
      const runId = await claimSlot(r.id, slot.slotKey, slot.label);
      if (runId == null) continue; // already sent (or sending) for this slot
      const found = await getReportWithDestination(r.id);
      const result = found ? await runOneReport(found.report, found.dest, { label: slot.label }) : { ok: false, error: "report deleted" };
      await finishRun(runId, result.ok, result.error);
      sent.push({ report: r.name, slot: slot.slotKey, ok: result.ok, error: result.error });
    }
  }
  return NextResponse.json({ ok: true, sent });
}
