/**
 * Accounts Overview — GET /api/accounts-overview?view=<tab>&<filters>[&format=csv]
 *
 * Reads the isolated sdr_ao_* tables (filled by `npm run ao:sync`), cached server-side until the next completed sync (cache.ts);
 * every filter/tab change is an in-memory computation (lib/accountsOverview/views.ts) — HubSpot
 * is never called at request time. Auth: the global /api middleware gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { getPrepared } from "../../../lib/accountsOverview/cache";
import { computeView, exportRows } from "../../../lib/accountsOverview/views";
import { parseRequest, toCsv } from "../../../lib/accountsOverview/params";
import { etDateStr } from "../../../lib/sync/buckets";

export const dynamic = "force-dynamic";
// Never let Next's data cache hold Supabase reads — a finished sync must show up immediately.
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!supabaseAdmin()) return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  const sp = req.nextUrl.searchParams;
  let prep;
  try {
    prep = await getPrepared({ fresh: sp.get("refresh") === "1" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Most likely the migration has not been applied yet — say so instead of showing zeros.
    return NextResponse.json({ error: "setup_required", detail: msg }, { status: 503 });
  }
  const nowMs = Date.now();
  const parsed = parseRequest(sp, nowMs, prep.data.state.window_start_ms);

  if (parsed.csv) {
    const rows = exportRows(prep, parsed.filters, parsed.list.drill, nowMs);
    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="accounts-${etDateStr(nowMs)}.csv"`,
      },
    });
  }
  const payload = computeView(prep, parsed.filters, parsed.view, parsed.list, nowMs);
  return NextResponse.json({ ...payload, warnings: parsed.warnings });
}
