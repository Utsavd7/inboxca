-- M1 step 5: client assignment and restricted visibility (PLAN.md 5.9). By default every
-- member sees every client (firms.settings ->> 'client_visibility' = 'open'). A firm can
-- choose 'restricted': then the owner and partners see every client, and everyone else
-- only the clients they are assigned to. Enforced here, in row level security, through one
-- function. Assignments to a whole team come with teams.

create table public.client_assignments (
  firm_id uuid not null,
  client_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('partner_in_charge', 'manager', 'staff')),
  primary key (client_id, user_id),
  foreign key (firm_id, client_id) references public.clients (firm_id, id) on delete cascade,
  foreign key (firm_id, user_id) references public.firm_members (firm_id, user_id) on delete cascade
);
create index client_assignments_user on public.client_assignments (firm_id, user_id);

create function public.can_access_client(target_firm uuid, client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.member_role(target_firm) in ('owner', 'partner'), false)
    or (public.member_role(target_firm) is not null
        and ((select f.settings ->> 'client_visibility' from public.firms f where f.id = target_firm) is distinct from 'restricted'
             or exists (select 1 from public.client_assignments a
                        where a.client_id = client and a.user_id = (select auth.uid()))))
$$;

drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (public.can_access_client(firm_id, id));
drop policy registrations_select on public.client_registrations;
create policy registrations_select on public.client_registrations for select to authenticated
  using (public.can_access_client(firm_id, client_id));

-- Members see the assignments of the clients they see; the owner, partners and managers
-- assign and unassign. The client log trigger records each change.
alter table public.client_assignments enable row level security;
revoke all on public.client_assignments from anon, authenticated;
grant select, insert, delete on public.client_assignments to authenticated;
create policy assignments_select on public.client_assignments for select to authenticated
  using (public.can_access_client(firm_id, client_id));
create policy assignments_insert on public.client_assignments for insert to authenticated
  with check (public.member_role(firm_id) in ('owner', 'partner', 'manager'));
create policy assignments_delete on public.client_assignments for delete to authenticated
  using (public.member_role(firm_id) in ('owner', 'partner', 'manager'));
create trigger client_assignments_logged after insert or delete on public.client_assignments
  for each row execute function public.log_change('assignment', 'client_id');
