/** Live preview for the Slack Reports create/edit form — GET /api/slack-reports/preview?managerKey=
 *  Session-gated by the global middleware; additionally requires isAdmin (same gate as the rest of
 *  the Slack Reports module). Calls the exact same assembleCallBlitzReport() the scheduler and
 *  "Send Test" use, so the preview can never show different numbers than the eventual Slack message. */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase/server";
import { resolveViewer } from "../../../../lib/access/resolve";
import { assembleCallBlitzReport } from "../../../../lib/slackReports/build";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const viewer = await resolveViewer(user?.email ?? "");
  if (!viewer.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const managerKey = req.nextUrl.searchParams.get("managerKey");
  if (!managerKey) return NextResponse.json({ error: "managerKey required" }, { status: 400 });

  try {
    const report = await assembleCallBlitzReport({ managerKey });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed to build preview" }, { status: 500 });
  }
}
