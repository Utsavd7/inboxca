-- Home's progress by return: for one month, each return with how many fall due and how
-- many are filed. Runs as the person asking, so row level security keeps it to the clients
-- they may see.
create function public.month_by_return(first_day date)
returns table (code text, due int, filed int)
language sql stable set search_path = '' as $$
  select t.code, count(*)::int, count(*) filter (where t.status = 'filed')::int
  from public.tasks t
  join public.clients c on c.firm_id = t.firm_id and c.id = t.client_id and c.archived_at is null
  where t.due_on >= first_day and t.due_on < (first_day + interval '1 month')::date
  group by t.code
  order by count(*) desc, t.code
$$;
revoke all on function public.month_by_return(date) from public, anon;
grant execute on function public.month_by_return(date) to authenticated;
