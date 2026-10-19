// Run via `npm run ao:dataset` — rebuilds ONLY the one-file dataset the Accounts Overview page reads,
// from the rows already in the sdr_ao_* tables (no HubSpot pull; ~1–2 min). The full `ao:sync`
// writes it too; this exists for the first rollout and for recovery.
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { loadAoRows, saveAoState, saveDataset } from "../lib/accountsOverview/store";

(async () => {
  const rows = await loadAoRows();
  const { bytes } = await saveDataset(rows);
  await saveAoState({ dataset_at: new Date().toISOString() });
  console.log(`[ao] dataset written: ${rows.companies.length} companies, ${rows.contacts.length} contacts, ` +
    `${rows.activities.length} activities, ${rows.deals.length} deals — ${(bytes / 1e6).toFixed(1)} MB gzipped`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
