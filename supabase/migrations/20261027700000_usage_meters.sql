-- M4 (PLAN.md 5.14): the owner's two meters get a projection for the year, still as
-- information only (no plan or limit is stored yet). Returns: the year's calendar is known
-- from the day a client is added, so the meter shows those due so far against the whole
-- year's; a client added during the year counts from that day (the calendar is never
-- planned backwards) and an archived client's returns stay counted. InboxCA storage: what is
-- kept now, projected to the end of March at the last 30 days' pace of papers and email
-- records (the client list and its calendar are already there for the year). Today is a
-- parameter for tests.
drop function if exists public.firm_usage(uuid);
create or replace function public.firm_usage(target_firm uuid, today date default (now() at time zone 'Asia/Kolkata')::date)
returns table (returns_this_year int, workspace_bytes bigint, returns_so_far int, workspace_by_march bigint)
language sql stable security definer set search_path = '' as $$
  with year as (
    select make_date(extract(year from today)::int - case when extract(month from today) < 4 then 1 else 0 end, 4, 1) as starts
  ),
  counted as (
    select count(*)::int as whole, count(*) filter (where t.due_on <= today)::int as so_far from public.tasks t, year
      where t.firm_id = target_firm and t.kind = 'compliance' and t.due_on >= year.starts and t.due_on < (year.starts + interval '1 year')::date
  ),
  kept as (
    select coalesce(sum(size), 0)::bigint as bytes, coalesce(sum(size) filter (where recent), 0)::bigint as month from (
      select pg_column_size(x.*) as size, false as recent from public.clients x where x.firm_id = target_firm
      union all select pg_column_size(x.*), false from public.client_registrations x where x.firm_id = target_firm
      union all select pg_column_size(x.*), false from public.contacts x where x.firm_id = target_firm
      union all select pg_column_size(x.*), false from public.tasks x where x.firm_id = target_firm
      union all select pg_column_size(x.*), x.received_at > today - 30 from public.documents x where x.firm_id = target_firm
      union all select pg_column_size(x.*), x.received_at > today - 30 from public.email_events x where x.firm_id = target_firm
      union all select pg_column_size(x.*), false from public.requests x where x.firm_id = target_firm
    ) rows
  )
  select counted.whole, kept.bytes, counted.so_far,
    kept.bytes + kept.month * ((year.starts + interval '1 year')::date - 1 - today) / 30
  from year, counted, kept
  where public.member_role(target_firm) = 'owner'
$$;
revoke all on function public.firm_usage(uuid, date) from public, anon;
grant execute on function public.firm_usage(uuid, date) to authenticated;
