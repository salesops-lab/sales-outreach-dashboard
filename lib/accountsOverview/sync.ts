/**
 * Accounts Overview sync — full rebuild of the sdr_ao_* tables from HubSpot (run from GitHub
 * Actions via `npm run ao:sync`; never at request time). Isolated from the main spine: separate
 * tables, separate state row, separate workflow — it cannot affect the existing dashboard.
 *
 * Reconciliation is built in (the "check twice" rule, at run time):
 *   - per team: HubSpot Search `total` vs records pulled vs rows re-counted in Postgres afterwards
 *   - contacts: Σ HubSpot num_associated_contacts vs association rows actually read
 *   - excluded teams (Archit): counted and reported, never silently dropped
 */
import { supabaseAdmin } from "../supabase/admin";
import { AO_ACTIVITY_WINDOW_DAYS, AO_EXCLUDED_TEAMS, AO_TEAMS } from "../../config/accounts-overview";
import {
  ACTIVITY_OBJECTS, associations, batchRead, CONTACT_PROPS, countTeamCompanies, DEAL_PROPS,
  pullAllOwners, searchTeamCompanies,
} from "./pull";
import { activityRow, companyRow, contactRow, dealRow } from "./rows";
import { AO_TABLES, loadAoState, pruneStale, saveAoState, upsertRun } from "./store";
import { AoActivityRow, AoCompanyRow, AoDealRow, AoReconRow } from "./types";

const DAY_MS = 86_400_000;
const STALE_RUN_MS = 3 * 60 * 60_000;

const invert = (m: Map<string, string[]>) => {
  const out = new Map<string, string[]>();
  for (const [from, tos] of m) for (const to of tos) { const l = out.get(to) ?? []; l.push(from); out.set(to, l); }
  return out;
};

