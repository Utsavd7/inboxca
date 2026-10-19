-- Review of M7 step 4: the requests policies keep the office rule (only the owner or a
-- deputy, after the 2 step code, sees an office connection alert, and nobody signed in
-- dismisses one), but go back to the once-a-query sets of 20261018240000, not a check per row.

-- Firms where the person may review office connections now.
create function public.review_firms() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.firm_id from public.firm_members m
  where m.user_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2' and private.office_approver(m.firm_id, m.user_id)
$$;
revoke all on function public.review_firms() from public, anon;
grant execute on function public.review_firms() to authenticated;

drop policy requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (firm_id in (select public.my_firms())
    and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()))
    and (entity_type <> 'office_connection' or firm_id in (select public.review_firms())));
drop policy requests_update on public.requests;
create policy requests_update on public.requests for update to authenticated
  using (entity_type <> 'office_connection' and firm_id in (select public.my_firms())
    and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients())))
  with check (entity_type <> 'office_connection' and firm_id in (select public.my_firms()));
