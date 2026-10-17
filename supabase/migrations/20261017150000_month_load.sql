-- The Home page's month ribbon: for each day of a month, how many returns fall due, how
-- many are filed, and which returns they are. It runs as the person asking (security
-- invoker), so row level security keeps it to the clients they may see; counts are made
-- in the database, so a firm of 1,000 clients sends 31 rows, not thousands.
create function public.month_load(first_day date)
returns table (due_on date, due int, filed int, codes text[])
language sql stable set search_path = '' as $$
  select t.due_on, count(*)::int, count(*) filter (where t.status = 'filed')::int, array_agg(distinct t.code order by t.code)
  from public.tasks t
  join public.clients c on c.firm_id = t.firm_id and c.id = t.client_id and c.archived_at is null
  where t.due_on >= first_day and t.due_on < (first_day + interval '1 month')::date
  group by t.due_on
  order by t.due_on
$$;
revoke all on function public.month_load(date) from public, anon;
grant execute on function public.month_load(date) to authenticated;
