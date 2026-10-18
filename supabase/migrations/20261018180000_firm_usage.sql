-- M4 step 13: the owner's two meters (PLAN.md 5.14), as information only until plans are
-- built and the sizes measured (plan_formula.fit_enforced stays off). Returns: the returns
-- in the firm's calendar for this financial year (April to March, India time). InboxCA
-- storage: the size of what InboxCA keeps for the firm, measured as held now: client
-- records, due dates, file records and their search tokens, email records and requests.
-- The activity log and jobs are not counted.
create function public.firm_usage(target_firm uuid)
returns table (returns_this_year int, workspace_bytes bigint)
language sql stable security definer set search_path = '' as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date as d),
  year as (
    select make_date(extract(year from d)::int - case when extract(month from d) < 4 then 1 else 0 end, 4, 1) as starts from today
  )
  select
    (select count(*)::int from public.tasks t, year
      where t.firm_id = target_firm and t.due_on >= year.starts and t.due_on < (year.starts + interval '1 year')::date),
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
revoke all on function public.firm_usage(uuid) from public, anon;
grant execute on function public.firm_usage(uuid) to authenticated;
