-- The Calendar's strip of days: how many returns are still to file on each day between two
-- dates, for one form or all. Runs as the person asking, so row level security keeps it to
-- the clients they may see.
create or replace function public.calendar_days(target_firm uuid, first_day date, last_day date, only_code text default null)
returns table(due_on date, returns int)
language sql stable set search_path = '' as $$
  select t.due_on,count(*)::int
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null
  where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and t.due_on between first_day and last_day
    and (only_code is null or t.code=only_code)
  group by t.due_on
  order by t.due_on
$$;
revoke all on function public.calendar_days(uuid, date, date, text) from public,anon;
grant execute on function public.calendar_days(uuid, date, date, text) to authenticated;
