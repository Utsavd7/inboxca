-- M11: the rest of Orelu's admin console (PLAN.md 5.1, 5.8, 5.17, D42). One firm's health;
-- the firms a change to an official source touches; a CA's check of a due date rule, which
-- clears the calendar's * for everyone, and a government extension entered for a CA to check;
-- the fixed connection suggestion's thresholds and the office changes behind them; and
-- support sessions, which a firm's owner approves for an hour and sees in Settings.

-- A retried job is logged as Orelu's own work.
create or replace function public.admin_retry_job(job_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  update public.jobs set state = 'pending', run_at = now(), attempts = 0, claimed_until = null
  where id = job_id and state = 'failed';
  if not found then return false; end if;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.job_retried', 'job', jsonb_build_object('job', job_id));
  return true;
end;
$$;

-- One firm: its health, connected accounts, failed jobs and support session. No client data.
create or replace function public.admin_firm(target uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'name', f.name, 'status', f.status, 'created_at', f.created_at,
    'members', (select count(*) from public.firm_members m where m.firm_id = f.id and m.status = 'active'),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'provider', a.provider, 'status', a.status,
        'failures', coalesce((a.settings #>> '{mail_failures,read}')::int, 0) + coalesce((a.settings #>> '{mail_failures,send}')::int, 0),
        'last_run', (select max(j.run_at) from public.jobs j where j.entity_type = 'account' and j.entity_id = a.id and j.state = 'done'),
        'last_error', (select j.last_error_code from public.jobs j where j.entity_type = 'account' and j.entity_id = a.id order by j.run_at desc limit 1))
        order by a.kind), '[]') from public.connected_accounts a where a.firm_id = f.id),
    'failed', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'error', j.last_error_code, 'attempts', j.attempts, 'at', j.run_at)
        order by j.run_at desc), '[]') from (select * from public.jobs j where j.firm_id = f.id and j.state = 'failed' order by j.run_at desc limit 50) j),
    'support', (select jsonb_build_object('status', r.status, 'expires_at', r.expires_at, 'mine', r.details ->> 'orelu_user' = (select auth.uid())::text)
        from public.requests r where r.kind = 'support_access' and r.entity_type = 'firm' and r.entity_id = f.id))
  from public.firms f where f.id = target);
end;
$$;

-- The owner's meters (M4), now also for an Orelu admin: returns and InboxCA storage this year.
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
  where public.member_role(target_firm) = 'owner' or public.is_orelu_admin()
$$;

