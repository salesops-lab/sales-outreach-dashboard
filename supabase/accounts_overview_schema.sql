-- Accounts Overview (additive, isolated) — apply once in the Supabase SQL editor.
-- New sdr_ao_* tables only; nothing here alters an existing table, function or policy.
-- Fed by `npm run ao:sync` (.github/workflows/accounts-overview-sync.yml); read by
-- /api/accounts-overview. Each sync is a full rebuild: rows carry the run_id that last saw them
-- and rows from older runs are pruned after a successful write.

create table if not exists sdr_ao_companies (
  hs_id                    text primary key,
  name                     text,
  domain                   text,
  country                  text,      -- raw free text (normalized in the app: us/usa/united states → USA)
  state                    text,
  city                     text,
  owner_id                 text,      -- hubspot_owner_id — ACCOUNT owner
  team                     text,      -- team_accounts — ASSIGNED team (independent of owner)
  icp                      text,      -- raw company `icp`
  type_of_dealership       text,
  is_group                 text,      -- raw is_this_is_a_part_of_group_dealership_
  gd_id                    text,
  gd_name                  text,
  group_name               text,      -- dealership_group_name
  last_activity_ms         bigint,    -- notes_last_updated  (Last Activity Date)
  last_contacted_ms        bigint,    -- notes_last_contacted (Last Contacted)
  rooftop_last_activity_ms bigint,    -- rooftop_last_activity
  num_contacts             integer,   -- num_associated_contacts (reconciliation reference)
  hs_lastmodified_ms       bigint,
  run_id                   text not null,
  updated_at               timestamptz not null default now()
);
create index if not exists idx_sdr_ao_companies_team on sdr_ao_companies (team);
create index if not exists idx_sdr_ao_companies_run on sdr_ao_companies (run_id);

create table if not exists sdr_ao_contacts (
  hs_id             text primary key,
  first_name        text,
  last_name         text,
  title             text,
  email             text,
  phone             text,
  owner_id          text,             -- CONTACT owner
  icp               text,             -- raw icp_non_icp (contact-level ICP)
  last_activity_ms  bigint,
  last_contacted_ms bigint,
  company_ids       jsonb not null default '[]',  -- in-scope companies only
  run_id            text not null,
  updated_at        timestamptz not null default now()
);
create index if not exists idx_sdr_ao_contacts_run on sdr_ao_contacts (run_id);

create table if not exists sdr_ao_activities (
  hs_id            text primary key,  -- engagement id (unique across calls/emails/meetings/notes/tasks)
  type             text not null check (type in ('call','email','meeting','note','task')),
  ts_ms            bigint not null,   -- hs_timestamp
  owner_id         text,              -- ACTIVITY owner
  direction        text,
  disposition      text,
  duration_ms      bigint,
  email_replied    boolean not null default false,
  meeting_outcome  text,
  meeting_start_ms bigint,
  subject          text,
  company_ids      jsonb not null default '[]',
  contact_ids      jsonb not null default '[]',
  via_contact_only boolean not null default false,
  run_id           text not null,
  updated_at       timestamptz not null default now()
);
create index if not exists idx_sdr_ao_activities_ts on sdr_ao_activities (ts_ms);
create index if not exists idx_sdr_ao_activities_run on sdr_ao_activities (run_id);

create table if not exists sdr_ao_deals (
  hs_id             text primary key,
  stage_key         text,
  deal_owner_id     text,             -- hubspot_owner_id (AE)
  sdr_owner_id      text,             -- sdr_owner (SDR)
  company_ids       jsonb not null default '[]',
  demo_booked_ms    bigint,           -- demoScheduledMs(): entered Discovery Call Done
  demo_completed_ms bigint,           -- demoCompletedMs(): first Demo Done / Accepted / In Discussion
  run_id            text not null,
  updated_at        timestamptz not null default now()
);
create index if not exists idx_sdr_ao_deals_run on sdr_ao_deals (run_id);

create table if not exists sdr_ao_sync_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Same RLS floor as every sdr_* table: SELECT for authenticated @spyne.ai Google logins only;
-- no write policies (the sync writes with the service role, which bypasses RLS).
do $$
declare t text;
begin
  foreach t in array array['sdr_ao_companies','sdr_ao_contacts','sdr_ao_activities','sdr_ao_deals','sdr_ao_sync_state']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_spyne_select', t);
    execute format($p$
      create policy %I on %I for select to authenticated
        using ((auth.jwt() ->> 'email') ilike '%%@spyne.ai'
               and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google')
    $p$, t || '_spyne_select', t);
  end loop;
end $$;
