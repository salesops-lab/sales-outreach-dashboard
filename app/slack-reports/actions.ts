"use server";

import { requireAdmin } from "../../lib/access/requireAdmin";
import { getSlackReport } from "../../config/slack-reports";

type ActionResult = { ok: boolean; message: string };

/** Dispatches slack-reports-run-once.yml rather than rendering inline — the report image needs a
 *  real headless Chromium (Playwright), which is a poor fit for a Vercel serverless function
 *  (cold-start size/time, memory limits on a Hobby plan) but a comfortable fit for a GitHub
 *  Actions runner. Mirrors triggerOwnerPull() in app/admin/actions.ts. */
async function dispatchRunOnce(reportKey: string, testMode: boolean): Promise<ActionResult> {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo = process.env.GH_REPO ?? "salesops-lab/sdr-outreach-dashboard";
  if (!token) return { ok: false, message: "GH_DISPATCH_TOKEN is not configured — cannot dispatch a run." };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/slack-reports-run-once.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { report_key: reportKey, test_mode: String(testMode) } }),
    });
    if (res.status === 204) return { ok: true, message: "✓ Dispatched — check Slack in about a minute." };
    return { ok: false, message: `Dispatch failed (HTTP ${res.status}).` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendTestReport(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const key = String(formData.get("key") ?? "");
  if (!getSlackReport(key)) return { ok: false, message: "Unknown report." };
  return dispatchRunOnce(key, true);
}

export async function runReportNow(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const key = String(formData.get("key") ?? "");
  if (!getSlackReport(key)) return { ok: false, message: "Unknown report." };
  return dispatchRunOnce(key, false);
}
