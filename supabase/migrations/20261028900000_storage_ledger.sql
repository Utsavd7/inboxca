-- M4 (PLAN.md 5.14): InboxCA storage counts what was added in the year, not what is held.
-- Each paper and email record adds its bytes to the ledger once, on the day it arrives
-- (due_on), and stays when it is deleted. Returns rows keep bytes null. The first import's
-- papers are entered at 0 bytes before they arrive (src/jobs/import-files.ts), so they stay
-- outside. Client details and records, edited in place, are still measured as held.
alter table public.usage_ledger add column if not exists bytes bigint, add column if not exists ref uuid unique;

create or replace function private.count_bytes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.usage_ledger (firm_id, due_on, bytes, ref)
    select a.firm_id, (a.received_at at time zone 'Asia/Kolkata')::date, pg_column_size(a.*), a.id from added a on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists documents_counted on public.documents;
create trigger documents_counted after insert on public.documents
  referencing new table as added for each statement execute function private.count_bytes();
drop trigger if exists email_events_counted on public.email_events;
create trigger email_events_counted after insert on public.email_events
  referencing new table as added for each statement execute function private.count_bytes();

insert into public.usage_ledger (firm_id, due_on, bytes, ref)
  select x.firm_id, (x.received_at at time zone 'Asia/Kolkata')::date, pg_column_size(x.*), x.id from public.documents x
    where x.id not in (select (m ->> 'document')::uuid from public.requests r, jsonb_array_elements(r.details -> 'moved') m where r.kind = 'import')
  union all
  select x.firm_id, (x.received_at at time zone 'Asia/Kolkata')::date, pg_column_size(x.*), x.id from public.email_events x
  on conflict do nothing;

create or replace function public.firm_usage(target_firm uuid, today date default (now() at time zone 'Asia/Kolkata')::date)
returns table (returns_this_year int, workspace_bytes bigint, returns_so_far int, workspace_by_march bigint)
language sql stable security definer set search_path = '' as $$
  with year as (
    select make_date(extract(year from today)::int - case when extract(month from today) < 4 then 1 else 0 end, 4, 1) as starts
  ),
  counted as (
    select count(*) filter (where t.bytes is null)::int as whole, count(*) filter (where t.bytes is null and t.due_on <= today)::int as so_far,
      coalesce(sum(t.bytes), 0)::bigint as added, coalesce(sum(t.bytes) filter (where t.due_on >= today - 30), 0)::bigint as month
    from public.usage_ledger t, year
      where t.firm_id = target_firm and t.due_on >= year.starts and t.due_on < (year.starts + interval '1 year')::date
  ),
  kept as (
    select coalesce(sum(size), 0)::bigint as bytes from (
      select pg_column_size(x.*) as size from public.clients x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.client_registrations x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.contacts x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.tasks x where x.firm_id = target_firm
      union all select pg_column_size(x.*) from public.requests x where x.firm_id = target_firm and x.kind <> 'import'
    ) rows
  )
  select counted.whole, kept.bytes + counted.added, counted.so_far,
    kept.bytes + counted.added + counted.month * ((year.starts + interval '1 year')::date - 1 - today) / 30
  from year, counted, kept
  where public.member_role(target_firm) = 'owner'
$$;
