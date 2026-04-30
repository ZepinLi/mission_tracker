create extension if not exists pgcrypto;

create table if not exists public.mission_tracker_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  core jsonb not null default '{}'::jsonb,
  system_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_saved_at timestamptz,
  last_manual_saved_at timestamptz
);

alter table public.mission_tracker_profiles
  add column if not exists email text not null default '',
  add column if not exists display_name text not null default '',
  add column if not exists avatar_seed text not null default '',
  add column if not exists default_page_id uuid;

create table if not exists public.mission_tracker_weeks (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_key text not null,
  week_start date not null,
  week_end date not null,
  entries jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_key)
);

create table if not exists public.mission_tracker_pages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled Page',
  slug text not null unique,
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  core jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  content_hash text not null default '',
  last_writer_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mission_tracker_page_members (
  page_id uuid not null references public.mission_tracker_pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  display_name text not null default 'Anonymous',
  email text not null default '',
  avatar_seed text not null default '',
  joined_via text not null default 'direct',
  created_at timestamptz not null default now(),
  primary key (page_id, user_id)
);

create table if not exists public.mission_tracker_page_invites (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.mission_tracker_pages(id) on delete cascade,
  page_title text not null default 'Shared page',
  invite_email text not null,
  role text not null check (role in ('viewer', 'commenter', 'editor')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_by_name text not null default 'Owner',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.mission_tracker_share_links (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.mission_tracker_pages(id) on delete cascade,
  page_title text not null default 'Shared page',
  token_hash text not null unique,
  token_hint text not null default '',
  role text not null check (role in ('viewer', 'commenter', 'editor')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_by_name text not null default 'Owner',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.mission_tracker_page_weeks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.mission_tracker_pages(id) on delete cascade,
  week_key text not null,
  week_start date not null,
  week_end date not null,
  entries jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  content_hash text not null default '',
  last_writer_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, week_key)
);

create table if not exists public.mission_tracker_comment_threads (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.mission_tracker_pages(id) on delete cascade,
  anchor text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Anonymous',
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_by_name text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_activity_at timestamptz not null default now()
);

create table if not exists public.mission_tracker_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.mission_tracker_comment_threads(id) on delete cascade,
  page_id uuid not null references public.mission_tracker_pages(id) on delete cascade,
  body text not null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Anonymous',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public.mission_tracker_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.mission_tracker_role_rank(role text)
returns integer
language sql
immutable
as $$
  select case role
    when 'viewer' then 1
    when 'commenter' then 2
    when 'editor' then 3
    when 'owner' then 4
    else 0
  end;
$$;

create or replace function public.mission_tracker_page_role(target_page_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select 'owner'
      from public.mission_tracker_pages pages
      where pages.id = target_page_id
        and pages.owner_id = auth.uid()
      limit 1
    ),
    (
      select members.role
      from public.mission_tracker_page_members members
      where members.page_id = target_page_id
        and members.user_id = auth.uid()
      limit 1
    ),
    ''
  );
$$;

create or replace function public.mission_tracker_has_page_role(target_page_id uuid, minimum_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mission_tracker_role_rank(public.mission_tracker_page_role(target_page_id))
    >= public.mission_tracker_role_rank(minimum_role);
$$;

create or replace function public.mission_tracker_accept_invite(invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.mission_tracker_page_invites;
  auth_email text;
  current_name text;
begin
  auth_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  select *
  into invite_row
  from public.mission_tracker_page_invites
  where id = invite_id
    and lower(invite_email) = auth_email
    and accepted_at is null
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if invite_row.id is null then
    raise exception 'Invite is invalid or expired';
  end if;

  select coalesce(display_name, split_part(auth_email, '@', 1))
  into current_name
  from public.mission_tracker_profiles
  where user_id = auth.uid();

  insert into public.mission_tracker_page_members (
    page_id,
    user_id,
    role,
    display_name,
    email,
    avatar_seed,
    joined_via
  )
  values (
    invite_row.page_id,
    auth.uid(),
    invite_row.role,
    coalesce(current_name, split_part(auth_email, '@', 1)),
    auth_email,
    auth_email,
    'invite'
  )
  on conflict (page_id, user_id) do update
  set role = excluded.role,
      display_name = excluded.display_name,
      email = excluded.email,
      avatar_seed = excluded.avatar_seed,
      joined_via = excluded.joined_via;

  update public.mission_tracker_page_invites
  set accepted_at = now()
  where id = invite_id;

  return invite_row.page_id;
end;
$$;

create or replace function public.mission_tracker_join_share_link(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.mission_tracker_share_links;
  auth_email text;
  current_name text;
begin
  auth_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  select *
  into link_row
  from public.mission_tracker_share_links
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if link_row.id is null then
    raise exception 'Share link is invalid or expired';
  end if;

  select coalesce(display_name, split_part(auth_email, '@', 1))
  into current_name
  from public.mission_tracker_profiles
  where user_id = auth.uid();

  insert into public.mission_tracker_page_members (
    page_id,
    user_id,
    role,
    display_name,
    email,
    avatar_seed,
    joined_via
  )
  values (
    link_row.page_id,
    auth.uid(),
    link_row.role,
    coalesce(current_name, split_part(auth_email, '@', 1)),
    auth_email,
    auth_email,
    'share_link'
  )
  on conflict (page_id, user_id) do update
  set role = excluded.role,
      display_name = excluded.display_name,
      email = excluded.email,
      avatar_seed = excluded.avatar_seed,
      joined_via = excluded.joined_via;

  return link_row.page_id;
end;
$$;

create or replace function public.mission_tracker_touch_page_from_related()
returns trigger
language plpgsql
as $$
declare
  touched_page_id uuid;
  writer_id uuid;
begin
  if tg_table_name = 'mission_tracker_page_weeks' then
    if tg_op = 'DELETE' then
      touched_page_id := old.page_id;
      writer_id := old.last_writer_id;
    else
      touched_page_id := new.page_id;
      writer_id := coalesce(new.last_writer_id, old.last_writer_id);
    end if;
  elsif tg_table_name = 'mission_tracker_comment_threads' then
    touched_page_id := coalesce(new.page_id, old.page_id);
    writer_id := coalesce(new.resolved_by, new.author_id, old.resolved_by, old.author_id);
  else
    if tg_op = 'DELETE' then
      touched_page_id := old.page_id;
      writer_id := old.author_id;
    else
      touched_page_id := new.page_id;
      writer_id := coalesce(new.author_id, old.author_id);
    end if;
  end if;

  update public.mission_tracker_pages
  set updated_at = now(),
      last_writer_id = coalesce(writer_id, last_writer_id)
  where id = touched_page_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists mission_tracker_profiles_touch_updated_at on public.mission_tracker_profiles;
create trigger mission_tracker_profiles_touch_updated_at
before update on public.mission_tracker_profiles
for each row execute function public.mission_tracker_touch_updated_at();

drop trigger if exists mission_tracker_pages_touch_updated_at on public.mission_tracker_pages;
create trigger mission_tracker_pages_touch_updated_at
before update on public.mission_tracker_pages
for each row execute function public.mission_tracker_touch_updated_at();

drop trigger if exists mission_tracker_page_weeks_touch_updated_at on public.mission_tracker_page_weeks;
create trigger mission_tracker_page_weeks_touch_updated_at
before update on public.mission_tracker_page_weeks
for each row execute function public.mission_tracker_touch_updated_at();

drop trigger if exists mission_tracker_comments_touch_updated_at on public.mission_tracker_comments;
create trigger mission_tracker_comments_touch_updated_at
before update on public.mission_tracker_comments
for each row execute function public.mission_tracker_touch_updated_at();

drop trigger if exists mission_tracker_page_weeks_touch_page on public.mission_tracker_page_weeks;
create trigger mission_tracker_page_weeks_touch_page
after insert or update or delete on public.mission_tracker_page_weeks
for each row execute function public.mission_tracker_touch_page_from_related();

drop trigger if exists mission_tracker_comment_threads_touch_page on public.mission_tracker_comment_threads;
create trigger mission_tracker_comment_threads_touch_page
after insert or update on public.mission_tracker_comment_threads
for each row execute function public.mission_tracker_touch_page_from_related();

drop trigger if exists mission_tracker_comments_touch_page on public.mission_tracker_comments;
create trigger mission_tracker_comments_touch_page
after insert or update or delete on public.mission_tracker_comments
for each row execute function public.mission_tracker_touch_page_from_related();

alter table public.mission_tracker_profiles enable row level security;
alter table public.mission_tracker_weeks enable row level security;
alter table public.mission_tracker_pages enable row level security;
alter table public.mission_tracker_page_members enable row level security;
alter table public.mission_tracker_page_invites enable row level security;
alter table public.mission_tracker_share_links enable row level security;
alter table public.mission_tracker_page_weeks enable row level security;
alter table public.mission_tracker_comment_threads enable row level security;
alter table public.mission_tracker_comments enable row level security;

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

drop policy if exists "Users can read accessible pages" on public.mission_tracker_pages;
create policy "Users can read accessible pages"
on public.mission_tracker_pages
for select
to authenticated
using (public.mission_tracker_has_page_role(id, 'viewer'));

drop policy if exists "Users can create owned pages" on public.mission_tracker_pages;
create policy "Users can create owned pages"
on public.mission_tracker_pages
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "Editors can update pages" on public.mission_tracker_pages;
create policy "Editors can update pages"
on public.mission_tracker_pages
for update
to authenticated
using (public.mission_tracker_has_page_role(id, 'editor'))
with check (public.mission_tracker_has_page_role(id, 'editor'));

drop policy if exists "Owners can delete pages" on public.mission_tracker_pages;
create policy "Owners can delete pages"
on public.mission_tracker_pages
for delete
to authenticated
using (public.mission_tracker_has_page_role(id, 'owner'));

drop policy if exists "Members can read members" on public.mission_tracker_page_members;
create policy "Members can read members"
on public.mission_tracker_page_members
for select
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'viewer'));

drop policy if exists "Owners can insert members" on public.mission_tracker_page_members;
create policy "Owners can insert members"
on public.mission_tracker_page_members
for insert
to authenticated
with check (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners can update members" on public.mission_tracker_page_members;
create policy "Owners can update members"
on public.mission_tracker_page_members
for update
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'owner'))
with check (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners can delete members" on public.mission_tracker_page_members;
create policy "Owners can delete members"
on public.mission_tracker_page_members
for delete
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners and invitees can read invites" on public.mission_tracker_page_invites;
create policy "Owners and invitees can read invites"
on public.mission_tracker_page_invites
for select
to authenticated
using (
  public.mission_tracker_has_page_role(page_id, 'owner')
  or lower(invite_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists "Owners can create invites" on public.mission_tracker_page_invites;
create policy "Owners can create invites"
on public.mission_tracker_page_invites
for insert
to authenticated
with check (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners can update invites" on public.mission_tracker_page_invites;
create policy "Owners can update invites"
on public.mission_tracker_page_invites
for update
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'owner'))
with check (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners can delete invites" on public.mission_tracker_page_invites;
create policy "Owners can delete invites"
on public.mission_tracker_page_invites
for delete
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners can read share links" on public.mission_tracker_share_links;
create policy "Owners can read share links"
on public.mission_tracker_share_links
for select
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners can create share links" on public.mission_tracker_share_links;
create policy "Owners can create share links"
on public.mission_tracker_share_links
for insert
to authenticated
with check (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners can update share links" on public.mission_tracker_share_links;
create policy "Owners can update share links"
on public.mission_tracker_share_links
for update
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'owner'))
with check (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Owners can delete share links" on public.mission_tracker_share_links;
create policy "Owners can delete share links"
on public.mission_tracker_share_links
for delete
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'owner'));

drop policy if exists "Members can read page weeks" on public.mission_tracker_page_weeks;
create policy "Members can read page weeks"
on public.mission_tracker_page_weeks
for select
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'viewer'));

