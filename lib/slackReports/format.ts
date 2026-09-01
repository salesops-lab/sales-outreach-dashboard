/** Pure Slack message formatting for the Call Blitz Report — fixed-width monospace table inside
 *  a Slack code block (Slack has no native table markup). */
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
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
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

export function formatCallBlitzMessage(report: CallBlitzReport, opts: { test?: boolean } = {}): { text: string } {
  const testPrefix = opts.test ? "🧪 TEST REPORT\n\n" : "";
  const heading = `📊 CALL BLITZ REPORT\n📅 ${formatDateLabel(report.reportDateEt)}\n👥 ${report.teamName}`;
  const table = report.rows.length > 0
    ? renderTable(report.rows, report.totals)
    : "No reps found for this team.";
  const text = `${testPrefix}${heading}\n\n\`\`\`\n${table}\n\`\`\``;
  return { text };
}
