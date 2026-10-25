-- M4 (PLAN.md 5.14): the meter counts what was added, not what is held. Each return is
-- written to the ledger once, when its task enters the calendar, and stays when the task is
-- deleted (a service removed, a client deleted); planned again later, it is not added twice.
-- The first import's papers stay outside InboxCA storage: they are the documents an import
-- request moved (PLAN.md 5.16), and the import's own plan is left out with them.
create table if not exists public.usage_ledger (
  firm_id uuid not null references public.firms (id) on delete cascade,
  due_on date not null,
  registration_id uuid,
  code text,
  period_key text,
  unique (registration_id, code, period_key)
);
create index if not exists usage_ledger_due on public.usage_ledger (firm_id, due_on);
alter table public.usage_ledger enable row level security;
revoke all on public.usage_ledger from anon, authenticated;

create or replace function private.count_returns() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.usage_ledger (firm_id, due_on, registration_id, code, period_key)
    select firm_id, due_on, registration_id, code, period_key from added where kind = 'compliance' on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists tasks_counted on public.tasks;
create trigger tasks_counted after insert on public.tasks
  referencing new table as added for each statement execute function private.count_returns();

insert into public.usage_ledger (firm_id, due_on, registration_id, code, period_key)
  select firm_id, due_on, registration_id, code, period_key from public.tasks where kind = 'compliance' on conflict do nothing;

create or replace function public.firm_usage(target_firm uuid, today date default (now() at time zone 'Asia/Kolkata')::date)
returns table (returns_this_year int, workspace_bytes bigint, returns_so_far int, workspace_by_march bigint)
language sql stable security definer set search_path = '' as $$
  with year as (
    select make_date(extract(year from today)::int - case when extract(month from today) < 4 then 1 else 0 end, 4, 1) as starts
  ),
  counted as (
    select count(*)::int as whole, count(*) filter (where t.due_on <= today)::int as so_far from public.usage_ledger t, year
      where t.firm_id = target_firm and t.due_on >= year.starts and t.due_on < (year.starts + interval '1 year')::date
  ),
  kept as (
    select coalesce(sum(size), 0)::bigint as bytes, coalesce(sum(size) filter (where recent), 0)::bigint as month from (
      select pg_column_size(x.*) as size, false as recent from public.clients x where x.firm_id = target_firm
      union all select pg_column_size(x.*), false from public.client_registrations x where x.firm_id = target_firm
      union all select pg_column_size(x.*), false from public.contacts x where x.firm_id = target_firm
      union all select pg_column_size(x.*), false from public.tasks x where x.firm_id = target_firm
      union all select pg_column_size(x.*), x.received_at > today - 30 from public.documents x where x.firm_id = target_firm
        and x.id not in (select (m ->> 'document')::uuid from public.requests r, jsonb_array_elements(r.details -> 'moved') m
          where r.firm_id = target_firm and r.kind = 'import')
      union all select pg_column_size(x.*), x.received_at > today - 30 from public.email_events x where x.firm_id = target_firm
      union all select pg_column_size(x.*), false from public.requests x where x.firm_id = target_firm and x.kind <> 'import'
    ) rows
  )
  select counted.whole, kept.bytes, counted.so_far,
    kept.bytes + kept.month * ((year.starts + interval '1 year')::date - 1 - today) / 30
  from year, counted, kept
  where public.member_role(target_firm) = 'owner'
$$;
