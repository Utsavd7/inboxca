-- M1 step 7: client groups (PLAN.md 5.9): a family or a business group, so related clients
-- are found together. A client belongs to at most one (clients.group_id, a group of kind
-- client_group); removing a group leaves its clients ungrouped.
alter table public.clients add column group_id uuid,
  add constraint clients_firm_id_group_id_fkey foreign key (firm_id, group_id)
    references public.groups (firm_id, id) on delete set null (group_id);
create index clients_group on public.clients (firm_id, group_id) where group_id is not null;
grant update (group_id) on public.clients to authenticated;

-- Whoever may change clients may also make a client group; teams and branches stay the
-- owner's.
drop policy groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated
  with check (public.member_role(firm_id) = 'owner'
              or (kind = 'client_group' and public.member_role(firm_id) in ('partner', 'manager')));