drop policy if exists "Editors can insert page weeks" on public.mission_tracker_page_weeks;
create policy "Editors can insert page weeks"
on public.mission_tracker_page_weeks
for insert
to authenticated
with check (public.mission_tracker_has_page_role(page_id, 'editor'));

drop policy if exists "Editors can update page weeks" on public.mission_tracker_page_weeks;
create policy "Editors can update page weeks"
on public.mission_tracker_page_weeks
for update
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'editor'))
with check (public.mission_tracker_has_page_role(page_id, 'editor'));

drop policy if exists "Editors can delete page weeks" on public.mission_tracker_page_weeks;
create policy "Editors can delete page weeks"
on public.mission_tracker_page_weeks
for delete
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'editor'));

drop policy if exists "Members can read comment threads" on public.mission_tracker_comment_threads;
create policy "Members can read comment threads"
on public.mission_tracker_comment_threads
for select
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'viewer'));

drop policy if exists "Commenters can insert comment threads" on public.mission_tracker_comment_threads;
create policy "Commenters can insert comment threads"
on public.mission_tracker_comment_threads
for insert
to authenticated
with check (public.mission_tracker_has_page_role(page_id, 'commenter'));

drop policy if exists "Commenters can update comment threads" on public.mission_tracker_comment_threads;
create policy "Commenters can update comment threads"
on public.mission_tracker_comment_threads
for update
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'commenter'))
with check (public.mission_tracker_has_page_role(page_id, 'commenter'));

