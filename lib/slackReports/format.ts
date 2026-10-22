/** Pure Slack message formatting for the Call Blitz Report — fixed-width monospace table inside
 *  a Slack code block (Slack has no native table markup). A Block Kit per-rep bullet layout was
 *  tried first and rejected ("not a proper table") — this aligned-column format is what ships. */
import { CallBlitzReport, CallBlitzRow, CallBlitzTotals } from "./callBlitz";

const COLUMNS: { key: keyof CallBlitzTotals; header: string }[] = [
  { key: "totalTouches", header: "Touch" },
  { key: "calls", header: "Calls" },
  { key: "emails", header: "Email" },
  { key: "connectedCalls", header: "Conn" },
  { key: "highIntent", header: "High" },
  { key: "lowIntent", header: "Low" },
  { key: "notInterested", header: "NI" },
  { key: "referral", header: "Ref" },
  { key: "demos", header: "Demo" },
  { key: "meetings", header: "Mtg" },
];

function formatDateLabel(reportDateEt: string): string {
  const [y, m, d] = reportDateEt.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "short", year: "numeric", month: "long", day: "numeric",
  });
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}
function padNum(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function renderTable(rows: CallBlitzRow[], totals: CallBlitzTotals): string {
  const nameWidth = Math.max(4, "TEAM TOTAL".length, ...rows.map((r) => r.name.length));
  const colWidths = COLUMNS.map((c) => Math.max(c.header.length, String(totals[c.key]).length, ...rows.map((r) => String(r[c.key]).length)));

  const header = pad("Rep", nameWidth) + "  " + COLUMNS.map((c, i) => padNum(c.header, colWidths[i])).join(" ");
  const rule = "─".repeat(header.length);
  const lines = rows.map((r) => pad(r.name, nameWidth) + "  " + COLUMNS.map((c, i) => padNum(String(r[c.key]), colWidths[i])).join(" "));
  const totalLine = pad("TEAM TOTAL", nameWidth) + "  " + COLUMNS.map((c, i) => padNum(String(totals[c.key]), colWidths[i])).join(" ");

  return [header, rule, ...lines, rule, totalLine].join("\n");
}

/** Builds the plain-text Slack message: heading + a monospace table inside a code fence. No Block
 *  Kit, no image — just text/JSON over the Incoming Webhook. */
export function formatCallBlitzMessage(
  report: CallBlitzReport,
  opts: { test?: boolean; label?: string; reportName?: string; sentAtMs?: number; tz?: string } = {},
): { text: string } {
  const testPrefix = opts.test ? "🧪 TEST REPORT\n\n" : "";
  // Title: a scheduled send's own name ("Call Blitz-1", "Final Report"); a Run Now / Send Test uses
  // the report's current name. The date is the US (ET) working day the numbers cover — the IST send
  // time is shown next to it, since sends after midnight IST still cover the previous US day.
  const title = `📊 ${(opts.label || opts.reportName || "Call Blitz Report").toUpperCase()}`;
  const asOf = opts.sentAtMs != null
    ? ` · as of ${new Date(opts.sentAtMs).toLocaleString("en-US", { timeZone: opts.tz || "Asia/Kolkata", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${(opts.tz || "Asia/Kolkata") === "Asia/Kolkata" ? "IST" : opts.tz}`
    : "";
  const heading = `${title}\n📅 ${formatDateLabel(report.reportDateEt)} (US day)${asOf}\n👥 ${report.teamName}`;
  const table = report.rows.length > 0
    ? renderTable(report.rows, report.totals)
    : "No reps found for this team.";
  const text = `${testPrefix}${heading}\n\n\`\`\`\n${table}\n\`\`\``;
  return { text };
}
