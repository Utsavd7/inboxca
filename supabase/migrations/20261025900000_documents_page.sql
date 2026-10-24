-- The firm's Documents page lists every paper newest first, 50 at a time. With 100,000
-- papers the first page sorted them all (56 ms); this index reads only the 50 (3 ms).
create index if not exists documents_firm_received on public.documents (firm_id, received_at desc);

-- assigned_clients() checked the person's role once per assignment: 1,000 assigned clients
-- cost 290 ms in every query a restricted member made. The same set, checked once per firm.
create or replace function public.assigned_clients() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with me as materialized (
    select m.firm_id, m.user_id, m.team_id from public.firm_members m
    where m.user_id = (select auth.uid()) and public.member_role(m.firm_id) is not null
  )
  select a.client_id from public.client_assignments a join me on me.firm_id = a.firm_id
  where a.user_id = me.user_id or a.team_id = me.team_id
$$;