drop policy if exists "Members can read comments" on public.mission_tracker_comments;
create policy "Members can read comments"
on public.mission_tracker_comments
for select
to authenticated
using (public.mission_tracker_has_page_role(page_id, 'viewer'));

drop policy if exists "Commenters can insert comments" on public.mission_tracker_comments;
create policy "Commenters can insert comments"
on public.mission_tracker_comments
for insert
to authenticated
with check (public.mission_tracker_has_page_role(page_id, 'commenter'));

drop policy if exists "Comment authors can update comments" on public.mission_tracker_comments;
create policy "Comment authors can update comments"
on public.mission_tracker_comments
for update
to authenticated
using (
  public.mission_tracker_has_page_role(page_id, 'commenter')
  and author_id = auth.uid()
)
with check (
  public.mission_tracker_has_page_role(page_id, 'commenter')
  and author_id = auth.uid()
);

create index if not exists mission_tracker_weeks_user_week_idx
on public.mission_tracker_weeks (user_id, week_key);

create index if not exists mission_tracker_pages_owner_idx
on public.mission_tracker_pages (owner_id, updated_at desc);

create index if not exists mission_tracker_page_members_user_idx
on public.mission_tracker_page_members (user_id, created_at desc);

create index if not exists mission_tracker_page_invites_page_idx
on public.mission_tracker_page_invites (page_id, created_at desc);

create index if not exists mission_tracker_page_invites_email_idx
on public.mission_tracker_page_invites (lower(invite_email));

create index if not exists mission_tracker_share_links_page_idx
on public.mission_tracker_share_links (page_id, created_at desc);

create index if not exists mission_tracker_page_weeks_page_week_idx
on public.mission_tracker_page_weeks (page_id, week_key);

create index if not exists mission_tracker_comment_threads_page_anchor_idx
on public.mission_tracker_comment_threads (page_id, anchor, last_activity_at desc);

create index if not exists mission_tracker_comments_thread_idx
on public.mission_tracker_comments (thread_id, created_at);
