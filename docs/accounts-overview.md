# Accounts Overview — design record, metric→source map, validation

`/accounts-overview` — account distribution, ownership, activity, ICP coverage and meeting/demo
tracking for the **Neelima · Prince · Saarthak · Central** teams. Built as an isolated, additive
feature: its own tables (`sdr_ao_*`), sync (`npm run ao:sync`, `.github/workflows/accounts-overview-sync.yml`),
API (`/api/accounts-overview`, `/api/accounts-overview/account/[id]`), page and components
(`components/accountsOverview/*`). The only edit to shared UI is one nav entry in `components/AppNav.tsx`.

## Why a separate pipeline

The main spine (`sdr_companies`, `sdr_activities`) holds only companies **owned by tracked reps**
and activity **performed by tracked reps**. Team assignment in HubSpot is not ownership: of the
4,932 companies on the four teams, ~3,300 are owned by the `salesops .` placeholder user and many
others by AEs / pod leads outside the roster. Building on the spine would silently drop most team
accounts and most non-roster activity, so the feature pulls its own company-centric slice.

## Verified HubSpot sources (portal 242626590, checked twice on 2026-10-16)

Pass 1 = CRM reporting (SQL group-bys). Pass 2 = CRM Search API `total`s. They matched.

| Concept | HubSpot source | Notes |
|---|---|---|
| **Assigned team** | company `team_accounts` (enum) | Options: Archit, Neelima, Saarthak, Central, Prince. Independent of the owner. |
| **Account owner** | company `hubspot_owner_id` | |
| **Activity owner** | engagement `hubspot_owner_id` | per call / email / meeting / note / task |
| **Contact owner** | contact `hubspot_owner_id` | |
| Dealership type | company `type_of_dealership` (Franchise / Independent) | `dealership_type` also exists; the dashboard has always used `type_of_dealership` |
| GD flag | company `is_this_is_a_part_of_group_dealership_` (true/false) | some records hold the label "Yes" (non-standard) |
| GD association | `gd_id`, `dealership_group_name`; GD name = `gd_name` ‖ `dealership_group_name` | same rule as `aggregate.ts unitKeyFor` |
| Company ICP | company `icp` (string: yes / no / empty) | `hs_ideal_customer_profile` exists but only 263 companies portal-wide have it — not used |
| Contact ICP | contact `icp_non_icp` (ICP / Non ICP) | sparse — reported separately, never merged with company ICP |
| Company last activity | company `notes_last_updated` ("Last Activity Date", HubSpot-maintained) | |
| Last contacted | company `notes_last_contacted` (HubSpot-maintained, excludes notes) | |
| Rooftop last activity | company `rooftop_last_activity` (custom) | null ≠ never contacted |
| Contact count reference | company `num_associated_contacts` | reconciled against association reads |
| Country | company `country` (free text) | normalized: us / usa / united states → USA; blank → Unknown |
| Calls | `calls` — `hs_timestamp`, `hs_call_direction`, `hs_call_disposition`, `hs_call_duration`, `hs_call_title` | |
| Emails | `emails` — `hs_email_direction`, `hs_email_subject`, `hs_email_reply_count` | |
| Meetings | `meetings` — `hs_timestamp`, `hs_meeting_outcome`, `hs_meeting_start_time`, `hs_meeting_title` | outcome is mostly unset (939 of 954 meetings since 2026-07-16) |
| Demos | Auto-Pipeline deals; `hs_v2_date_entered_<stage>` via `stageEventsOf` | same `demoScheduledMs` / `demoCompletedMs` as the rest of the app |

## Metric definitions

