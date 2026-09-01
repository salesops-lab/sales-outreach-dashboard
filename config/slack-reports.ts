/**
 * Slack Reports config — plain code, not a database table. Manual/on-demand only (no automatic
 * schedule, no DB): an admin clicks Preview/Run Now/Send Test from /slack-reports whenever they
 * want a report shared. Same pattern as config/team-structure.ts: a developer edits this file and
 * redeploys to add/change a report — no migration, no schema to apply.
 *
 * Delivery is an image (rendered to match the web Preview panel exactly), posted via a Slack Bot
 * Token file upload — Incoming Webhooks can't upload files. `channelId` is the Slack channel's ID
 * (not a secret, just an identifier — e.g. "C0123ABC456", found via channel details in Slack), and
 * the ONE shared `SLACK_BOT_TOKEN` env var (lib/slackReports/deliver.ts) authenticates the upload.
 */

export interface SlackReportConfig {
  key: string; // stable id — used by the "Send Test"/"Run Now" actions, never shown to users
  name: string;
  reportType: "call_blitz";
  managerKey: string; // → sdr_managers.manager_key (existing team scope, unchanged)
  channelLabel: string; // e.g. "#team-vaibhav" — display only
  channelId: string; // Slack channel ID (e.g. "C0123ABC456") — where the image is posted
  /** Roster display names (sdr_roster.name, case-insensitive) to leave out of BOTH the table rows
   *  and TEAM TOTAL entirely — e.g. a player-coach manager who doesn't want his own light call
   *  volume skewing or appearing in his team's report. */
  excludeOwnerNames?: string[];
}

export const SLACK_REPORTS: SlackReportConfig[] = [
  {
    key: "vaibhav-call-blitz",
    name: "Vaibhav Call Blitz",
    reportType: "call_blitz",
    managerKey: "vaibhav",
    channelLabel: "#team-vaibhav",
    channelId: "C09A7JYHM35",
  },
  {
    key: "rajveer-call-blitz",
    name: "Rajveer Call Blitz",
    reportType: "call_blitz",
    managerKey: "rajveer",
    channelLabel: "#team-rajveer",
    channelId: "C09ABQD7Z32",
    excludeOwnerNames: ["Rajveer Singh"],
  },
];

export function getSlackReport(key: string): SlackReportConfig | undefined {
  return SLACK_REPORTS.find((r) => r.key === key);
}
