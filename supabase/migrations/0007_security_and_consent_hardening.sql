-- Tighten workspace membership writes and protect tenant ownership fields.
-- Team API and workspace bootstrap use server-side security-definer/service-role operations.
drop policy if exists "Admins manage membership" on public.workspace_members;

-- Billing metadata and subscription status are visible to workspace owners/admins only.
drop policy if exists "Members view subscription" on public.subscriptions;
create policy "Workspace admins view subscription" on public.subscriptions for select to authenticated
using(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));

-- Store a verifiable consent record. A marketing opt-in without evidence is rejected.
alter table public.contacts
  add column if not exists email_opt_in_at timestamptz,
  add column if not exists email_consent_source text,
  add column if not exists email_consent_note text;
alter table public.contacts drop constraint if exists contacts_email_consent_evidence_check;
alter table public.contacts add constraint contacts_email_consent_evidence_check
check (
  email_opt_in = false
  or (
    email_opt_in_at is not null
    and email_consent_source is not null
    and char_length(btrim(coalesce(email_consent_note,''))) >= 10
  )
);

create or replace function public.prevent_tenant_ownership_changes()
returns trigger language plpgsql set search_path=''
as $$
begin
  if to_jsonb(old)->>'workspace_id' is distinct from to_jsonb(new)->>'workspace_id' then
    raise exception 'workspace_id is immutable';
  end if;
  if tg_table_name = 'activities' then
    if to_jsonb(old)->>'actor_id' is distinct from to_jsonb(new)->>'actor_id' then
      raise exception 'actor_id is immutable';
    end if;
  else
    if to_jsonb(old)->>'created_by' is distinct from to_jsonb(new)->>'created_by' then
      raise exception 'created_by is immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_tenant_fields_immutable on public.contacts;
create trigger contacts_tenant_fields_immutable before update on public.contacts
for each row execute function public.prevent_tenant_ownership_changes();
drop trigger if exists activities_tenant_fields_immutable on public.activities;
create trigger activities_tenant_fields_immutable before update on public.activities
for each row execute function public.prevent_tenant_ownership_changes();
drop trigger if exists jobs_tenant_fields_immutable on public.jobs;
create trigger jobs_tenant_fields_immutable before update on public.jobs
for each row execute function public.prevent_tenant_ownership_changes();
drop trigger if exists applications_tenant_fields_immutable on public.applications;
create trigger applications_tenant_fields_immutable before update on public.applications
for each row execute function public.prevent_tenant_ownership_changes();
drop trigger if exists outreach_templates_tenant_fields_immutable on public.outreach_templates;
create trigger outreach_templates_tenant_fields_immutable before update on public.outreach_templates
for each row execute function public.prevent_tenant_ownership_changes();
drop trigger if exists outreach_messages_tenant_fields_immutable on public.outreach_messages;
create trigger outreach_messages_tenant_fields_immutable before update on public.outreach_messages
for each row execute function public.prevent_tenant_ownership_changes();
drop trigger if exists campaigns_tenant_fields_immutable on public.outreach_campaigns;
create trigger campaigns_tenant_fields_immutable before update on public.outreach_campaigns
for each row execute function public.prevent_tenant_ownership_changes();

-- Make application-to-job workspace consistency a database invariant.
create unique index if not exists jobs_id_workspace_uidx on public.jobs(id,workspace_id);
alter table public.applications drop constraint if exists applications_job_workspace_fkey;
alter table public.applications add constraint applications_job_workspace_fkey
foreign key(job_id,workspace_id) references public.jobs(id,workspace_id) on delete cascade;
