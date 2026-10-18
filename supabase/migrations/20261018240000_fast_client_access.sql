-- The scale check (PLAN.md M11; PR #60): with 10,000 clients and 207,000 returns, Home and
-- the Calendar took 4 to 6 seconds, because every row's policy called can_access_client,
-- which works out the person's role in the firm again for each row. The rule stays exactly
-- the same, but it is worked out once a query as three small sets: the firms the person is
-- an active member of now, the firms whose every client they see (as owner or partner, or
-- because the firm's visibility is open), and the clients assigned to them or their team in
-- the others. A row then needs only a lookup in those sets.

-- Firms the person may use now (member_role covers status, the 2 step code, hours and session).
create function public.my_firms() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.firm_id from public.firm_members m
  where m.user_id = (select auth.uid()) and public.member_role(m.firm_id) is not null
$$;

-- Of those, the firms whose every client the person sees.
create function public.open_firms() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.firm_id from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.user_id = (select auth.uid())
    and public.member_role(m.firm_id) is not null
    and (public.member_role(m.firm_id) in ('owner', 'partner') or f.settings ->> 'client_visibility' is distinct from 'restricted')
$$;

-- In the other firms, the clients assigned to the person or to their team.
create function public.assigned_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select a.client_id from public.client_assignments a
  join public.firm_members m on m.firm_id = a.firm_id and m.user_id = (select auth.uid())
  where public.member_role(a.firm_id) is not null and (a.user_id = m.user_id or a.team_id = m.team_id)
$$;

revoke all on function public.my_firms(), public.open_firms(), public.assigned_clients() from public, anon;
grant execute on function public.my_firms(), public.open_firms(), public.assigned_clients() to authenticated;

-- can_access_client(firm, client), as one row's test against the sets.
drop policy clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (firm_id in (select public.open_firms()) or id in (select public.assigned_clients()));
drop policy registrations_select on public.client_registrations;
create policy registrations_select on public.client_registrations for select to authenticated
  using (firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()));
drop policy assignments_select on public.client_assignments;
create policy assignments_select on public.client_assignments for select to authenticated
  using (firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()));
drop policy contact_clients_select on public.contact_clients;
create policy contact_clients_select on public.contact_clients for select to authenticated
  using (firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()));
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()));
drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()))
  with check (firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()));
drop policy documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()));
drop policy shares_select on public.shares;
create policy shares_select on public.shares for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and (d.firm_id in (select public.open_firms()) or d.client_id in (select public.assigned_clients()))));

-- Mail and requests may have no client yet; then every member of the firm sees them.
drop policy email_events_select on public.email_events;
create policy email_events_select on public.email_events for select to authenticated
  using (firm_id in (select public.my_firms()) and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients())));
drop policy email_events_update on public.email_events;
create policy email_events_update on public.email_events for update to authenticated
  using (firm_id in (select public.my_firms()) and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients())))
  with check (decision_source = 'staff');
drop policy requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (firm_id in (select public.my_firms()) and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients())));
drop policy requests_update on public.requests;
create policy requests_update on public.requests for update to authenticated
  using (firm_id in (select public.my_firms()) and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients())))
  with check (firm_id in (select public.my_firms()));
