/** Live preview for the Slack Reports page — GET /api/slack-reports/preview?key=<report id>
 *  Session-gated by the global middleware; additionally requires isAdmin. Looks the report up by id
 *  so the preview applies the SAME team/exclusions as the eventual send, through the exact same
 *  assembleCallBlitzReport() that Send Test / Run Now / the scheduler use. */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase/server";
import { resolveViewer } from "../../../../lib/access/resolve";
import { getReportWithDestination } from "../../../../lib/slackReports/store";
import { assembleCallBlitzReport } from "../../../../lib/slackReports/build";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const viewer = await resolveViewer(user?.email ?? "");
  if (!viewer.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  const found = await getReportWithDestination(key);
  if (!found) return NextResponse.json({ error: "unknown report" }, { status: 404 });

  try {
    const report = await assembleCallBlitzReport({ managerKey: found.report.managerKey, excludeOwnerNames: found.report.excludeOwnerNames });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed to build preview" }, { status: 500 });
  }
}
