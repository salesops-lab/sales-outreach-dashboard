// Run via `npm run ao:sync` — the npm script passes `tsx --conditions=react-server` so the
// `server-only` guards resolve to their no-op exports. Full rebuild of the Accounts Overview
// tables (sdr_ao_*) from HubSpot; needs HUBSPOT_PAT + Supabase service role and the
// supabase/accounts_overview_schema.sql migration. Isolated from the main spine sync.
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { runAccountsOverviewSync } from "../lib/accountsOverview/sync";

runAccountsOverviewSync().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
