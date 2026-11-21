-- Make scheduled send idempotency keys month-scoped and share the email-send quota
-- between individual drafts and scheduled campaign recipients.
alter table public.usage_idempotency add column if not exists month_start date;
update public.usage_idempotency
  set month_start = date_trunc('month',created_at)::date
  where month_start is null;
alter table public.usage_idempotency alter column month_start set not null;
alter table public.usage_idempotency drop constraint if exists usage_idempotency_pkey;
alter table public.usage_idempotency
  add constraint usage_idempotency_pkey primary key(workspace_id,feature,request_key,month_start);

drop function if exists public.consume_service_feature_usage(uuid,uuid,text,integer,text);
create or replace function public.consume_service_feature_usage(
  target_workspace uuid,
  target_actor uuid,
  feature_name text,
  usage_units integer default 1,
  request_key text default null
)
returns table(allowed boolean, used integer, quota integer)
language plpgsql security definer set search_path=''
as $$
declare
  current_plan text := 'free';
  current_status text := 'free';
  month_key date := date_trunc('month',now())::date;
  quota_limit integer := 20;
  new_used integer;
  new_key text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
  if usage_units < 1 or usage_units > 5000 then raise exception 'Invalid usage units'; end if;
  if not exists(select 1 from public.workspaces w where w.id=target_workspace) then raise exception 'Workspace not found'; end if;
  if not exists(select 1 from auth.users u where u.id=target_actor) then raise exception 'Actor not found'; end if;

  select coalesce(s.plan,'free'),coalesce(s.status,'free')
    into current_plan,current_status from public.subscriptions s where s.workspace_id=target_workspace;
  if current_status <> 'active' then current_plan := 'free'; end if;
  quota_limit := case current_plan when 'starter' then 200 when 'growth' then 1000 when 'business' then 5000 else 20 end;

  if request_key is not null then
    insert into public.usage_idempotency(workspace_id,feature,request_key,units,month_start)
      values(target_workspace,feature_name,request_key,usage_units,month_key)
      on conflict(workspace_id,feature,request_key,month_start) do nothing
      returning request_key into new_key;
    if new_key is null then
      select uc.units into new_used from public.usage_counters uc
        where uc.workspace_id=target_workspace and uc.feature=feature_name and uc.month_start=month_key;
      return query select true,coalesce(new_used,0),quota_limit;
      return;
    end if;
  end if;

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
    if request_key is not null then
      delete from public.usage_idempotency ui
        where ui.workspace_id=target_workspace and ui.feature=feature_name
          and ui.request_key=request_key and ui.month_start=month_key;
    end if;
    return query select false,coalesce(new_used,0),quota_limit;
    return;
  end if;

  insert into public.usage_events(workspace_id,actor_id,feature,units)
    values(target_workspace,target_actor,feature_name,usage_units);
  return query select true,new_used,quota_limit;
end;
$$;
revoke all on function public.consume_service_feature_usage(uuid,uuid,text,integer,text) from public;
grant execute on function public.consume_service_feature_usage(uuid,uuid,text,integer,text) to service_role;
