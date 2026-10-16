/**
 * Accounts Overview — HubSpot reads (sync-time only; the app never calls HubSpot at request time).
 * Reuses the shared hubspotFetch layer (retries 429 / 5xx / network errors, 300ms spacing).
 *
 * Shape of the pull:
 *   1. companies where HubSpot Team = <team id>, paged by an hs_object_id cursor so a team larger
 *      than the 10k Search cap (Neelima ≈ 14k) is still read completely; the first page's `total`
 *      is kept for reconciliation.
 *   2. company → contacts / deals (v4 batch reads, per-record paging followed).
 *   3. calls / emails / meetings / notes / tasks inside the activity window, via Search sliced by
 *      hs_timestamp (slices auto-split below the 10k cap), then activity → companies / contacts.
 */
import { hubspotGet, hubspotPost, RATE_LIMIT_DELAY_MS, delay } from "../hubspot/client";
import { STAGE_DATE_PROPERTIES } from "../sync/stage-events";
import { AO_COMPANY_PROPERTIES, AO_CONTACT_PROPERTIES } from "../../config/accounts-overview";
import { AoActivityType } from "./types";

const SEARCH_CAP = 9800;
const ASSOC_BATCH = 1000;
const OBJ_BATCH = 100;

export interface HsRecord { id: string; properties: Record<string, string | null> }
interface SearchRes { total?: number; results: HsRecord[]; paging?: { next?: { after?: string } } }

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** All companies whose HubSpot Team is `teamId`. Pages past the 10k Search cap with an
 *  hs_object_id cursor (each window restarts the search after the last id seen). */
export async function searchTeamCompanies(teamId: string): Promise<{ total: number; records: HsRecord[] }> {
  const records: HsRecord[] = [];
  let total = -1;
  let lastId = "0";
  for (;;) {
    let after: string | undefined;
    let inWindow = 0;
    let more = false;
    do {
      const body: Record<string, unknown> = {
        filterGroups: [{ filters: [
          { propertyName: "hubspot_team_id", operator: "EQ", value: teamId },
          { propertyName: "hs_object_id", operator: "GT", value: lastId },
        ] }],
        sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
        properties: AO_COMPANY_PROPERTIES,
        limit: 100,
      };
      if (after) body.after = after;
      const res = await hubspotPost<SearchRes>("/crm/v3/objects/companies/search", body);
      if (total < 0) total = res.total ?? 0;
      records.push(...res.results);
      inWindow += res.results.length;
      after = res.paging?.next?.after;
      await delay(RATE_LIMIT_DELAY_MS);
      if (after && inWindow >= SEARCH_CAP) { more = true; break; }
    } while (after);
    if (!more) break;
    lastId = records[records.length - 1].id;
  }
  return { total, records: [...new Map(records.map((r) => [r.id, r])).values()] };
}

/** Activities of one type with hs_timestamp in [fromMs, toMs). Weekly slices, each split in half
 *  until it is under the 10k Search cap — no slice can silently truncate. */
export async function searchActivities(object: string, properties: string[], fromMs: number, toMs: number): Promise<HsRecord[]> {
  const out = new Map<string, HsRecord>();
  const WEEK = 7 * 86_400_000;
  const slice = async (a: number, b: number): Promise<void> => {
    const page = async (after?: string) => {
      const body: Record<string, unknown> = {
        filterGroups: [{ filters: [
          { propertyName: "hs_timestamp", operator: "GTE", value: String(a) },
          { propertyName: "hs_timestamp", operator: "LT", value: String(b) },
        ] }],
        sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
        properties, limit: 100,
      };
      if (after) body.after = after;
      const res = await hubspotPost<SearchRes>(`/crm/v3/objects/${object}/search`, body);
      await delay(RATE_LIMIT_DELAY_MS);
      return res;
    };
    const first = await page();
    if ((first.total ?? 0) >= SEARCH_CAP && b - a > 60_000) {
      const mid = a + Math.floor((b - a) / 2);
      await slice(a, mid);
      await slice(mid, b);
      return;
    }
    for (const r of first.results) out.set(r.id, r);
    let after = first.paging?.next?.after;
    while (after) {
      const res = await page(after);
      for (const r of res.results) out.set(r.id, r);
      after = res.paging?.next?.after;
    }
  };
  for (let a = fromMs; a < toMs; a += WEEK) {
    await slice(a, Math.min(a + WEEK, toMs));
  }
  return [...out.values()];
}

interface V4Res {
  results?: { from: { id: string }; to?: { toObjectId?: number | string }[]; paging?: { next?: { after?: string } } }[];
}

