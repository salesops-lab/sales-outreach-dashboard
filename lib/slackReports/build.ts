/**
 * Call Blitz Report assembly — the one function the scheduler, "Send Test", "Run Now", and the
 * live preview API route all call identically, so those surfaces can never show different numbers
 * for the same report. Loads raw data from the spine and folds it through the pure builder in
 * ./callBlitz.ts. Zero new date-bucketing or team-resolution logic — everything here is a direct
 * reuse of existing exported functions.
 */
import { makeEtContext, periodBounds } from "../sync/buckets";
import { dealsByRepLens, demoScheduledMs } from "../sync/aggregate";
import { loadActivitiesBetween, loadDealsWithEvents } from "../spine/store";
import { loadTeamStructure } from "../team/load";
import { sdrOwnersUnderManager, nameMap, kindMap } from "../team/helpers";
import { buildCallBlitzReport, CallBlitzReport } from "./callBlitz";

export interface AssembleInput {
  managerKey: string;
}

export async function assembleCallBlitzReport(input: AssembleInput, nowMs = Date.now()): Promise<CallBlitzReport> {
  const ctx = makeEtContext(nowMs);
  const { fromMs, toMs } = periodBounds("today", ctx); // ET "today" — verbatim, zero new date logic
  const reportDateEt = ctx.windowEndDate;

  const ts = await loadTeamStructure();
  const ownerIds = sdrOwnersUnderManager(ts, input.managerKey);
  const names = nameMap(ts);
  const teamName = ts.managers[input.managerKey]?.name ?? input.managerKey;

  if (ownerIds.length === 0) {
    return buildCallBlitzReport([], {}, [], names, reportDateEt, teamName);
  }

  const [activities, deals] = await Promise.all([
    loadActivitiesBetween(fromMs, toMs, ownerIds),
    loadDealsWithEvents(),
  ]);

  const kinds = kindMap(ts);
  const dealsByRep = dealsByRepLens(deals, ownerIds, kinds);
  const demosByOwner: Record<string, number> = {};
  for (const ownerId of ownerIds) {
    let n = 0;
    for (const d of dealsByRep.get(ownerId) ?? []) {
      const s = demoScheduledMs(d);
      if (s != null && s >= fromMs && s < toMs) n++;
    }
    demosByOwner[ownerId] = n;
  }

  return buildCallBlitzReport(activities, demosByOwner, ownerIds, names, reportDateEt, teamName);
}
