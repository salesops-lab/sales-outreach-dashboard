/** Live preview for the Slack Reports page — GET /api/slack-reports/preview?key=<report key>
 *  Session-gated by the global middleware; additionally requires isAdmin (same gate as the rest of
 *  the Slack Reports module). Looks the report up by its config key (not a raw managerKey) so the
 *  preview always applies the SAME exclusions/config as the eventual rendered image — the two can
 *  never drift apart. Calls the exact same assembleCallBlitzReport() the scheduler and "Send
 *  Test"/"Run Now" use. */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase/server";
import { resolveViewer } from "../../../../lib/access/resolve";
import { getSlackReport } from "../../../../config/slack-reports";
import { assembleCallBlitzReport } from "../../../../lib/slackReports/build";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const viewer = await resolveViewer(user?.email ?? "");
  if (!viewer.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const config = getSlackReport(key);
  if (!config) return NextResponse.json({ error: "unknown report" }, { status: 404 });

  try {
    const report = await assembleCallBlitzReport({ managerKey: config.managerKey, excludeOwnerNames: config.excludeOwnerNames });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed to build preview" }, { status: 500 });
  }
}
