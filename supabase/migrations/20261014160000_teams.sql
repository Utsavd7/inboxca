-- M1 step 6: teams (PLAN.md 5.9). A team is a group of kind 'team' (M0's groups table);
-- a person belongs to at most one (firm_members.team_id). A client can be assigned to a
-- whole team as well as to a person, so in restricted mode the whole team sees it.

-- Deleting a team clears its people's team instead of being refused.
alter table public.firm_members drop constraint firm_members_firm_id_team_id_fkey,
  add constraint firm_members_firm_id_team_id_fkey foreign key (firm_id, team_id)
    references public.groups (firm_id, id) on delete set null (team_id);

-- An assignment is to a person or to a team, never both.
alter table public.client_assignments drop constraint client_assignments_pkey,
  alter column user_id drop not null,
  add column team_id uuid,
  add constraint client_assignments_one check ((user_id is null) <> (team_id is null)),
  add constraint client_assignments_firm_id_team_id_fkey foreign key (firm_id, team_id)
    references public.groups (firm_id, id) on delete cascade;
create unique index client_assignments_person on public.client_assignments (client_id, user_id) where user_id is not null;
create unique index client_assignments_team on public.client_assignments (client_id, team_id) where team_id is not null;

create or replace function public.can_access_client(target_firm uuid, client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.member_role(target_firm) in ('owner', 'partner'), false)
    or (public.member_role(target_firm) is not null
        and ((select f.settings ->> 'client_visibility' from public.firms f where f.id = target_firm) is distinct from 'restricted'
             or exists (select 1 from public.client_assignments a
                        where a.client_id = client
                          and (a.user_id = (select auth.uid())
                               or a.team_id = (select m.team_id from public.firm_members m
                                               where m.firm_id = target_firm and m.user_id = (select auth.uid()))))))
$$;

-- The shared log trigger now takes the entity type as a third argument (default client).
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
begin
  -- Deleting a whole firm removes everything in it; that is not a change to log.
  if not exists (select 1 from public.firms where id = (row ->> 'firm_id')::uuid) then
    return null;
  end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values ((row ->> 'firm_id')::uuid, (select auth.uid()),
    tg_argv[0] || case tg_op when 'INSERT' then '.added' when 'DELETE' then '.removed' else '.changed' end,
    coalesce(tg_argv[2], 'client'), (row ->> tg_argv[1])::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('changed',
      (select jsonb_agg(key) from jsonb_each(to_jsonb(new)) n where n.value is distinct from to_jsonb(old) -> n.key))
    else jsonb_strip_nulls(jsonb_build_object('kind', row ->> 'kind')) end);
  return null;
end;
$$;
create trigger groups_logged after insert or update or delete on public.groups
  for each row execute function public.log_change('group', 'id', 'group');
create trigger member_team_logged after update of team_id on public.firm_members
  for each row execute function public.log_change('member', 'user_id', 'member');

-- The firm's people now come with their team.
drop function public.firm_people(uuid);
create function public.firm_people(target_firm uuid)
returns table (user_id uuid, email text, role text, status text, team_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.status, m.team_id
  from public.firm_members m join auth.users u on u.id = m.user_id
  where m.firm_id = target_firm and public.member_role(target_firm) is not null
  order by m.status, u.email
$$;
revoke all on function public.firm_people(uuid) from public, anon, authenticated, service_role;
grant execute on function public.firm_people(uuid) to authenticated;
