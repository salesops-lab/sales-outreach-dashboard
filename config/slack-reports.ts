/**
 * Slack Reports — SEED + FALLBACK only. The live list lives in the `sdr_slack_reports` table
 * (supabase/slack_reports_schema.sql), so admins add, delete and schedule reports from
 * /slack-reports. Same pattern as config/team-structure.ts: these two entries seed the table and
 * are shown (read-only, no schedule) only while the table is missing.
 *
 * The webhook URL is NEVER here — `channelEnvVar` names the server-side env var
 * (e.g. SLACK_VAIBHAV_WEBHOOK) that lib/slackReports/deliver.ts resolves at send time. Reports
 * added from the page store their URL on the DB row instead (service-role only, never sent to
 * the browser).
 */

export interface SlackReportConfig {
  key: string;
  name: string;
  reportType: "call_blitz";
  managerKey: string;     // → sdr_managers.manager_key
  channelLabel: string;   // e.g. "#team-vaibhav" — display only
  channelEnvVar: string;  // e.g. "SLACK_VAIBHAV_WEBHOOK" — the env var holding the webhook URL
  /** Roster display names (case-insensitive) left out of BOTH the rows and TEAM TOTAL. */
  excludeOwnerNames?: string[];
}

export const SLACK_REPORTS: SlackReportConfig[] = [
  {
    key: "vaibhav-call-blitz",
    name: "Vaibhav Call Blitz",
    reportType: "call_blitz",
    managerKey: "vaibhav",
    channelLabel: "#team-vaibhav",
    channelEnvVar: "SLACK_VAIBHAV_WEBHOOK",
  },
  {
    key: "rajveer-call-blitz",
    name: "Rajveer Call Blitz",
    reportType: "call_blitz",
    managerKey: "rajveer",
    channelLabel: "#team-rajveer",
    channelEnvVar: "SLACK_RAJVEER_WEBHOOK",
    excludeOwnerNames: ["Rajveer Singh"],
  },
];

export function getSlackReport(key: string): SlackReportConfig | undefined {
  return SLACK_REPORTS.find((r) => r.key === key);
}
