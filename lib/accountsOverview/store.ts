/** Accounts Overview — sdr_ao_* Postgres I/O (server-only: service role). Isolated from the main
 *  spine tables; nothing here reads or writes sdr_companies/sdr_activities/sdr_snapshots. */
import { gunzipSync, gzipSync } from "node:zlib";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabase/admin";
import { AoActivityRow, AoCompanyRow, AoContactRow, AoDealRow, AoSyncState } from "./types";

const BATCH = 500;
const PAGE = 1000;

function sb(): SupabaseClient {
  const c = supabaseAdmin();
  if (!c) throw new Error("[ao] Supabase env missing");
  return c;
}

export const AO_TABLES = {
  companies: "sdr_ao_companies",
  contacts: "sdr_ao_contacts",
  activities: "sdr_ao_activities",
  deals: "sdr_ao_deals",
} as const;

/** Upsert rows stamped with this run's id; rows not re-seen are pruned by pruneStale(). */
export async function upsertRun(table: string, rows: object[], runId: string) {
  const byId = new Map<string, object>();
  for (const r of rows) byId.set((r as { hs_id: string }).hs_id, { ...r, run_id: runId });
  const all = [...byId.values()];
  for (let i = 0; i < all.length; i += BATCH) {
    const { error } = await sb().from(table).upsert(all.slice(i, i + BATCH), { onConflict: "hs_id" });
    if (error) throw new Error(`[ao] upsert ${table}: ${error.message}`);
  }
}

/** Delete rows from earlier runs (left the team, archived, or fell out of the window). Chunked —
 *  single-statement bulk deletes can trip statement_timeout. */
export async function pruneStale(table: string, runId: string): Promise<number> {
  let removed = 0;
  for (;;) {
    const { data, error } = await sb().from(table).select("hs_id").neq("run_id", runId).limit(500);
    if (error) throw new Error(`[ao] prune scan ${table}: ${error.message}`);
    const ids = (data ?? []).map((r: { hs_id: string }) => r.hs_id);
    if (!ids.length) return removed;
    const { error: e } = await sb().from(table).delete().in("hs_id", ids);
    if (e) throw new Error(`[ao] prune ${table}: ${e.message}`);
    removed += ids.length;
  }
}

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const { count, error } = await sb().from(table).select("hs_id", { count: "exact", head: true });
  if (error) throw new Error(`[ao] count ${table}: ${error.message}`);
  const n = count ?? 0;
  const pages: T[][] = new Array(Math.ceil(n / PAGE));
  let next = 0;
  // ≤6 page reads in flight — fast without flooding PostgREST on the ~60k-row activity table.
  await Promise.all(Array.from({ length: Math.min(6, pages.length) }, async () => {
    while (next < pages.length) {
      const i = next++;
      const { data, error: e } = await sb().from(table).select(select).order("hs_id", { ascending: true }).range(i * PAGE, i * PAGE + PAGE - 1);
      if (e) throw new Error(`[ao] fetch ${table}: ${e.message}`);
      pages[i] = data as T[];
    }
  }));
  return pages.flat();
}

const num = (v: unknown) => (v == null ? null : Number(v));
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

const COMPANY_BASE = "hs_id,name,domain,country,state,city,owner_id,team,icp,type_of_dealership,is_group,gd_id,gd_name,group_name,last_activity_ms,last_contacted_ms,rooftop_last_activity_ms,num_contacts,hs_lastmodified_ms";
const DEAL_BASE = "hs_id,stage_key,deal_owner_id,sdr_owner_id,company_ids,demo_booked_ms,demo_completed_ms";

