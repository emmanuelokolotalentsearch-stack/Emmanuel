-- Atomic monthly feature quotas. Limits are defaults and can be adjusted for the product's plans.
create table if not exists public.usage_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  feature text not null,
  month_start date not null,
  units integer not null default 0 check(units >= 0),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,feature,month_start)
);
alter table public.usage_counters enable row level security;
create policy "Members view usage counters" on public.usage_counters for select to authenticated
using(public.is_workspace_member(workspace_id));

alter table public.outreach_messages drop constraint if exists outreach_messages_status_check;
alter table public.outreach_messages add constraint outreach_messages_status_check
check(status in ('draft','sending','sent','failed'));

create or replace function public.consume_feature_usage(target_workspace uuid, feature_name text, usage_units integer default 1)
returns table(allowed boolean, used integer, quota integer)
language plpgsql security definer set search_path=''
as $$
declare
  current_plan text := 'free';
  current_status text := 'free';
  month_key date := date_trunc('month',now())::date;
  quota_limit integer := 20;
  new_used integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if usage_units < 1 or usage_units > 100 then raise exception 'Invalid usage units'; end if;
  if not exists(select 1 from public.workspace_members wm where wm.workspace_id=target_workspace and wm.user_id=(select auth.uid()) and wm.role in ('owner','admin','member')) then
    raise exception 'Workspace access denied';
  end if;
  select coalesce(s.plan,'free'),coalesce(s.status,'free')
    into current_plan,current_status from public.subscriptions s where s.workspace_id=target_workspace;
  if current_status <> 'active' then current_plan := 'free'; end if;
  quota_limit := case current_plan when 'starter' then 200 when 'growth' then 1000 when 'business' then 5000 else 20 end;

  insert into public.usage_counters(workspace_id,feature,month_start,units)
    values(target_workspace,feature_name,month_key,0)
    on conflict(workspace_id,feature,month_start) do nothing;
  update public.usage_counters uc set units=uc.units+usage_units,updated_at=now()
    where uc.workspace_id=target_workspace and uc.feature=feature_name and uc.month_start=month_key
      and uc.units+usage_units<=quota_limit
    returning uc.units into new_used;
  if new_used is null then
    select uc.units into new_used from public.usage_counters uc
      where uc.workspace_id=target_workspace and uc.feature=feature_name and uc.month_start=month_key;
    return query select false,coalesce(new_used,0),quota_limit;
    return;
  end if;
  insert into public.usage_events(workspace_id,actor_id,feature,units)
    values(target_workspace,(select auth.uid()),feature_name,usage_units);
  return query select true,new_used,quota_limit;
end;
$$;
revoke all on function public.consume_feature_usage(uuid,text,integer) from public;
grant execute on function public.consume_feature_usage(uuid,text,integer) to authenticated;