/** fromId → toIds for one association pair. Follows per-record paging (v4 batch caps each
 *  record's list) so large accounts are never silently truncated. */
export async function associations(fromType: string, toType: string, fromIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const ids of chunk(fromIds, ASSOC_BATCH)) {
    const res = await hubspotPost<V4Res>(`/crm/v4/associations/${fromType}/${toType}/batch/read`, { inputs: ids.map((id) => ({ id })) });
    await delay(RATE_LIMIT_DELAY_MS);
    for (const r of res.results ?? []) {
      const list = (r.to ?? []).map((t) => String(t.toObjectId ?? "")).filter(Boolean);
      let after = r.paging?.next?.after;
      while (after) {
        const page = await hubspotGet<{ results?: { toObjectId?: number | string }[]; paging?: { next?: { after?: string } } }>(
          `/crm/v4/objects/${fromType}/${r.from.id}/associations/${toType}?limit=500&after=${encodeURIComponent(after)}`);
        await delay(RATE_LIMIT_DELAY_MS);
        list.push(...(page.results ?? []).map((t) => String(t.toObjectId ?? "")).filter(Boolean));
        after = page.paging?.next?.after;
      }
      out.set(r.from.id, [...new Set(list)]);
    }
  }
  return out;
}

/** v3 batch read (100/request). Archived/deleted ids simply don't come back. */
export async function batchRead(objectType: string, ids: string[], properties: string[], log?: string): Promise<HsRecord[]> {
  const out: HsRecord[] = [];
  const batches = chunk(ids, OBJ_BATCH);
  for (let i = 0; i < batches.length; i++) {
    const res = await hubspotPost<{ results?: HsRecord[] }>(`/crm/v3/objects/${objectType}/batch/read`,
      { properties, inputs: batches[i].map((id) => ({ id })) });
    out.push(...(res.results ?? []));
    await delay(RATE_LIMIT_DELAY_MS);
    if (log && (i + 1) % 50 === 0) console.log(`  [${log}] ${i + 1}/${batches.length} batches`);
  }
  return out;
}

/** HubSpot object type (v3/v4 path segment) per activity type + the properties we keep. */
export const ACTIVITY_OBJECTS: { type: AoActivityType; object: string; properties: string[] }[] = [
  { type: "call", object: "calls", properties: ["hs_timestamp", "hubspot_owner_id", "hs_call_direction", "hs_call_disposition", "hs_call_duration", "hs_call_title"] },
  { type: "email", object: "emails", properties: ["hs_timestamp", "hubspot_owner_id", "hs_email_direction", "hs_email_subject", "hs_email_reply_count"] },
  { type: "meeting", object: "meetings", properties: ["hs_timestamp", "hubspot_owner_id", "hs_meeting_outcome", "hs_meeting_start_time", "hs_meeting_title"] },
  { type: "note", object: "notes", properties: ["hs_timestamp", "hubspot_owner_id", "hs_note_body"] },
  { type: "task", object: "tasks", properties: ["hs_timestamp", "hubspot_owner_id", "hs_task_subject", "hs_task_status"] },
];

export const CONTACT_PROPS = AO_CONTACT_PROPERTIES;

export const DEAL_PROPS = [
  "pipeline", "dealstage", "hubspot_owner_id", "sdr_owner",
  "discovery_call_done_stage_date", "demo_done_stage_date",
  ...STAGE_DATE_PROPERTIES,
];

/** Every owner incl. archived ones (so former reps still resolve to a name), with their HubSpot
 *  team ids — the source of each team's member list. */
export async function pullAllOwners(): Promise<Record<string, { name: string; active: boolean; teams: string[] }>> {
  const out: Record<string, { name: string; active: boolean; teams: string[] }> = {};
  for (const archived of [false, true]) {
    let after: string | undefined;
    do {
      const res = await hubspotGet<{ results: { id: string; firstName?: string; lastName?: string; email?: string; teams?: { id: string | number }[] }[]; paging?: { next?: { after?: string } } }>(
        `/crm/v3/owners?limit=100&archived=${archived}${after ? `&after=${after}` : ""}`);
      for (const o of res.results) {
        if (out[o.id] && !archived) continue;
        const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || `Owner ${o.id}`;
        out[o.id] = { name, active: !archived, teams: (o.teams ?? []).map((t) => String(t.id)) };
      }
      after = res.paging?.next?.after;
      await delay(RATE_LIMIT_DELAY_MS);
    } while (after);
  }
  return out;
}
