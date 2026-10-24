-- Today's Late returns card shows everyone the late returns of the clients they can see. Row
-- level security limits that (restricted members see their assigned clients); the partner in
-- charge rule stays only for alerts (late_returns).
create or replace function public.late_clients(target_firm uuid)
returns table(client_id uuid, client_name text, returns int, code text, period_key text, due_on date)
language sql stable set search_path = '' as $$
  select c.id,c.name,count(*)::int,(array_agg(t.code order by t.due_on,t.id))[1],
    (array_agg(t.period_key order by t.due_on,t.id))[1],min(t.due_on)
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and c.archived_at is null
    and t.due_on < (now() at time zone 'Asia/Kolkata')::date
  group by c.id,c.name
  order by min(t.due_on),c.name
$$;
