-- M1 step 9: branches (PLAN.md 5.9). A branch is a group of kind 'branch' (M0's groups
-- table); a person works at most at one (firm_members.branch_id) and a client is served
-- from at most one (clients.branch_id). Branches are for finding clients; their own office
-- connections, PCs and hours arrive with M7. Removing a branch clears both.
alter table public.firm_members drop constraint firm_members_firm_id_branch_id_fkey,
  add constraint firm_members_firm_id_branch_id_fkey foreign key (firm_id, branch_id)
    references public.groups (firm_id, id) on delete set null (branch_id);
alter table public.clients add column branch_id uuid,
  add constraint clients_firm_id_branch_id_fkey foreign key (firm_id, branch_id)
    references public.groups (firm_id, id) on delete set null (branch_id);
create index clients_branch on public.clients (firm_id, branch_id) where branch_id is not null;
grant update (branch_id) on public.clients to authenticated;

drop trigger member_team_logged on public.firm_members;
create trigger member_group_logged after update of team_id, branch_id on public.firm_members
  for each row execute function public.log_change('member', 'user_id', 'member');

-- The firm's people now come with their branch.
drop function public.firm_people(uuid);
create function public.firm_people(target_firm uuid)
returns table (user_id uuid, email text, role text, status text, team_id uuid, branch_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.status, m.team_id, m.branch_id
  from public.firm_members m join auth.users u on u.id = m.user_id
  where m.firm_id = target_firm and public.member_role(target_firm) is not null
  order by m.status, u.email
$$;
revoke all on function public.firm_people(uuid) from public, anon, authenticated, service_role;
grant execute on function public.firm_people(uuid) to authenticated;
