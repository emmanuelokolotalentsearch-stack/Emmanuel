create or replace function public.get_workspace_usage(target_workspace uuid)
returns table(feature text, used integer, quota integer, remaining integer, plan text, month_start date)
language plpgsql stable security definer set search_path=''
as $$
declare
  current_plan text := 'free';
  current_status text := 'free';
  current_month date := date_trunc('month',now())::date;
  quota_limit integer := 20;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.workspace_members wm
    where wm.workspace_id=target_workspace and wm.user_id=(select auth.uid())) then
    raise exception 'Workspace access denied';
  end if;

  select coalesce(s.plan,'free'),coalesce(s.status,'free')
    into current_plan,current_status
    from public.subscriptions s where s.workspace_id=target_workspace;
  if not found or current_status <> 'active' then
    current_plan := 'free';
  end if;
  quota_limit := case current_plan when 'starter' then 200 when 'growth' then 1000 when 'business' then 5000 else 20 end;

  return query
  select features.feature,
         coalesce(c.units,0)::integer,
         quota_limit,
         greatest(quota_limit-coalesce(c.units,0),0)::integer,
         current_plan,
         current_month
  from (values
    ('people_search'),
    ('email_find'),
    ('email_verify'),
    ('job_search'),
    ('ai_assistant'),
    ('ai_profile_analysis'),
    ('ai_outreach_draft'),
    ('ai_job_match'),
    ('email_send')
  ) as features(feature)
  left join public.usage_counters c
    on c.workspace_id=target_workspace and c.feature=features.feature and c.month_start=current_month
  order by features.feature;
end;
$$;
revoke all on function public.get_workspace_usage(uuid) from public;
grant execute on function public.get_workspace_usage(uuid) to authenticated;
