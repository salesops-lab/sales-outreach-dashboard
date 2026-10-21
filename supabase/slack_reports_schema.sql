-- Slack Reports: admin-managed report list + schedules + run log.
-- Additive and re-runnable. Apply once in the Supabase SQL editor (same project as sdr_schema.sql).
--
-- SECURITY: both tables have RLS ON and NO policies, so only the service role (the app's server
-- code) can read them. That keeps `webhook_url` (a Slack secret) out of every browser/anon/
-- authenticated query. The app never returns webhook_url from any API.

create extension if not exists pgcrypto;

create table if not exists sdr_slack_reports (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  report_type         text not null default 'call_blitz',
  manager_key         text not null,                 -- → sdr_managers.manager_key
  channel_label       text not null,                 -- display only, e.g. #team-vaibhav
  webhook_url         text,                          -- reports added from the page
  channel_env_var     text,                          -- the two original reports (Vercel env var name)
  exclude_owner_names text[] not null default '{}',
  schedule_enabled    boolean not null default false,
  schedule_days       int[]   not null default '{1,2,3,4,5}',   -- US/Eastern weekdays, 1 = Mon
  schedule_slots      jsonb   not null default
    '[{"time":"21:30","label":"Call Blitz-1"},{"time":"00:30","label":"Call Blitz-2"},{"time":"02:55","label":"Final Report"}]',
  schedule_tz         text    not null default 'Asia/Kolkata',
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sdr_slack_reports_dest check (webhook_url is not null or channel_env_var is not null)
);

-- One row per send attempt. Scheduled sends claim (report_id, slot_key) first, so a slot can
-- never send twice even if two scheduler pings overlap.
create table if not exists sdr_slack_report_runs (
  id          bigserial primary key,
  report_id   uuid not null references sdr_slack_reports(id) on delete cascade,
  kind        text not null,            -- scheduled | manual | test
  slot_key    text,                     -- scheduled only: "<ET date>@<HH:MM>"
  label       text,
  status      text not null,            -- sending | ok | error
  error       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists sdr_slack_report_runs_slot
  on sdr_slack_report_runs (report_id, slot_key) where slot_key is not null;
create index if not exists sdr_slack_report_runs_recent
  on sdr_slack_report_runs (report_id, created_at desc);

alter table sdr_slack_reports enable row level security;
alter table sdr_slack_report_runs enable row level security;

-- Seed the two reports that used to live in config/slack-reports.ts (only if the table is empty).
insert into sdr_slack_reports (name, manager_key, channel_label, channel_env_var, exclude_owner_names)
select * from (values
  ('Vaibhav Call Blitz', 'vaibhav', '#team-vaibhav', 'SLACK_VAIBHAV_WEBHOOK', '{}'::text[]),
  ('Rajveer Call Blitz', 'rajveer', '#team-rajveer', 'SLACK_RAJVEER_WEBHOOK', '{"Rajveer Singh"}'::text[])
) v
where not exists (select 1 from sdr_slack_reports);

notify pgrst, 'reload schema';
