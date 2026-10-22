# Accounts Overview — design record, metric→source map, validation

`/accounts-overview` — account distribution, ownership, activity, ICP coverage and meeting/demo
tracking for the **Neelima · Prince · Saarthak · Central** teams. Built as an isolated, additive
feature: its own tables (`sdr_ao_*`), sync (`npm run ao:sync`, `.github/workflows/accounts-overview-sync.yml`),
API (`/api/accounts-overview`, `/api/accounts-overview/account/[id]`), page and components
(`components/accountsOverview/*`). The only edit to shared UI is one nav entry in `components/AppNav.tsx`.

## Why a separate pipeline

Team = the company's **HubSpot Team** (`hubspot_team_id`, set by HubSpot from the company owner's
team). As of 2026-10-16: Neelima 13,992 · Saarthak 5,502 · Prince 2,603 · Central 378 companies.
The main spine only holds companies owned by — and activity done by — the TrackerAI roster, so it
would miss many of these. The feature therefore pulls its own slice.

> History: the first version used the hand-filled `team_accounts` dropdown (Saarthak = 1,723). The
> user confirmed HubSpot's "Team" is the right field (Saarthak = 5,502), so it was switched.

## Verified HubSpot sources (portal 242626590, checked twice on 2026-10-16)

Pass 1 = CRM reporting (SQL group-bys). Pass 2 = CRM Search API `total`s. They matched.

| Concept | HubSpot source | Notes |
|---|---|---|
| **Team** | company `hubspot_team_id` ("HubSpot Team") | Team ids in `config/accounts-overview.ts`; members = owners in that HubSpot team |
| **Account owner** | company `hubspot_owner_id` | |
| **Activity owner** | engagement `hubspot_owner_id` | per call / email / meeting / note / task |
| **Contact owner** | contact `hubspot_owner_id` | |
| Dealership type | company `type_of_dealership` (Franchise / Independent) | `dealership_type` also exists; the dashboard has always used `type_of_dealership` |
| GD Name | company `gd_name` ("GD Name") | the only field that decides Group vs Single |
| Company ICP | company `icp` (string: yes / no / empty) | `hs_ideal_customer_profile` exists but only 263 companies portal-wide have it — not used |
| Contact ICP | contact `icp_non_icp` (ICP / Non ICP) | sparse — reported separately, never merged with company ICP |
| Company last activity | company `notes_last_updated` ("Last Activity Date", HubSpot-maintained) | |
| Last contacted | company `notes_last_contacted` (HubSpot-maintained, excludes notes) | |
| Rooftop last activity | company `rooftop_last_activity` (custom) | null ≠ never contacted |
| #Potential Rooftops | company `potential_rooftops` (custom number) | group drawer shows the highest value in the group |
| Contact count reference | company `num_associated_contacts` | reconciled against association reads |
| Country | company `country_dropdown` ("Country Dropdown"), else free-text `country` | dropdown is far more complete (119,645 "United States" vs ~67k free-text US variants) |
| **US TAM** | company `country_dropdown` = United States | 119,645 on 2026-10-17 — matches the old TAM dashboard |
| Calls | `calls` — `hs_timestamp`, `hs_call_direction`, `hs_call_disposition`, `hs_call_duration`, `hs_call_title` | |
| Emails | `emails` — `hs_email_direction`, `hs_email_subject`, `hs_email_reply_count` | |
| Meetings | `meetings` — `hs_timestamp`, `hs_meeting_outcome`, `hs_meeting_start_time`, `hs_meeting_title` | outcome is mostly unset (939 of 954 meetings since 2026-07-16) |
| Demos | Auto-Pipeline deals; `hs_v2_date_entered_<stage>` via `stageEventsOf` | same `demoScheduledMs` / `demoCompletedMs` as the rest of the app |

## The page (redesigned 2026-10-17 at the user's request — no filter applied by default)

