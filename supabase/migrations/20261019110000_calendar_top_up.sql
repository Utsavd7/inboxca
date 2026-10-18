-- Queue the nightly calendar work one firm at a time, so one large firm cannot hold the
-- cron statement open for every other firm.
select cron.unschedule('calendar-top-up');

create function private.queue_calendar_top_ups() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  select f.id, 'calendar_top_up', 'firm', f.id,
    'calendar_top_up:' || f.id || ':' || (now() at time zone 'Asia/Kolkata')::date
  from public.firms f
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_calendar_top_ups() from public, anon, authenticated, service_role;

-- The worker calls this with one firm. The task rules are the same as plan_tasks, with
-- the firm predicate applied before its registrations are planned.
create function public.calendar_top_up(target_firm uuid, today date default (now() at time zone 'Asia/Kolkata')::date)
returns void language sql security definer set search_path = '' as $$
  insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on)
  select firm_id, client_id, registration_id, code, period_key, due_on from (
    select r.firm_id, r.client_id, r.id as registration_id, t.code, to_char(p.period_end, 'YYYY-MM') as period_key,
      coalesce((x.due_rule ->> 'on')::date, private.due_on(t.due_rule, p.period_end, r.state_code)) as due_on
    from public.client_registrations r
    join public.clients c on c.firm_id = r.firm_id and c.id = r.client_id and c.archived_at is null
    cross join unnest(r.services) s (code)
    join public.compliance_types t on t.code = s.code and t.period_key = ''
    cross join lateral (select (date_trunc('month', today::timestamp) + make_interval(months => n))::date as period_end from generate_series(-14, 12) n) p
    left join public.compliance_types x on x.code = t.code and x.period_key = to_char(p.period_end, 'YYYY-MM') and x.verified_on is not null
    where r.firm_id = target_firm
      and case
        when t.due_rule ? 'months' then t.due_rule -> 'months' @> to_jsonb(extract(month from p.period_end)::int)
        when t.frequency = 'quarterly' then extract(month from p.period_end) in (3, 6, 9, 12)
        when t.frequency = 'yearly' then extract(month from p.period_end) = 3
        else true end
      and p.period_end >= coalesce(t.effective_from, '-infinity') and p.period_end <= coalesce(t.effective_to, 'infinity')
  ) planned
  where due_on between today and today + interval '12 months'
  on conflict (firm_id, registration_id, code, period_key) do update set due_on = excluded.due_on
    where tasks.status <> 'filed' and tasks.due_on <> excluded.due_on
$$;
revoke all on function public.calendar_top_up(uuid, date) from public, anon, authenticated;
grant execute on function public.calendar_top_up(uuid, date) to service_role;

select cron.schedule('calendar-top-up', '0 19 * * *', 'select private.queue_calendar_top_ups()');
