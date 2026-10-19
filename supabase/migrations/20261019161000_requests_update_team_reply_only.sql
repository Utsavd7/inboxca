-- M7 step 5: people signed in may change a request only to mark a team reply done (the
-- Inbox's Done). Every other kind, permission requests above all, is changed by the server
-- after it checks who may answer, so nobody can approve their own request.
drop policy requests_update on public.requests;
create policy requests_update on public.requests for update to authenticated
  using (kind = 'team_reply' and firm_id in (select public.my_firms())
    and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients())))
  with check (kind = 'team_reply' and firm_id in (select public.my_firms()));