**Accounts tab**, top to bottom:
1. **HubSpot US accounts (TAM)** — every US company in HubSpot (Country Dropdown = United States):
   total, Single Independent, Single Franchise, Group Dealership + distinct GD Names. Counted at
   sync time (Search totals + the grouped companies' GD Names); **not** affected by the filters.
   Live check 2026-10-17: 119,645 = group 21,454 + SI 89,626 + SF 8,565 (+0 unknown).
2. **Filters** — Team, Team member (= account owner), GD Name, Type of Dealership, Company ICP,
   Country, State, Last Activity Date, Activity date range (default: all synced activity), Activity type.
3. **Teams** — one card per team (total / Group / Single Franchise / Single Independent, members,
   accounts by owner role). Click a team → its members.
4. **Team members** — one card per HubSpot team member (role from the TrackerAI roster: Manager /
   SDR / AE) plus anyone else who owns accounts in the team, with their account counts. Click → list.
5. **Accounts** — 8 cards that drill one searchable, sortable list (CSV, click a company for detail).
   Default columns: Company, Team, Account owner, Account type, Type of Dealership, GD Name,
   #Potential Rooftops, Last Activity Date, Rooftop Last Activity, State, Calls, Emails, Touchpoints.
   **Manage columns** shows / hides / re-orders them (more available: City, Country, ICP, Last
   Contacted, Connected, Meetings, Demos, Contacts, Domain, Record ID) — remembered per browser.
   Clicking a **GD Name** opens the group drawer: every rooftop with that GD Name in the four teams
   (other filters ignored), #Potential Rooftops, franchise / independent split, 60-day work, latest
   dates, teams / owners / states and activity.

**Deals & Pipeline tab** (redesigned 2026-10-19; the 60-day columns moved into the Accounts tab's team
and member tables):
1. **Demos & deals — last completed quarter**: totals, by team, by current stage, deal-detail list.
2. **Team members** (HubSpot main team only): demos booked, conducted, not conducted and total deals in their name.
3. **Pipeline**: one block per member with their quarter deals grouped by current stage (lost last).
4. **Are members using their accounts and contacts?** — a funnel over each member's OWN accounts:
   owned → worked → contacts reached / connected → ICP worked / connected / meeting-or-demo →
   meetings booked (call outcome) / logged (meeting records) → demos booked / done (quarter) →
   touches per worked account. Default window: last 3 months; follows the Activity date range when set.

## Metric definitions

| Metric | Definition |
|---|---|
| US TAM | companies with Country Dropdown = United States (HubSpot-wide, every team or none) |
| Total accounts | companies whose HubSpot Team is one of the selected teams, after filters (groups + single rooftops) |
| Group Dealership | **GD Name** (`gd_name`) is set |
| Single Franchise | GD Name empty + Type of Dealership = Franchise |
| Single Independent | GD Name empty + Type of Dealership = Independent |
| Unknown | GD Name and Type of Dealership both empty (0 on the four teams as of 2026-10-16) |
| Worked in last 60 days | **Group rooftops:** Rooftop Last Activity (`rooftop_last_activity`) < 60 days ago. **Single companies (SF + SI):** HubSpot Last Activity Date (`notes_last_updated`) < 60 days ago (user decision 2026-10-21; `workStatus` in `compute.ts`) |
| Not touched in 60+ days | The same date (rooftop for groups, company for singles) is 60 or more days ago |
| No recorded activity | That date is empty |
| Never contacted | HubSpot Last Contacted (`notes_last_contacted`) empty **and** no call/email/meeting synced |
| Calls / Connected | OUTBOUND calls; connected = the 11 GUIDs in `config/dispositions.ts` |
| Emails | `hs_email_direction` = EMAIL (outgoing) |
| Touchpoints | calls + emails (meetings, notes, tasks are shown but not counted) |
| Contacted (account, date range) | ≥ 1 touchpoint on the account or its associated contacts in the range |
| Quarter deals (stored) | Auto-Pipeline deals created, demo-booked or demo-done in the last completed quarter; team = the deal's company team, else the SDR's / deal owner's HubSpot team; deals with no team in the four are dropped |
| Team members | HubSpot users whose MAIN team ("Default Team") is the team — extra teams ignored. Roles from the confirmed mapping (`AO_TEAM_ROSTER`) |
| A deal's team | the team of its SDR (who booked it), else of its deal owner (AE) — not the company's team (2026-10-22) |
| Demos booked (quarter) | deal entered Discovery Call Done in the quarter |
| Conducted | of those booked: the deal reached Demo Done / Accepted / In Discussion (at any time so far) |
| Not conducted | booked − conducted (no-show, still pending, or dropped before a demo) |
| Total deals | every quarter deal of the team / in the member's name (as SDR or deal owner) |
| Pipeline by current stage | quarter deals grouped by their current canonical stage |
| Worked < 60 days / not worked 60+ | Same rule as "Worked in last 60 days" (per account owner). The By-team table shows one row per team with the split as columns: Group accounts, Single Fr., Single Ind., Group worked / not worked, Single worked / not worked, No activity (Group / Single) |
| Member role | TrackerAI roster: AE-pod lead or SDR manager/TL = Manager, else SDR / AE; not in roster = blank |
| Contacts reached | contacts on the member's accounts that appear on a call or email in the activity date range |
| Avg calls / emails per ICP | the member's own calls / emails on their ICP accounts ÷ their ICP accounts |

Activity date is HubSpot `hs_timestamp` for every type. For **tasks** that is the task's due date,
so future-dated tasks fall outside the synced window and are not listed; tasks are never touchpoints.

Attribution: an activity directly associated to an in-scope company counts there; only when it has
no direct in-scope company is it attributed through its contacts' companies (`via_contact_only`).
Each activity counts once per account; team / rep totals de-duplicate by activity ID.

## Reconciliation built into the sync

Every run records (in `sdr_ao_sync_state`): HubSpot Search `total` per team vs records pulled
vs rows re-counted in Postgres after the write; Σ `num_associated_contacts` vs association rows read;
associated contact ids vs readable contact records.

## Known data gaps (live, 2026-10-16)

- **Meeting outcome** is rarely recorded in HubSpot, so completed / cancelled meeting counts understate reality.
- **Contact ICP** (`icp_non_icp`) is set on very few contacts.
- **Country**: the dropdown is used first; companies with neither field set show as "Unknown".
- **Distinct GD Names**: the user's reference is 3,431; the sync counts GD Names case-insensitively among
  US companies (HubSpot's report API caps a GROUP BY at 500 rows, so this could not be cross-checked there).
- **Roster AE owner ids**: several AE ids in `config/reps.ts` / `config/team-structure.ts` do not match their HubSpot owner ids
  (e.g. Liam Fallon 300786392766 vs owner 160575588). Not used by this feature; not changed here.

## Setup

1. Apply `supabase/accounts_overview_schema.sql` (additive; re-runnable — the 2026-10-17 version adds
   five deal-detail columns to `sdr_ao_deals`, so re-run it before the next sync).
2. Run the **Accounts Overview sync** workflow (or `npm run ao:sync` locally) — ~10–15 min; then every 6 h.
3. Open `/accounts-overview`. Until a sync completes, the page says so instead of showing zeros.
4. The page reads one gzipped dataset file (Supabase Storage bucket `accounts-overview`, created by
   the sync). To rebuild just that file from the stored rows: run the workflow with **dataset_only**
   ticked (or `npm run ao:dataset`, ~1–2 min).
