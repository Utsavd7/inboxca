-- The Calendar's days between two dates, for one form or all: how many returns are still to
-- file on each (the strip's bars), how many of those are in progress, and how many are filed
-- (the month grid's dots). Every day with a return is listed, filed or not. Runs as the person
-- asking, so row level security keeps it to the clients they may see.
drop function if exists public.calendar_days(uuid, date, date, text);
create function public.calendar_days(target_firm uuid, first_day date, last_day date, only_code text default null)
returns table(due_on date, returns int, working int, filed int)
language sql stable set search_path = '' as $$
  select t.due_on,
    (count(*) filter (where t.status<>'filed'))::int,
    (count(*) filter (where t.status='in_progress'))::int,
    (count(*) filter (where t.status='filed'))::int
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null
  where t.firm_id=target_firm and t.kind='compliance' and t.due_on between first_day and last_day
    and (only_code is null or t.code=only_code)
  group by t.due_on
  order by t.due_on
$$;
revoke all on function public.calendar_days(uuid, date, date, text) from public,anon;
grant execute on function public.calendar_days(uuid, date, date, text) to authenticated;
