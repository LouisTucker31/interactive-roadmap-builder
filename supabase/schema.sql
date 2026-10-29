-- Workspace: the database behind the app (Supabase / Postgres).
--
-- Each signed-in person's saved data lives in user_data, one row per item the app keeps:
-- the project list, each project's plan, tags, templates, notes and their profile. The
-- `key` is the same name the app uses in the browser (e.g. roadmapProjects,
-- roadmapPlan:ex-thunder) and `value` is that item as JSON.
--
-- Row level security means each person can only read and change their own rows; signed-out
-- visitors can't touch the table at all. Sharing projects with other people later would
-- add tables alongside this one.

create table if not exists public.user_data (
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, key)
);

alter table public.user_data enable row level security;

drop policy if exists "Read your own data" on public.user_data;
create policy "Read your own data" on public.user_data
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists "Add your own data" on public.user_data;
create policy "Add your own data" on public.user_data
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists "Change your own data" on public.user_data;
create policy "Change your own data" on public.user_data
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists "Remove your own data" on public.user_data;
create policy "Remove your own data" on public.user_data
  for delete to authenticated using (owner = (select auth.uid()));

revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;
