-- Today's cards. Late returns, one row a client: how many are late and the first of them, for
-- the same people late_returns tells (the client's partner in charge, or the owner when there
-- is none). Runs as the person asking, so row level security applies as well.
create or replace function public.late_clients(target_firm uuid)
returns table(client_id uuid, client_name text, returns int, code text, period_key text, due_on date)
language sql stable set search_path = '' as $$
  with partners as (
    select a.client_id,m.user_id from public.client_assignments a join public.firm_members m on m.firm_id=a.firm_id
      and (a.user_id=m.user_id or a.team_id=m.team_id)
    where a.firm_id=target_firm and a.role='partner_in_charge' and m.role='partner' and m.status='active'
  ) select c.id,c.name,count(*)::int,(array_agg(t.code order by t.due_on,t.id))[1],
    (array_agg(t.period_key order by t.due_on,t.id))[1],min(t.due_on)
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  join public.firm_members m on m.firm_id=t.firm_id and m.user_id=(select auth.uid())
  where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and c.archived_at is null
    and t.due_on < (now() at time zone 'Asia/Kolkata')::date
    and (exists(select 1 from partners p where p.client_id=t.client_id and p.user_id=m.user_id)
      or (m.role='owner' and not exists(select 1 from partners p where p.client_id=t.client_id)))
  group by c.id,c.name
  order by min(t.due_on),c.name
$$;
revoke all on function public.late_clients(uuid) from public,anon;
grant execute on function public.late_clients(uuid) to authenticated;

-- Returns due in the next 7 days, one row a form and day, with how many clients and how many
-- are filed. Row level security keeps it to the clients this person may see.
create or replace function public.due_soon(target_firm uuid)
returns table(due_on date, code text, clients int, filed int)
language sql stable set search_path = '' as $$
  select t.due_on,t.code,count(*)::int,count(*) filter (where t.status='filed')::int
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null
  where t.firm_id=target_firm and t.kind='compliance'
    and t.due_on between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date+7
  group by t.due_on,t.code
  order by t.due_on,count(*) desc,t.code
$$;
revoke all on function public.due_soon(uuid) from public,anon;
grant execute on function public.due_soon(uuid) to authenticated;
