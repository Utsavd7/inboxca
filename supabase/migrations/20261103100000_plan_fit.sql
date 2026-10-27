-- M11 (PLAN.md 5.14, D38 (4)): deleting a client record does not lower the year's InboxCA
-- storage. Client details, registrations, contacts, tasks and requests are measured as held, so
-- each delete keeps the bytes it took away in the ledger, dated that day, with no ref: one row
-- for the statement and firm. Not while the firm itself is being deleted.
create or replace function private.count_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.usage_ledger (firm_id, due_on, bytes)
    select g.firm_id, (now() at time zone 'Asia/Kolkata')::date, sum(pg_column_size(g.*)) from gone g
    where exists (select 1 from public.firms f where f.id = g.firm_id) and to_jsonb(g) ->> 'kind' is distinct from 'import'
    group by g.firm_id;
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['clients', 'client_registrations', 'contacts', 'tasks', 'requests'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_deleted_counted', t);
    execute format('create trigger %I after delete on public.%I referencing old table as gone for each statement execute function private.count_deleted()', t || '_deleted_counted', t);
  end loop;
end $$;

-- The owner's meters, as before; also for the server's daily billing run, which checks each
-- firm's plan fit (5.14). The bytes a delete kept are not growth, so the projection leaves them
-- out.
create or replace function public.firm_usage(target_firm uuid, today date default (now() at time zone 'Asia/Kolkata')::date)
returns table (returns_this_year int, workspace_bytes bigint, returns_so_far int, workspace_by_march bigint)
language sql stable security definer set search_path = '' as $$
  with year as (
    select make_date(extract(year from today)::int - case when extract(month from today) < 4 then 1 else 0 end, 4, 1) as starts
  ),
  counted as (
    select count(*) filter (where t.bytes is null)::int as whole, count(*) filter (where t.bytes is null and t.due_on <= today)::int as so_far,
      coalesce(sum(t.bytes), 0)::bigint as added, coalesce(sum(t.bytes) filter (where t.due_on >= today - 30 and t.ref is not null), 0)::bigint as month
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
  where public.member_role(target_firm) = 'owner' or public.is_orelu_admin() or (select auth.jwt() ->> 'role') = 'service_role'
$$;
