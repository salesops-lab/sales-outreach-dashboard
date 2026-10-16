/**
 * Accounts Overview — GET /api/accounts-overview/account/<companyId>
 * The complete account detail: every field, contacts (with per-contact activity over the whole
 * synced window), the full activity timeline and Auto-Pipeline demos. Same cached dataset as the
 * tab route; no HubSpot call. Auth: the global /api middleware gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrepared } from "../../../../../lib/accountsOverview/cache";
import { calcAccount, contactRows, toActivityRow, toListRow } from "../../../../../lib/accountsOverview/compute";
import { parseRequest } from "../../../../../lib/accountsOverview/params";

export const dynamic = "force-dynamic";
// Never let Next's data cache hold Supabase reads — a finished sync must show up immediately.
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest, { params }: { params: { companyId: string } }) {
  let prep;
  try { prep = await getPrepared(); } catch (e) {
    return NextResponse.json({ error: "setup_required", detail: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
  const p = prep.byId.get(params.companyId);
  if (!p) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const nowMs = Date.now();
  const { filters } = parseRequest(req.nextUrl.searchParams, nowMs, prep.data.state.window_start_ms);
  // Detail shows the whole synced window, all activity types, everyone's work on the account.
  const full = { ...filters, member: null, activityTypes: [], contactQ: "",
    activityFrom: prep.data.state.window_start_ms ?? 0, activityTo: nowMs + 86_400_000 };
  const period = calcAccount(prep, p, filters, nowMs);
  const whole = calcAccount(prep, p, full, nowMs);
  return NextResponse.json({
    account: toListRow(period, prep),
    window: { from: full.activityFrom, to: nowMs },
    raw: {
      is_group: p.row.is_group, type_of_dealership: p.row.type_of_dealership, group_name: p.row.group_name,
      icp: p.row.icp, country_raw: p.row.country,
    },
    contacts: contactRows([whole], prep, full).map((c) => ({ ...c, owner_id: prep.contactById.get(c.id)?.owner_id ?? null })),
    activities: whole.periodActs.map((a) => toActivityRow(a, prep)),
    deals: p.deals.map((d) => ({
      ...d, sdr_owner: prep.ownerName(d.sdr_owner_id), ae_owner: prep.ownerName(d.deal_owner_id),
    })),
  });
}
