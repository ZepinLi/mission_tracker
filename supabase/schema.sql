create table if not exists public.mission_tracker_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  core jsonb not null default '{}'::jsonb,
  system_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_saved_at timestamptz,
  last_manual_saved_at timestamptz
);

create table if not exists public.mission_tracker_weeks (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_key text not null,
  week_start date not null,
  week_end date not null,
  entries jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_key)
);

alter table public.mission_tracker_profiles enable row level security;
alter table public.mission_tracker_weeks enable row level security;

drop policy if exists "Users can read own tracker profile" on public.mission_tracker_profiles;
create policy "Users can read own tracker profile"
on public.mission_tracker_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own tracker profile" on public.mission_tracker_profiles;
create policy "Users can insert own tracker profile"
on public.mission_tracker_profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own tracker profile" on public.mission_tracker_profiles;
create policy "Users can update own tracker profile"
on public.mission_tracker_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own tracker profile" on public.mission_tracker_profiles;
create policy "Users can delete own tracker profile"
on public.mission_tracker_profiles
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own tracker weeks" on public.mission_tracker_weeks;
create policy "Users can read own tracker weeks"
on public.mission_tracker_weeks
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own tracker weeks" on public.mission_tracker_weeks;
create policy "Users can insert own tracker weeks"
on public.mission_tracker_weeks
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own tracker weeks" on public.mission_tracker_weeks;
create policy "Users can update own tracker weeks"
on public.mission_tracker_weeks
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own tracker weeks" on public.mission_tracker_weeks;
create policy "Users can delete own tracker weeks"
on public.mission_tracker_weeks
for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists mission_tracker_weeks_user_week_idx
on public.mission_tracker_weeks (user_id, week_key);
