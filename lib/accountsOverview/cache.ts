/** Server-side cache of the prepared Accounts Overview dataset (server-only: pulls supabaseAdmin).
 *  Every request does one cheap read of the sync-state row; the full dataset is re-read only when
 *  a sync has finished since the cached copy was taken (or after the TTL, for roster edits). So a
 *  completed sync shows up on the next request, and every filter change is computed in memory. */
import { loadTeamStructure } from "../team/load";
import { prepare, Prepared, RosterRef } from "./compute";
import { loadAoRows, loadAoState } from "./store";
import { AoSyncState } from "./types";

const TTL_MS = 5 * 60_000;
let cache: { prep: Prepared; at: number; version: string } | null = null;
let inflight: Promise<Prepared> | null = null;

const versionOf = (s: AoSyncState) => `${s.status}|${s.finished_at ?? ""}`;

export async function getPrepared(opts?: { fresh?: boolean }): Promise<Prepared> {
  const state = await loadAoState();
  if (!opts?.fresh && cache && cache.version === versionOf(state) && Date.now() - cache.at < TTL_MS) return cache.prep;
  // While a sync is mid-write the tables are partially rebuilt — keep serving the last complete copy.
  if (!opts?.fresh && cache && state.status === "running" && cache.prep.data.state.status !== "running") return cache.prep;
  if (inflight) return inflight;
  inflight = (async () => {
    const [rows, fresh, ts] = await Promise.all([loadAoRows(), loadAoState(), loadTeamStructure()]);
    const roster: RosterRef[] = ts.members.map((m) => ({ ownerId: m.ownerId, name: m.name, podKey: m.aePod, kind: m.kind, active: m.active }));
    const prep = prepare({ ...rows, state: fresh, roster });
    cache = { prep, at: Date.now(), version: versionOf(fresh) };
    return prep;
  })();
  try { return await inflight; } finally { inflight = null; }
}
