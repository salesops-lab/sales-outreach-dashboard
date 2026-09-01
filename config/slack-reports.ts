/**
 * Slack Reports config — plain code, not a database table. For a small, fixed set of
 * teams/channels/schedules, a DB-backed admin UI is unnecessary overhead (extra tables, RLS,
 * PostgREST schema-cache sync). Same pattern as config/team-structure.ts: a developer edits this
 * file and redeploys to add/change a report — no migration, no schema to apply.
 *
 * The webhook URL itself is NEVER here — `channelEnvVar` only names the server-side env var
 * (e.g. SLACK_VAIBHAV_WEBHOOK) that lib/slackReports/deliver.ts resolves at send time.
 */
import { ReportSchedule } from "../lib/slackReports/types";

export interface SlackReportConfig {
  key: string; // stable id — used by the "Send Test"/"Run Now" actions, never shown to users
  name: string;
  reportType: "call_blitz";
  managerKey: string; // → sdr_managers.manager_key (existing team scope, unchanged)
  channelLabel: string; // e.g. "#team-vaibhav" — display only
  channelEnvVar: string; // e.g. "SLACK_VAIBHAV_WEBHOOK" — the env var holding the webhook URL
  enabled: boolean;
  timezone: string; // IANA tz — governs WHEN the scheduler fires, never the reporting day
  schedule: ReportSchedule;
}

export const SLACK_REPORTS: SlackReportConfig[] = [
  {
    key: "vaibhav-call-blitz",
    name: "Vaibhav Call Blitz",
    reportType: "call_blitz",
    managerKey: "vaibhav",
    channelLabel: "#team-vaibhav",
    channelEnvVar: "SLACK_VAIBHAV_WEBHOOK",
    enabled: true,
    timezone: "Asia/Kolkata",
    schedule: { daysOfWeek: [1, 2, 3, 4, 5], time1: "10:00", time2: "16:00" },
  },
  {
    key: "rajveer-call-blitz",
    name: "Rajveer Call Blitz",
    reportType: "call_blitz",
    managerKey: "rajveer",
    channelLabel: "#team-rajveer",
    channelEnvVar: "SLACK_RAJVEER_WEBHOOK",
    enabled: true,
    timezone: "Asia/Kolkata",
    schedule: { daysOfWeek: [1, 2, 3, 4, 5], time1: "10:00", time2: "16:00" },
  },
];

export function getSlackReport(key: string): SlackReportConfig | undefined {
  return SLACK_REPORTS.find((r) => r.key === key);
}
