/** Ad-hoc single-report fire for the "Run Now"/"Send Test" buttons — dispatched via GitHub
 *  Actions (slack-reports-run-once.yml) rather than run inline in a Vercel server action, because
 *  rendering the report image needs a real headless Chromium process (Playwright), which is a
 *  poor fit for a Vercel serverless function (cold-start size/time, memory limits on a Hobby
 *  plan) but a comfortable fit for a GitHub Actions runner (a full VM with a generous timeout).
 *  Reads REPORT_KEY (required) and TEST_MODE ("true"/"false", default "false") from the env. */
import "dotenv/config";
import { getSlackReport } from "../config/slack-reports";
import { runOneReport } from "../lib/slackReports/run";

async function main() {
  const key = process.env.REPORT_KEY;
  if (!key) throw new Error("REPORT_KEY env var is required");
  const report = getSlackReport(key);
  if (!report) throw new Error(`Unknown report key "${key}" — check config/slack-reports.ts`);

  const test = process.env.TEST_MODE === "true";
  const result = await runOneReport(report, { test });
  if (!result.ok) throw new Error(result.error ?? "run failed");
  console.log(`[slack-reports] ${test ? "test " : ""}run of "${report.name}" succeeded`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("[slack-reports] manual run failed:", e); process.exit(1); });
