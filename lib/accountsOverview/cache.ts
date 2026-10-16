/** Server-side cache of the prepared Accounts Overview dataset (server-only: pulls supabaseAdmin).
 *  Every request does one cheap read of the sync-state row; the full dataset is re-read only when
 *  a sync has finished since the cached copy was taken (or after a 5-min TTL). So a
 *  completed sync shows up on the next request, and every filter change is computed in memory. */
import { prepare, Prepared } from "./compute";
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
    const [rows, fresh] = await Promise.all([loadAoRows(), loadAoState()]);
    const prep = prepare({ ...rows, state: fresh });
    cache = { prep, at: Date.now(), version: versionOf(fresh) };
    return prep;
  })();
  try { return await inflight; } finally { inflight = null; }
}
