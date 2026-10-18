-- M5 step 4: the notice tracker (PLAN.md 5.6). A notice is a task of kind notice: its client,
-- and in details the authority, the notice type, the reference, the day it was received,
-- the action date once a person has confirmed it, a date the rules found to suggest, and
-- the email it came in. Until an action date is confirmed, due_on holds the firm's own
-- review deadline, which is never shown as the legal one. A notice is open, in progress,
-- replied or closed. Returns stay kind compliance; everything that counts returns counts
-- only them.
alter table public.tasks drop constraint tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('compliance', 'notice'));
alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (
  (kind = 'compliance' and status in ('upcoming', 'in_progress', 'filed')) or (kind = 'notice' and status in ('upcoming', 'in_progress', 'replied', 'closed'))
);
create index tasks_notices on public.tasks (firm_id, due_on) where kind = 'notice' and status in ('upcoming', 'in_progress');

create or replace function public.month_load(first_day date)
returns table (due_on date, due int, filed int, codes text[])
language sql stable set search_path = '' as $$
  select t.due_on, count(*)::int, count(*) filter (where t.status = 'filed')::int, array_agg(distinct t.code order by t.code)
  from public.tasks t
  join public.clients c on c.firm_id = t.firm_id and c.id = t.client_id and c.archived_at is null
  where t.kind = 'compliance' and t.due_on >= first_day and t.due_on < (first_day + interval '1 month')::date
  group by t.due_on
  order by t.due_on
$$;

create or replace function public.month_by_return(first_day date)
returns table (code text, due int, filed int)
language sql stable set search_path = '' as $$
  select t.code, count(*)::int, count(*) filter (where t.status = 'filed')::int
  from public.tasks t
  join public.clients c on c.firm_id = t.firm_id and c.id = t.client_id and c.archived_at is null
  where t.kind = 'compliance' and t.due_on >= first_day and t.due_on < (first_day + interval '1 month')::date
  group by t.code order by count(*) desc, t.code
$$;

-- The returns meter counts returns only.
create or replace function public.firm_usage(target_firm uuid)
returns table (returns_this_year int, workspace_bytes bigint)
language sql stable security definer set search_path = '' as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date as d),
  year as (
    select make_date(extract(year from d)::int - case when extract(month from d) < 4 then 1 else 0 end, 4, 1) as starts from today
  )
  select
    (select count(*)::int from public.tasks t, year
      where t.firm_id = target_firm and t.kind = 'compliance' and t.due_on >= year.starts and t.due_on < (year.starts + interval '1 year')::date),
    (select coalesce(sum(size), 0)::bigint from (
      select pg_column_size(x.*) as size from public.clients x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.client_registrations x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.contacts x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.tasks x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.documents x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.email_events x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.requests x where x.firm_id = target_firm
    ) kept)
  where public.member_role(target_firm) = 'owner'
$$;
