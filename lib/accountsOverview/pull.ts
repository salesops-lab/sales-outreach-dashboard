/**
 * Accounts Overview — HubSpot reads (sync-time only; the app never calls HubSpot at request time).
 * Reuses the shared hubspotFetch layer (retries 429 / 5xx / network errors, 300ms spacing).
 *
 * Shape of the pull (company-centric, so ANY owner's work on a team account is captured — the
 * main spine only holds tracked reps' activity):
 *   1. companies where team_accounts = <team>  (one Search per team, each far below the 10k cap;
 *      the Search `total` is kept for reconciliation and a near-cap result FAILS the run)
 *   2. company → contacts / deals / calls / emails / meetings / notes / tasks  (v4 batch reads,
 *      per-record paging followed so no association list is truncated)
 *   3. contact → calls / emails / meetings / notes / tasks  (activity logged on a contact only)
 *   4. v3 batch reads of every referenced object; activities outside the window are dropped.
 */
import { hubspotGet, hubspotPost, RATE_LIMIT_DELAY_MS, delay } from "../hubspot/client";
import { STAGE_DATE_PROPERTIES } from "../sync/stage-events";
import { AO_COMPANY_PROPERTIES, AO_CONTACT_PROPERTIES } from "../../config/accounts-overview";
import { AoActivityType } from "./types";

const SEARCH_CAP = 9800;
const ASSOC_BATCH = 1000;
const OBJ_BATCH = 100;

export interface HsRecord { id: string; properties: Record<string, string | null> }

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** All companies with team_accounts = value. Returns HubSpot's own `total` for reconciliation. */
export async function searchTeamCompanies(team: string): Promise<{ total: number; records: HsRecord[] }> {
  const records: HsRecord[] = [];
  let after: string | undefined;
  let total = 0;
  do {
    const body: Record<string, unknown> = {
      filterGroups: [{ filters: [{ propertyName: "team_accounts", operator: "EQ", value: team }] }],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
      properties: AO_COMPANY_PROPERTIES,
      limit: 100,
    };
    if (after) body.after = after;
    const res = await hubspotPost<{ total?: number; results: HsRecord[]; paging?: { next?: { after?: string } } }>(
      "/crm/v3/objects/companies/search", body);
    total = res.total ?? total;
    if (total >= SEARCH_CAP) {
      throw new Error(`team_accounts=${team} has ${total} companies — at the Search 10k ceiling; refusing a truncated pull`);
    }
    records.push(...res.results);
    after = res.paging?.next?.after;
    await delay(RATE_LIMIT_DELAY_MS);
  } while (after);
  return { total, records };
}

/** Count-only Search (limit 1) — for teams outside scope, reported but not pulled. */
export async function countTeamCompanies(team: string): Promise<number> {
  const res = await hubspotPost<{ total?: number }>("/crm/v3/objects/companies/search", {
    filterGroups: [{ filters: [{ propertyName: "team_accounts", operator: "EQ", value: team }] }],
    properties: ["name"], limit: 1,
  });
  await delay(RATE_LIMIT_DELAY_MS);
  return res.total ?? 0;
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

/** Every owner incl. archived ones (so former reps still resolve to a name). */
export async function pullAllOwners(): Promise<Record<string, { name: string; active: boolean }>> {
  const out: Record<string, { name: string; active: boolean }> = {};
  for (const archived of [false, true]) {
    let after: string | undefined;
    do {
      const res = await hubspotGet<{ results: { id: string; firstName?: string; lastName?: string; email?: string }[]; paging?: { next?: { after?: string } } }>(
        `/crm/v3/owners?limit=100&archived=${archived}${after ? `&after=${after}` : ""}`);
      for (const o of res.results) {
        if (out[o.id] && !archived) continue;
        const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || `Owner ${o.id}`;
        out[o.id] = { name, active: !archived };
      }
      after = res.paging?.next?.after;
      await delay(RATE_LIMIT_DELAY_MS);
    } while (after);
  }
  return out;
}
