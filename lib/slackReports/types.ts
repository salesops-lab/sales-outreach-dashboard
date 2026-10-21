/** A Slack report as the app sees it (pure — safe on the client). The webhook URL is never part of
 *  this shape: it stays server-side in `sdr_slack_reports.webhook_url` (or a legacy env var) and is
 *  read only by lib/slackReports/deliver.ts at send time. */
import { ReportSchedule } from "./schedule";

export interface SlackReport {
  id: string;                    // sdr_slack_reports.id (uuid), or the config key on the fallback path
  name: string;
  reportType: "call_blitz";
  managerKey: string;            // → sdr_managers.manager_key (team scope)
  channelLabel: string;          // e.g. "#team-vaibhav" — display only
  excludeOwnerNames: string[];   // roster names left out of rows AND totals
  schedule: ReportSchedule;
  source: "db" | "config";       // config = read-only fallback before slack_reports_schema.sql is applied
}

/** Where a send goes — resolved server-side only. */
export interface SlackDestination {
  channelLabel: string;
  webhookUrl?: string | null;    // stored on the DB row (reports added from the page)
  envVarKey?: string | null;     // legacy: env var holding the URL (the two original reports)
}

export interface SlackRunLog {
  report_id: string;
  kind: "scheduled" | "manual" | "test";
  slot_key: string | null;
  label: string | null;
  status: "sending" | "ok" | "error";
  error: string | null;
  created_at: string;
}