| Metric | Definition |
|---|---|
| Total accounts | company records with `team_accounts` ∈ selected teams, after filters. 1 record = 1 rooftop (no verified rooftop-vs-HQ flag exists; shared domains are flagged in Data Quality). |
| Single Franchise / Independent | `type_of_dealership` = Franchise / Independent, **no** GD association, GD flag explicitly No (`AO_REQUIRE_EXPLICIT_NON_GD_FLAG`) |
| Group Dealership | GD association (`gd_id` or `dealership_group_name`) **and** a GD name, flag not No |
| Unknown / Needs Review | everything else, with a reason (flag unset, flag Yes without GD, flag No with GD, GD ID without name, type missing) |
| Unique Group Dealerships | distinct GD keys (`gd_id`, else normalized group name) among Group accounts |
| Active / Inactive N+ / Inactive M+ | days since `notes_last_updated` (company) or `rooftop_last_activity` (rooftop), thresholds default 60/90, adjustable; "Inactive 60+" includes 90+ |
| No recorded activity | company `notes_last_updated` empty |
| Missing activity date | rooftop `rooftop_last_activity` empty |
| Needs review (date) | future-dated, or Last Contacted set while Last Activity Date empty |
| Never contacted (verified) | `notes_last_contacted` empty **and** no call/email/meeting found in the synced window |
| Calls / Connected | OUTBOUND calls; connected = the 11 GUIDs in `config/dispositions.ts` |
| Emails | `hs_email_direction` = EMAIL (outgoing) |
| Meetings | meeting records in the period; completed / cancelled / no-show only from `hs_meeting_outcome` — never inferred |
| Meeting-booked calls | calls with disposition Meeting Scheduled / Rescheduled (a separate, labelled source) |
| Touchpoints | calls + emails + meetings (notes and tasks are listed, not counted) |
| Contacted (account, period) | ≥ 1 touchpoint on the account or its associated contacts in the period |
| Demos booked / completed | deals whose demo booking / completion falls in the period; deal counted once even if on several accounts |
| Meeting / demo booking rate | accounts with a meeting (demo booked) ÷ accounts contacted, same period |
| ICP account coverage | ICP accounts contacted ÷ ICP accounts |
| ICP contact coverage | associated contacts at ICP accounts that were touched ÷ all associated contacts at ICP accounts |

Activity date is HubSpot `hs_timestamp` for every type. For **tasks** that is the task's due date,
so future-dated tasks fall outside the synced window and are not listed; tasks are never touchpoints.

Attribution: an activity directly associated to an in-scope company counts there; only when it has
no direct in-scope company is it attributed through its contacts' companies (`via_contact_only`).
Each activity counts once per account; team / rep totals de-duplicate by activity ID.

## Reconciliation built into the sync

Every run records (shown on the Data Quality tab): HubSpot Search `total` per team vs records pulled
vs rows re-counted in Postgres after the write; Σ `num_associated_contacts` vs association rows read;
associated contact ids vs readable contact records; excluded team counts (Archit).

## Known data gaps (live, 2026-10-16)

- **GD flag unset** on ~2,159 of the four teams' non-GD companies → Unknown / Needs Review under the
  strict rule. Turning `AO_REQUIRE_EXPLICIT_NON_GD_FLAG` off would class them by Type of Dealership.
- **Meeting outcome** almost never recorded → completed / cancelled meeting counts understate reality.
- **Contact ICP** set on 158 of 13,692 contacts associated to any `team_accounts` company (all five teams).
- **Country** blank on ~680 team accounts (hidden by the default USA filter; listed in Data Quality).
- **Rooftop Last Activity** blank on ~3,480 of 4,932 team accounts.
- **Team vs owner**: most team accounts are owned by the `salesops .` placeholder; roster pod ≠ team is common.
- **Roster AE owner ids**: several AE ids in `config/reps.ts` / `config/team-structure.ts` (e.g. Arun Divya Prakash 207645325029,
  Liam Fallon 300786392766, Pallav Pandey 303562897138, Jatin Arora 129303672507) do not match their HubSpot **owner** ids
  (82407666, 160575588, 68537322, 159882968). Not changed here; the Data Quality tab lists any active roster id that is not a HubSpot owner.

## Setup

1. Apply `supabase/accounts_overview_schema.sql` (additive).
2. Run the **Accounts Overview sync** workflow (or `npm run ao:sync` locally) — ~10–15 min; then every 6 h.
3. Open `/accounts-overview`. Until a sync completes, the page says so instead of showing zeros.
