/**
 * Slack Reports config — plain code, not a database table. For a small, fixed set of teams, a
 * DB-backed admin UI is unnecessary overhead (extra tables, RLS, PostgREST schema-cache sync).
 * Same pattern as config/team-structure.ts: a developer edits this file and redeploys to add or
 * change a report — no migration, no schema to apply.
 *
 * On-demand only — no automatic schedule. Preview / Send Test / Run Now are the only ways a
 * report ever sends, and they run inline in a Vercel server action (no GitHub Actions dispatch,
 * no headless browser — delivery is a plain webhook POST).
 *
 * The webhook URL itself is NEVER here — `channelEnvVar` only names the server-side env var
 * (e.g. SLACK_VAIBHAV_WEBHOOK) that lib/slackReports/deliver.ts resolves at send time.
 */

export interface SlackReportConfig {
  key: string; // stable id — used by the "Send Test"/"Run Now" actions, never shown to users
  name: string;
  reportType: "call_blitz";
  managerKey: string; // → sdr_managers.manager_key (existing team scope, unchanged)
  channelLabel: string; // e.g. "#team-vaibhav" — display only
  channelEnvVar: string; // e.g. "SLACK_VAIBHAV_WEBHOOK" — the env var holding the webhook URL
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
