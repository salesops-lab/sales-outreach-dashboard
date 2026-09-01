/**
 * Slack Block Kit message builder for the Call Blitz Report — pure function, no I/O. Replaces the
 * old fixed-width monospace `format.ts` approach: still plain text/JSON over the same Incoming
 * Webhook (no bot token, no file upload, no image), but structured as Block Kit sections so it
 * reads cleanly on both desktop and mobile instead of a cramped monospace table.
 */
import { CallBlitzReport, CallBlitzRow, CallBlitzTotals } from "./callBlitz";

function formatDateLabel(reportDateEt: string): string {
  const [y, m, d] = reportDateEt.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
  });
}

function statLine(r: CallBlitzRow | CallBlitzTotals): string {
  return `Touch: ${r.totalTouches} · Calls: ${r.calls} · Email: ${r.emails} · Conn: ${r.connectedCalls} · `
    + `High: ${r.highIntent} · Low: ${r.lowIntent} · NI: ${r.notInterested} · Ref: ${r.referral} · `
    + `Demo: ${r.demos} · Mtg: ${r.meetings}`;
}

function repSection(r: CallBlitzRow) {
  return {
    type: "section",
    text: { type: "mrkdwn", text: `*${r.name}*\n${statLine(r)}` },
  };
}

/** Builds a Slack Block Kit payload for a Call Blitz Report. `text` is the required plain-text
 *  fallback (notifications, accessibility) — a short summary, not the full table. */
export function buildCallBlitzBlocks(report: CallBlitzReport, opts: { test?: boolean } = {}): { blocks: unknown[]; text: string } {
  const dateLabel = formatDateLabel(report.reportDateEt);
  const contextText = opts.test ? `🧪 TEST REPORT · ${dateLabel}` : dateLabel;

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `📊 Call Blitz Report — ${report.teamName}`, emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: contextText }] },
    { type: "divider" },
  ];

  if (report.rows.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "No reps found for this team." } });
  } else {
    for (const row of report.rows) blocks.push(repSection(row));
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*TEAM TOTAL*\n${statLine(report.totals)}` },
    });
  }

  const summary = `${opts.test ? "[TEST] " : ""}Call Blitz Report — ${report.teamName} (${dateLabel}): `
    + `${report.totals.totalTouches} touches, ${report.totals.calls} calls, ${report.totals.emails} emails`;

  return { blocks, text: summary };
}
