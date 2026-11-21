create or replace function public.platform_admin_stats()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required'; end if;
  select jsonb_build_object(
    'users',(select count(*) from auth.users),
    'workspaces',(select count(*) from public.workspaces),
    'memberships',(select count(*) from public.workspace_members),
    'contacts',(select count(*) from public.contacts),
    'jobs',(select count(*) from public.jobs),
    'subscriptions_active',(select count(*) from public.subscriptions where status='active'),
    'subscriptions_past_due',(select count(*) from public.subscriptions where status='past_due'),
    'plans',(select coalesce(jsonb_object_agg(plan,total),'{}'::jsonb) from (select plan,count(*) total from public.subscriptions group by plan) p)
  ) into result;
  return result;
end;
$$;
revoke all on function public.platform_admin_stats() from public;
grant execute on function public.platform_admin_stats() to authenticated;
