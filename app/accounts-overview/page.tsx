import { resolveViewer } from "../../lib/access/resolve";
import { supabaseServer } from "../../lib/supabase/server";
import AccountsOverview from "../../components/accountsOverview/AccountsOverview";

// Data is fetched client-side from /api/accounts-overview (server-side filtered); this page only
// resolves the viewer for the shared nav. Auth: the global middleware gate.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AccountsOverviewPage() {
  let email = "";
  try {
    const { data: { user } } = await supabaseServer().auth.getUser();
    email = user?.email ?? "";
  } catch { /* no auth env (local dev) — resolveViewer degrades to the org-wide viewer */ }
  const viewer = await resolveViewer(email);
  return <AccountsOverview viewer={viewer} />;
}
