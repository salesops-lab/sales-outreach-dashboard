/** Shared admin guard for server actions — re-derives the session on every call (not just page
 *  load), so a stale action reference can't bypass the gate. Used by both /admin and
 *  /slack-reports server actions. */
import { supabaseServer } from "../supabase/server";
import { resolveViewer } from "./resolve";

export async function requireAdmin(): Promise<void> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const viewer = await resolveViewer(user?.email ?? "");
  if (!viewer.isAdmin) throw new Error("forbidden");
}
