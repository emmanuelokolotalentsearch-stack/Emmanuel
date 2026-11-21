create table if not exists public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check(char_length(name) between 2 and 160),
  subject text not null check(char_length(subject) between 1 and 300),
  body text not null check(char_length(body) between 1 and 10000),
  status text not null default 'draft' check(status in ('draft','scheduled','sending','sent','paused','cancelled','failed')),
  scheduled_for timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outreach_campaigns_due_idx on public.outreach_campaigns(status,scheduled_for);
create table if not exists public.outreach_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','sending','sent','failed','skipped')),
  provider_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,contact_id)
);
create index if not exists campaign_recipients_due_idx on public.outreach_campaign_recipients(campaign_id,status,created_at);

alter table public.outreach_campaigns enable row level security;
alter table public.outreach_campaign_recipients enable row level security;
create policy "Members view campaigns" on public.outreach_campaigns for select to authenticated
using(public.is_workspace_member(workspace_id));
create policy "Editors create campaigns" on public.outreach_campaigns for insert to authenticated
with check(created_by=(select auth.uid()) and public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Editors update campaigns" on public.outreach_campaigns for update to authenticated
using(public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]))
with check(public.has_workspace_role(workspace_id,array['owner','admin','member']::public.workspace_role[]));
create policy "Members view campaign recipients" on public.outreach_campaign_recipients for select to authenticated
using(public.is_workspace_member(workspace_id));
-- Recipient creation and delivery state changes are service/SQL-function only.

create or replace function public.schedule_outreach_campaign(
  target_workspace uuid,
  campaign_name text,
  email_subject text,
  message_body text,
  contact_ids uuid[],
  run_at timestamptz
)
returns table(campaign_id uuid, recipient_count integer)
language plpgsql security definer set search_path=''
as $$
declare
  new_campaign uuid;
  added integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.has_workspace_role(target_workspace,array['owner','admin','member']::public.workspace_role[]) then
    raise exception 'Workspace access denied';
  end if;
  if char_length(btrim(campaign_name)) not between 2 and 160 then raise exception 'Campaign name must be 2 to 160 characters'; end if;
  if char_length(btrim(email_subject)) not between 1 and 300 then raise exception 'Subject is required'; end if;
  if char_length(btrim(message_body)) not between 1 and 10000 then raise exception 'Message body is required'; end if;
  if contact_ids is null or cardinality(contact_ids)=0 or cardinality(contact_ids)>500 then raise exception 'Select between 1 and 500 recipients'; end if;
  if run_at is null or run_at < now() - interval '1 minute' then raise exception 'Scheduled time must be now or in the future'; end if;

  insert into public.outreach_campaigns(workspace_id,created_by,name,subject,body,status,scheduled_for)
    values(target_workspace,(select auth.uid()),btrim(campaign_name),btrim(email_subject),btrim(message_body),'scheduled',run_at)
    returning id into new_campaign;
  insert into public.outreach_campaign_recipients(campaign_id,workspace_id,contact_id,status)
    select new_campaign,target_workspace,c.id,'queued'
    from public.contacts c
    where c.workspace_id=target_workspace
      and c.id=any(contact_ids)
      and c.email is not null and c.email_opt_in=true and c.email_unsubscribed_at is null
    on conflict(campaign_id,contact_id) do nothing;
  get diagnostics added = row_count;
  if added=0 then
    delete from public.outreach_campaigns where id=new_campaign;
    raise exception 'None of the selected contacts have an email address and recorded opt-in consent';
  end if;
  return query select new_campaign,added;
end;
$$;
revoke all on function public.schedule_outreach_campaign(uuid,text,text,text,uuid[],timestamptz) from public;
grant execute on function public.schedule_outreach_campaign(uuid,text,text,text,uuid[],timestamptz) to authenticated;