export async function loadAoRows() {
  const [companies, contacts, activities, deals] = await Promise.all([
    // potential_rooftops arrived 2026-10-19 — fall back to the old shape until the SQL is applied.
    fetchAll<AoCompanyRow>(AO_TABLES.companies, `${COMPANY_BASE},potential_rooftops`)
      .catch(() => fetchAll<AoCompanyRow>(AO_TABLES.companies, COMPANY_BASE)),
    fetchAll<AoContactRow>(AO_TABLES.contacts, "hs_id,first_name,last_name,title,email,phone,owner_id,icp,last_activity_ms,last_contacted_ms,company_ids"),
    fetchAll<AoActivityRow>(AO_TABLES.activities, "hs_id,type,ts_ms,owner_id,direction,disposition,duration_ms,email_replied,meeting_outcome,meeting_start_ms,subject,company_ids,contact_ids,via_contact_only"),
    // Deal-detail columns arrived 2026-10-17 — fall back to the old shape until the SQL is applied.
    fetchAll<AoDealRow>(AO_TABLES.deals, `${DEAL_BASE},deal_name,amount,created_ms,close_ms,team`)
      .catch(() => fetchAll<AoDealRow>(AO_TABLES.deals, DEAL_BASE)),
  ]);
  // bigint columns arrive as strings from PostgREST — normalize.
  return {
    companies: companies.map((r) => ({ ...r, last_activity_ms: num(r.last_activity_ms), last_contacted_ms: num(r.last_contacted_ms),
      rooftop_last_activity_ms: num(r.rooftop_last_activity_ms), num_contacts: num(r.num_contacts), hs_lastmodified_ms: num(r.hs_lastmodified_ms),
      potential_rooftops: num(r.potential_rooftops) })),
    contacts: contacts.map((r) => ({ ...r, last_activity_ms: num(r.last_activity_ms), last_contacted_ms: num(r.last_contacted_ms), company_ids: arr(r.company_ids) })),
    activities: activities.map((r) => ({ ...r, ts_ms: Number(r.ts_ms), duration_ms: num(r.duration_ms), meeting_start_ms: num(r.meeting_start_ms),
      company_ids: arr(r.company_ids), contact_ids: arr(r.contact_ids) })),
    deals: deals.map((r) => ({ ...r, demo_booked_ms: num(r.demo_booked_ms), demo_completed_ms: num(r.demo_completed_ms), company_ids: arr(r.company_ids),
      amount: num(r.amount), created_ms: num(r.created_ms), close_ms: num(r.close_ms) })),
  };
}

const EMPTY_STATE: AoSyncState = {
  status: "never", started_at: null, finished_at: null, window_start_ms: null,
  counts: {}, reconciliation: [], owners: {}, error: null,
};

export async function loadAoState(): Promise<AoSyncState> {
  const { data, error } = await sb().from("sdr_ao_sync_state").select("state").eq("id", 1).maybeSingle();
  if (error) throw new Error(`[ao] state: ${error.message}`);
  return { ...EMPTY_STATE, ...((data?.state as Partial<AoSyncState>) ?? {}) };
}

export async function saveAoState(patch: Partial<AoSyncState>) {
  const cur = await loadAoState().catch(() => EMPTY_STATE);
  const { error } = await sb().from("sdr_ao_sync_state").upsert({ id: 1, state: { ...cur, ...patch }, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(`[ao] save state: ${error.message}`);
}

// ── prepared dataset file (fast path for the page) ─────────────────────────────
// Reading ~210k rows through PostgREST on every cold start was too slow for the 60 s serverless
// limit. The sync therefore also writes every row into ONE gzipped JSON file in Supabase Storage
// (private bucket, service role only); the API downloads that single file. The row tables stay
// the source of truth and the fallback.
const BUCKET = "accounts-overview";
const DATASET = "dataset.json.gz";

export interface AoRows { companies: AoCompanyRow[]; contacts: AoContactRow[]; activities: AoActivityRow[]; deals: AoDealRow[] }

export async function saveDataset(rows: AoRows): Promise<{ bytes: number }> {
  const c = sb();
  const { error: be } = await c.storage.createBucket(BUCKET, { public: false });
  if (be && !/exist/i.test(be.message)) throw new Error(`[ao] bucket: ${be.message}`);
  const body = gzipSync(Buffer.from(JSON.stringify(rows)));
  const { error } = await c.storage.from(BUCKET).upload(DATASET, body, { upsert: true, contentType: "application/gzip" });
  if (error) throw new Error(`[ao] dataset upload: ${error.message}`);
  return { bytes: body.length };
}

/** The dataset file, or null when it does not exist yet (callers then read the row tables). */
export async function loadDataset(): Promise<AoRows | null> {
  const { data, error } = await sb().storage.from(BUCKET).download(DATASET);
  if (error || !data) return null;
  return JSON.parse(gunzipSync(Buffer.from(await data.arrayBuffer())).toString("utf8")) as AoRows;
}
