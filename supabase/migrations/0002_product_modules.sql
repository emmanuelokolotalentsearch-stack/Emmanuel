-- AI Workforce Search product modules. Apply after 0001_initial_schema.sql.
alter table public.contacts
  add column if not exists email_opt_in boolean not null default false,
  add column if not exists email_unsubscribed_at timestamptz,
  add column if not exists linkedin_url text,
  add column if not exists location text,
  add column if not exists last_contacted_at timestamptz;

create table if not exists public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check(char_length(title) between 2 and 200),
  company text, location text, employment_type text, source_url text,
  description text not null default '',
  status text not null default 'saved' check(status in ('saved','interested','applied','interviewing','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists jobs_workspace_created_idx on public.jobs(workspace_id,created_at desc);
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'planned' check(status in ('planned','applied','screening','interview','offer','rejected','withdrawn')),
  notes text, applied_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(job_id,created_by)
);
create table if not exists public.outreach_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check(char_length(name) between 1 and 120),
  subject text not null default '', body text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  recipient_email text not null, subject text not null, body text not null,
  status text not null default 'draft' check(status in ('draft','sent','failed')),
  provider_id text, error text, sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists outreach_workspace_created_idx on public.outreach_messages(workspace_id,created_at desc);
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  plan text not null default 'free' check(plan in ('free','starter','growth','business')),
  status text not null default 'free' check(status in ('free','pending','active','cancelled','past_due')),
  provider text, provider_reference text unique, customer_email text,
  current_period_end timestamptz, updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  feature text not null, units integer not null default 1 check(units > 0),
  created_at timestamptz not null default now()
);
create index if not exists usage_workspace_feature_created_idx on public.usage_events(workspace_id,feature,created_at desc);
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.platform_admins p where p.user_id=(select auth.uid())); $$;
revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

alter table public.workspace_settings enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.outreach_templates enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.platform_admins enable row level security;

create policy "Workspace members read settings" on public.workspace_settings for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "Workspace admins manage settings" on public.workspace_settings for all to authenticated
using(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]))
with check(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));

create policy "Members view jobs" on public.jobs for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "Editors create jobs" on public.jobs for insert to authenticated
with check(created_by=(select auth.uid()) and public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Editors update jobs" on public.jobs for update to authenticated
using(public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]))
with check(public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Admins delete jobs" on public.jobs for delete to authenticated using(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));

create policy "Members view applications" on public.applications for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "Editors create applications" on public.applications for insert to authenticated
with check(created_by=(select auth.uid()) and public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Editors update applications" on public.applications for update to authenticated
using(public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]))
with check(public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Admins delete applications" on public.applications for delete to authenticated using(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));

create policy "Members view templates" on public.outreach_templates for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "Editors create templates" on public.outreach_templates for insert to authenticated
with check(created_by=(select auth.uid()) and public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Editors update templates" on public.outreach_templates for update to authenticated
using(public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]))
with check(public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Admins delete templates" on public.outreach_templates for delete to authenticated using(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));

create policy "Members view outreach history" on public.outreach_messages for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "Editors create outreach drafts" on public.outreach_messages for insert to authenticated
with check(created_by=(select auth.uid()) and public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Members view subscription" on public.subscriptions for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "Members view usage" on public.usage_events for select to authenticated using(public.is_workspace_member(workspace_id));
-- platform_admins intentionally has no client read/write policy. Manage it via the SQL editor/service role.
-- Bootstrap the first platform administrator manually:
-- insert into public.platform_admins(user_id) select id from auth.users where email='YOUR_ADMIN_EMAIL';

create or replace function public.prevent_last_owner_removal()
returns trigger language plpgsql security definer set search_path=''
as $$
declare owner_count integer;
begin
  if tg_op='DELETE' and old.role='owner' then
    select count(*) into owner_count from public.workspace_members where workspace_id=old.workspace_id and role='owner' and user_id<>old.user_id;
    if owner_count=0 then raise exception 'A workspace must retain at least one owner'; end if;
  elsif tg_op='UPDATE' and old.role='owner' and new.role<>'owner' then
    select count(*) into owner_count from public.workspace_members where workspace_id=old.workspace_id and role='owner' and user_id<>old.user_id;
    if owner_count=0 then raise exception 'A workspace must retain at least one owner'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists workspace_members_keep_owner_delete on public.workspace_members;
drop trigger if exists workspace_members_keep_owner_update on public.workspace_members;
create trigger workspace_members_keep_owner_delete before delete on public.workspace_members
for each row execute function public.prevent_last_owner_removal();
create trigger workspace_members_keep_owner_update before update of role on public.workspace_members
for each row execute function public.prevent_last_owner_removal();
