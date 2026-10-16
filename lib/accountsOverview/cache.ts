/** Server-side cache of the prepared Accounts Overview dataset (server-only: pulls supabaseAdmin).
 *  One DB read per TTL per server instance; every filter change is computed in memory. */
import { loadTeamStructure } from "../team/load";
import { prepare, Prepared, RosterRef } from "./compute";
import { loadAoRows, loadAoState } from "./store";

const TTL_MS = 5 * 60_000;
let cache: { prep: Prepared; at: number } | null = null;
let inflight: Promise<Prepared> | null = null;

export async function getPrepared(opts?: { fresh?: boolean }): Promise<Prepared> {
  if (!opts?.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.prep;
  if (inflight) return inflight;
  inflight = (async () => {
    const [rows, state, ts] = await Promise.all([loadAoRows(), loadAoState(), loadTeamStructure()]);
    const roster: RosterRef[] = ts.members.map((m) => ({ ownerId: m.ownerId, name: m.name, podKey: m.aePod, kind: m.kind, active: m.active }));
    const prep = prepare({ ...rows, state, roster });
    cache = { prep, at: Date.now() };
    return prep;
  })();
  try { return await inflight; } finally { inflight = null; }
}
