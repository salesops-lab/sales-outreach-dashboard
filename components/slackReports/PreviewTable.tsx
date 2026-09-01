import { CallBlitzReport } from "../../lib/slackReports/callBlitz";
import { Surface } from "../ui";

const COLUMNS: { key: keyof CallBlitzReport["totals"]; label: string }[] = [
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

/** Renders a live-computed CallBlitzReport as an HTML table mirroring the eventual Slack layout. */
export default function PreviewTable({ report }: { report: CallBlitzReport }) {
  return (
    <Surface className="overflow-x-auto p-0">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">📊 Call Blitz Report — {report.teamName}</p>
        <p className="text-xs text-ink-muted">{report.reportDateEt} (ET) · as of {new Date().toLocaleTimeString()}</p>
      </div>
      {report.rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">No reps found for this team.</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2">Rep</th>
              {COLUMNS.map((c) => <th key={c.key} className="px-2 py-2 text-right">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.ownerId} className="border-b border-line/60">
                <td className="px-4 py-1.5 font-medium text-ink">{r.name}</td>
                {COLUMNS.map((c) => <td key={c.key} className="px-2 py-1.5 text-right text-ink-muted">{r[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold text-ink">
              <td className="px-4 py-2">TEAM TOTAL</td>
              {COLUMNS.map((c) => <td key={c.key} className="px-2 py-2 text-right">{report.totals[c.key]}</td>)}
            </tr>
          </tfoot>
        </table>
      )}
    </Surface>
  );
}
