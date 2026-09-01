/** Shared shapes for the Slack Reports module. Report config itself lives in
 *  config/slack-reports.ts (plain code, not a database table) — this file only holds the piece
 *  the pure scheduling check (lib/slackReports/dueSlot.ts) needs. */

export interface ReportSchedule {
  daysOfWeek: number[]; // 0=Sun .. 6=Sat (JS Date.getDay convention, used consistently throughout)
  time1: string; // "HH:MM", 24h, wall-clock in the report's configured timezone
  time2: string | null; // optional second daily send
}