-- The firms with returns not yet filed under these rules (for one period, and not already on
-- that date, for an extension): what a changed form or date touches.
create or replace function public.admin_reach(codes text[], period text default null, moved_to date default null)
returns table (firm text, returns int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select f.name, count(*)::int
  from public.tasks t join public.firms f on f.id = t.firm_id
  where t.kind = 'compliance' and t.status <> 'filed' and t.code = any (codes)
    and (period is null or t.period_key = period) and (moved_to is null or t.due_on <> moved_to)
  group by f.name
  order by count(*) desc, f.name;
end;
$$;

-- A CA checked a rule against its official notification (PLAN.md 5.1): it is marked verified
-- for every firm, and a checked extension moves its period's returns not yet filed.
create or replace function public.admin_verify_rule(rule_code text, rule_period text, link text, checked_by text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  if length(btrim(coalesce(checked_by, ''))) not between 2 and 120 then raise exception 'Name the CA who checked it' using errcode = '22023'; end if;
  update public.compliance_types set source_url = btrim(link), verified_on = (now() at time zone 'Asia/Kolkata')::date, approved_by = btrim(checked_by)
  where code = rule_code and period_key = rule_period and verified_on is null;
  if not found then return false; end if;
  if rule_period <> '' then
    update public.tasks t set due_on = (x.due_rule ->> 'on')::date
    from public.compliance_types x
    where x.code = rule_code and x.period_key = rule_period and t.kind = 'compliance' and t.code = rule_code
      and t.period_key = rule_period and t.status <> 'filed' and t.due_on <> (x.due_rule ->> 'on')::date;
  end if;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.rule_verified', 'rule', jsonb_build_object('code', rule_code, 'period', rule_period, 'by', btrim(checked_by)));
  return true;
end;
$$;

-- A government extension for one period, waiting for a CA's check. Entered again (extended
-- once more), it waits again; until it is checked the dates it would move stay as they are.
create or replace function public.admin_add_extension(rule_code text, rule_period text, new_date date, link text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  if not exists (select 1 from public.compliance_types where code = rule_code and period_key = '') or coalesce(rule_period, '') = '' then return false; end if;
  insert into public.compliance_types (code, period_key, due_rule, source_url)
  values (rule_code, rule_period, jsonb_build_object('on', new_date), btrim(link))
  on conflict (code, period_key) do update set due_rule = excluded.due_rule, source_url = excluded.source_url, verified_on = null, approved_by = null;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.extension_added', 'rule', jsonb_build_object('code', rule_code, 'period', rule_period, 'on', new_date));
  return true;
end;
$$;

-- The fixed connection suggestion (PLAN.md 5.8): after how many office confirmations in how
-- many days. Kept in platform_settings (key 'office'); the app falls back to 3 in 14 days.
create or replace function public.admin_set_office(taps int, days int) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  if taps not between 1 and 50 or days not between 1 and 90 then raise exception 'Choose 1 to 50 confirmations in 1 to 90 days' using errcode = '22023'; end if;
  insert into public.platform_settings (key, value) values ('office', jsonb_build_object('fixed_taps', taps, 'fixed_days', days))
  on conflict (key) do update set value = public.platform_settings.value || excluded.value;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.office_thresholds', 'platform', jsonb_build_object('taps', taps, 'days', days));
  return true;
end;
$$;

-- Each firm with the Office only switch on, over the last `days`: the confirmations people had
-- to tap, every change of office connection (those taps and the ones a trusted PC learned), and
-- the internet provider the host named for its newest connection, if the host names one.
create or replace function public.admin_office(days int)
returns table (firm text, provider text, fixed boolean, declined boolean, taps int, changes int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select f.name,
    (select l ->> 'provider' from jsonb_array_elements(coalesce(f.settings #> '{office,lines}', '[]')) l order by l ->> 'seen_on' desc nulls last limit 1),
    exists (select 1 from jsonb_array_elements(coalesce(f.settings #> '{office,lines}', '[]')) l where (l ->> 'fixed')::boolean),
    coalesce((f.settings #>> '{office,fixed_declined}')::boolean, false),
    count(*) filter (where a.action in ('office.here', 'office.confirm', 'office.today'))::int,
    count(a.action)::int
  from public.firms f
  left join public.activity_log a on a.firm_id = f.id and a.at > now() - make_interval(days => days)
    and a.action in ('office.here', 'office.confirm', 'office.today', 'office.learned')
  where coalesce((f.settings #>> '{office,on}')::boolean, false)
  group by f.id
  order by count(a.action) desc, f.name;
end;
$$;

-- Support sessions (PLAN.md 8.5): Orelu staff see no firm's content unless its owner approves
-- an hour's look. One request per firm, asked again after it ends; every step is in the firm's
-- own activity log, which its owner reads.
do $$
declare
  kinds text := pg_get_constraintdef((select oid from pg_constraint where conname = 'requests_kind_check'));
begin
  if kinds not like '%support_access%' then
    alter table public.requests drop constraint requests_kind_check;
    execute 'alter table public.requests add constraint requests_kind_check ' || replace(kinds, ']))', ', ''support_access''::text]))');
  end if;
end;
$$;

create or replace function public.admin_ask_support(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  insert into public.requests (firm_id, kind, entity_type, entity_id, status, details)
  select f.id, 'support_access', 'firm', f.id, 'pending', jsonb_build_object('orelu_user', (select auth.uid()), 'asked_at', now())
  from public.firms f where f.id = target and f.status <> 'closed'
  on conflict (kind, entity_type, entity_id) do update set status = 'pending', expires_at = null, details = excluded.details
    where requests.status <> 'pending' and (requests.status <> 'approved' or requests.expires_at <= now());
  if not found then return false; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
  values (target, (select auth.uid()), 'support.asked', 'firm', target);
  return true;
end;
$$;

-- The firm's owner approves an hour, refuses, or ends a session early.
create or replace function public.answer_support(target uuid, decision text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if public.member_role(target) is distinct from 'owner' then raise exception 'Only the owner decides' using errcode = '42501'; end if;
  update public.requests set
    status = case decision when 'approve' then 'approved' when 'refuse' then 'refused' else 'done' end,
    expires_at = case when decision = 'approve' then now() + interval '1 hour' else expires_at end,
    details = details || case when decision = 'approve' then jsonb_build_object('started_at', now()) else '{}' end
  where kind = 'support_access' and entity_type = 'firm' and entity_id = target and firm_id = target
    and case decision when 'end' then status = 'approved' and expires_at > now() when 'approve' then status = 'pending' when 'refuse' then status = 'pending' else false end;
  if not found then return false; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
  values (target, (select auth.uid()), 'support.' || case decision when 'approve' then 'approved' when 'refuse' then 'refused' else 'ended' end, 'firm', target);
  return true;
end;
$$;

-- What the admin who asked sees while the hour lasts: the firm's people and client names, and
-- each look is logged in the firm's activity log.
create or replace function public.admin_support_view(target uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  until timestamptz;
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  select r.expires_at into until from public.requests r
  where r.kind = 'support_access' and r.entity_type = 'firm' and r.entity_id = target and r.status = 'approved'
    and r.expires_at > now() and r.details ->> 'orelu_user' = (select auth.uid())::text;
  if until is null then return null; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
  values (target, (select auth.uid()), 'support.viewed', 'firm', target);
  return jsonb_build_object('until', until,
    'people', (select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'role', m.role, 'status', m.status) order by m.role, u.email), '[]')
      from public.firm_members m join auth.users u on u.id = m.user_id where m.firm_id = target),
    'clients', (select count(*) from public.clients c where c.firm_id = target and c.archived_at is null),
    'names', (select coalesce(jsonb_agg(c.name order by c.name), '[]') from (select c.name from public.clients c
      where c.firm_id = target and c.archived_at is null order by c.name limit 200) c));
end;
$$;

revoke all on function public.admin_firm(uuid), public.admin_reach(text[], text, date), public.admin_verify_rule(text, text, text, text),
  public.admin_add_extension(text, text, date, text), public.admin_set_office(int, int), public.admin_office(int),
  public.admin_ask_support(uuid), public.answer_support(uuid, text), public.admin_support_view(uuid) from public, anon;
grant execute on function public.admin_firm(uuid), public.admin_reach(text[], text, date), public.admin_verify_rule(text, text, text, text),
  public.admin_add_extension(text, text, date, text), public.admin_set_office(int, int), public.admin_office(int),
  public.admin_ask_support(uuid), public.answer_support(uuid, text), public.admin_support_view(uuid) to authenticated;
