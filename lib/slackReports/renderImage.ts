/**
 * Renders a CallBlitzReport as a PNG image that visually matches components/slackReports/
 * PreviewTable.tsx — Slack has no HTML table primitive, so an exact visual match to the web
 * preview means rendering the same layout with a headless browser and posting the screenshot.
 * This file owns PRESENTATION only; the data always comes from the same CallBlitzReport object
 * lib/slackReports/build.ts produces, so the image and the web preview can never show different
 * numbers — only pixel styling is duplicated here, never the metrics fold.
 *
 * Playwright is a devDependency used only by scripts run via GitHub Actions (this never ships in
 * the Next.js app bundle) — see .github/workflows/slack-reports-run-once.yml for the
 * `npx playwright install --with-deps chromium` setup step.
 */
import { chromium } from "playwright";
import { CallBlitzReport, CallBlitzRow, CallBlitzTotals } from "./callBlitz";

const COLUMNS: { key: keyof CallBlitzTotals; label: string }[] = [
  { key: "totalTouches", label: "Touches" },
  { key: "calls", label: "Calls" },
  { key: "emails", label: "Emails" },
  { key: "connectedCalls", label: "Connected" },
  { key: "highIntent", label: "High Intent" },
  { key: "lowIntent", label: "Low Intent" },
  { key: "notInterested", label: "Not Interested" },
  { key: "referral", label: "Referral" },
  { key: "demos", label: "Demos" },
  { key: "meetings", label: "Meeting" },
];

function formatDateLabel(reportDateEt: string): string {
  const [y, m, d] = reportDateEt.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rowHtml(r: CallBlitzRow): string {
  return `<tr><td class="rep">${escapeHtml(r.name)}</td>${COLUMNS.map((c) => `<td>${r[c.key]}</td>`).join("")}</tr>`;
}

function buildHtml(report: CallBlitzReport, opts: { test?: boolean }): string {
  const testBanner = opts.test
    ? `<div class="test-banner">🧪 TEST REPORT</div>`
    : "";
  const bodyRows = report.rows.length > 0
    ? report.rows.map(rowHtml).join("")
    : `<tr><td colspan="${COLUMNS.length + 1}" class="empty">No reps found for this team.</td></tr>`;
  const totalsRow = `<tr class="totals"><td class="rep">TEAM TOTAL</td>${COLUMNS.map((c) => `<td>${report.totals[c.key]}</td>`).join("")}</tr>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #ffffff; }
  #card { display: inline-block; min-width: 900px; background: #ffffff; border: 1px solid #e7e9ee; border-radius: 16px; overflow: hidden; }
  .test-banner { background: #fdeaea; color: #dc2626; font-weight: 700; font-size: 13px; padding: 8px 20px; text-align: center; letter-spacing: 0.04em; }
  .header { padding: 16px 20px; border-bottom: 1px solid #e7e9ee; }
  .header .title { font-size: 15px; font-weight: 700; color: #14161c; margin: 0; }
  .header .subtitle { font-size: 12px; color: #545b68; margin: 4px 0 0; }
  table { border-collapse: collapse; width: 100%; }
  thead th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8a909d; text-align: right; padding: 10px 16px; border-bottom: 1px solid #e7e9ee; white-space: nowrap; }
  thead th:first-child { text-align: left; }
  tbody td, tfoot td { font-size: 14px; color: #545b68; text-align: right; padding: 10px 16px; border-bottom: 1px solid #eef0f3; white-space: nowrap; }
  tbody td.rep, tfoot td.rep { text-align: left; font-weight: 600; color: #14161c; }
  tbody td.empty { text-align: center; color: #8a909d; padding: 24px; }
  tfoot tr.totals td { border-top: 2px solid #e7e9ee; border-bottom: none; font-weight: 700; color: #14161c; }
</style>
</head>
<body>
  <div id="card">
    ${testBanner}
    <div class="header">
      <p class="title">📊 Call Blitz Report — ${escapeHtml(report.teamName)}</p>
      <p class="subtitle">${escapeHtml(formatDateLabel(report.reportDateEt))} (ET)</p>
    </div>
    <table>
      <thead><tr><th>Rep</th>${COLUMNS.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>${totalsRow}</tfoot>
    </table>
  </div>
</body>
</html>`;
}

/** Renders `report` to a PNG buffer, cropped tightly to the card. Launches and closes its own
 *  browser instance per call — fine for the low call volume here (a handful of sends/day). */
export async function renderCallBlitzImage(report: CallBlitzReport, opts: { test?: boolean } = {}): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
    await page.setContent(buildHtml(report, opts), { waitUntil: "networkidle" });
    const card = page.locator("#card");
    const buffer = await card.screenshot({ type: "png" });
    return buffer;
  } finally {
    await browser.close();
  }
}