export async function runAccountsOverviewSync(nowMs = Date.now()): Promise<{ ran: boolean }> {
  const prev = await loadAoState();
  if (prev.status === "running" && prev.started_at && nowMs - Date.parse(prev.started_at) < STALE_RUN_MS) {
    console.warn(`[ao] a sync started at ${prev.started_at} is still marked running — skipping`);
    return { ran: false };
  }
  const runId = new Date(nowMs).toISOString();
  const windowStart = nowMs - AO_ACTIVITY_WINDOW_DAYS * DAY_MS;
  await saveAoState({ status: "running", started_at: runId, error: null });
  const t0 = Date.now();
  try {
    const owners = await pullAllOwners();
    console.log(`[ao] owners: ${Object.keys(owners).length}`);

    // 1. companies per team (pass 1 of the team reconciliation)
    const recon: AoReconRow[] = [];
    const companies = new Map<string, AoCompanyRow>();
    for (const team of AO_TEAMS) {
      const { total, records } = await searchTeamCompanies(team.value);
      for (const r of records) companies.set(r.id, companyRow(r.id, r.properties));
      recon.push({ check: "team_companies", team: team.value, hubspot: total, stored: records.length, ok: total === records.length });
      console.log(`[ao] team ${team.value}: HubSpot total ${total}, pulled ${records.length}`);
    }
    for (const t of AO_EXCLUDED_TEAMS) {
      const n = await countTeamCompanies(t);
      recon.push({ check: "excluded_team", team: t, hubspot: n, stored: 0, ok: true, note: "team_accounts value outside the four in-scope teams — not pulled" });
    }
    const companyIds = [...companies.keys()];

    // 2. contacts
    const coContacts = await associations("companies", "contacts", companyIds);
    const contactCos = invert(coContacts);
    const contactIds = [...contactCos.keys()];
    const contactRecs = await batchRead("contacts", contactIds, CONTACT_PROPS, "contacts");
    const contacts = contactRecs.map((r) => contactRow(r.id, r.properties, contactCos.get(r.id) ?? []));
    const hsContactSum = [...companies.values()].reduce((a, c) => a + (c.num_contacts ?? 0), 0);
    const assocSum = [...coContacts.values()].reduce((a, l) => a + l.length, 0);
    recon.push({ check: "contact_associations", team: null, hubspot: hsContactSum, stored: assocSum, ok: hsContactSum === assocSum,
      note: "Σ num_associated_contacts vs company→contact associations read" });
    recon.push({ check: "contacts_readable", team: null, hubspot: contactIds.length, stored: contacts.length, ok: contactIds.length === contacts.length,
      note: "associated contact ids vs contact records returned (gap = archived/deleted)" });
    console.log(`[ao] contacts: ${contacts.length} (${contactIds.length} associated)`);

    // 3. deals (Auto Pipeline only — the dashboard's demo definitions)
    const coDeals = invert(await associations("companies", "deals", companyIds));
    const dealRecs = await batchRead("deals", [...coDeals.keys()], DEAL_PROPS, "deals");
    const deals = dealRecs.map((r) => dealRow(r.id, r.properties, coDeals.get(r.id) ?? [])).filter(Boolean) as AoDealRow[];
    console.log(`[ao] deals: ${deals.length} Auto-Pipeline of ${dealRecs.length} associated`);

    // 4. activities: direct company associations + contact-only associations, deduped by id.
    const activities: AoActivityRow[] = [];
    const counts: Record<string, number> = {};
    for (const obj of ACTIVITY_OBJECTS) {
      const direct = invert(await associations("companies", obj.object, companyIds));
      const viaContact = invert(await associations("contacts", obj.object, contactIds));
      const ids = [...new Set([...direct.keys(), ...viaContact.keys()])];
      const recs = await batchRead(obj.object, ids, obj.properties, obj.object);
      let kept = 0, outside = 0, undated = 0;
      for (const r of recs) {
        const directCos = direct.get(r.id) ?? [];
        const cts = viaContact.get(r.id) ?? [];
        // Direct in-scope company associations win; only when there are none is the activity
        // attributed through its contacts' in-scope companies (flagged via_contact_only).
        const cos = directCos.length ? directCos : [...new Set(cts.flatMap((c) => contactCos.get(c) ?? []))];
        const row = activityRow(obj.type, r.id, r.properties, cos, cts, directCos.length === 0);
        if (!row) { undated++; continue; }
        if (row.ts_ms < windowStart || row.ts_ms > nowMs + DAY_MS) { outside++; continue; }
        activities.push(row); kept++;
      }
      counts[`${obj.type}s`] = kept;
      console.log(`[ao] ${obj.object}: ${ids.length} associated, ${recs.length} read, ${kept} in window, ${outside} outside, ${undated} undated`);
    }

    // 5. write + prune rows from earlier runs
    await upsertRun(AO_TABLES.companies, [...companies.values()], runId);
    await upsertRun(AO_TABLES.contacts, contacts, runId);
    await upsertRun(AO_TABLES.deals, deals, runId);
    await upsertRun(AO_TABLES.activities, activities, runId);
    for (const t of Object.values(AO_TABLES)) {
      const removed = await pruneStale(t, runId);
      if (removed) console.log(`[ao] pruned ${removed} stale rows from ${t}`);
    }

    // 6. pass 2 — re-count what actually landed in Postgres, per team, against HubSpot's totals
    const sb = supabaseAdmin()!;
    for (const r of recon.filter((x) => x.check === "team_companies")) {
      const { count, error } = await sb.from(AO_TABLES.companies).select("hs_id", { count: "exact", head: true }).eq("team", r.team!);
      if (error) throw new Error(`[ao] recount ${r.team}: ${error.message}`);
      recon.push({ check: "team_companies_stored", team: r.team, hubspot: r.hubspot, stored: count ?? 0, ok: (count ?? 0) === r.hubspot });
    }

    Object.assign(counts, { companies: companies.size, contacts: contacts.length, deals: deals.length, activities: activities.length,
      duration_s: Math.round((Date.now() - t0) / 1000) });
    await saveAoState({ status: "ok", finished_at: new Date().toISOString(), window_start_ms: windowStart, counts, reconciliation: recon, owners, error: null });
    const bad = recon.filter((r) => !r.ok);
    console.log(`[ao] done in ${counts.duration_s}s — ${bad.length} reconciliation mismatch(es)`);
    for (const b of bad) console.warn(`[ao]   ✗ ${b.check}${b.team ? ` (${b.team})` : ""}: HubSpot ${b.hubspot} vs stored ${b.stored}`);
    return { ran: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await saveAoState({ status: "error", finished_at: new Date().toISOString(), error: msg }).catch(() => {});
    throw e;
  }
}
