-- Remove direct, orphan-producing workspace inserts; the secure RPC is the only create path.
drop policy if exists "Users create own workspaces" on public.workspaces;

-- Existing clients cannot mutate membership rows. Team management uses server-side admin credentials.
drop policy if exists "Admins manage membership" on public.workspace_members;

-- Only workspace owners/admins can update campaign content or state.
drop policy if exists "Editors update campaigns" on public.outreach_campaigns;
create policy "Workspace admins update campaigns" on public.outreach_campaigns for update to authenticated
using(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]))
with check(public.has_workspace_role(workspace_id,array['owner','admin']::public.workspace_role[]));

-- Workspace identity and creator are fixed at creation.
create or replace function public.prevent_workspace_creator_change()
returns trigger language plpgsql set search_path=''
as $$
begin
  if old.id is distinct from new.id or old.created_by is distinct from new.created_by then
    raise exception 'Workspace identity and creator are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists workspaces_identity_immutable on public.workspaces;
create trigger workspaces_identity_immutable before update on public.workspaces
for each row execute function public.prevent_workspace_creator_change();

-- Functions used in RLS are executable only by authenticated users.
revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.has_workspace_role(uuid,public.workspace_role[]) from public;
revoke all on function public.create_workspace(text,text) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid,public.workspace_role[]) to authenticated;
grant execute on function public.create_workspace(text,text) to authenticated;
