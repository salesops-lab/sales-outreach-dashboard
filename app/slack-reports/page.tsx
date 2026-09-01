import { redirect } from "next/navigation";
import { Radio } from "lucide-react";
import { supabaseServer } from "../../lib/supabase/server";
import { resolveViewer } from "../../lib/access/resolve";
import { SLACK_REPORTS } from "../../config/slack-reports";
import AppNav from "../../components/AppNav";
import SlackReportsHub from "../../components/slackReports/SlackReportsHub";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Slack Reports — admin-only. Reports are a static list (config/slack-reports.ts, not a
 *  database table — see that file's header comment for why). Gated exactly like /admin
 *  (page-level redirect + a re-derived requireAdmin() check in every server action). */
export default async function SlackReportsPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const viewer = await resolveViewer(user?.email ?? "");
  if (!viewer.isAdmin) redirect("/");

  return (
    <>
      <AppNav active="slack-reports" viewer={viewer} />
      <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6">
        <header className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-card">
            <Radio className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-[28px]">Slack Reports</h1>
            <p className="mt-0.5 text-sm text-ink-muted">Automate and manage sales activity reports sent to Slack.</p>
          </div>
        </header>
        <SlackReportsHub reports={SLACK_REPORTS} />
      </main>
    </>
  );
}
