-- A client's number with filed returns stays: its returns cascade from it, so removing it
-- would delete the record of returns already filed. Turning its services off still stops new
-- returns. A client or firm deleted as a whole still takes its numbers and returns with it,
-- since a cascade is not held by row level security.
drop policy registrations_delete on public.client_registrations;
create policy registrations_delete on public.client_registrations for delete to authenticated
  using (
    public.member_role(firm_id) in ('owner', 'partner', 'manager')
    and not exists (
      select 1 from public.tasks
      where tasks.firm_id = client_registrations.firm_id and tasks.registration_id = client_registrations.id and tasks.status = 'filed'
    )
  );
