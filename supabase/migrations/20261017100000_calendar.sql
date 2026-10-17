-- M2 step 1: the compliance calendar (PLAN.md 5.1). Due dates are data: each rule in
-- compliance_types says which number it sits on and how its date follows the period. A
-- registration's services (codes) set which tasks it gets; private.plan_tasks makes the
-- next 12 months of tasks when services change and every night. A rule is verified only
-- with its official source, the day it was checked and the CA who approved it; tasks from
-- an unverified rule are shown as such and never send reminders (M5). A period's
-- government extension is a row with that period_key and applies only once verified.

create table public.compliance_types (
  code text not null check (code ~ '^[A-Z0-9_]{2,20}$'),
  period_key text not null default '' check (period_key = '' or period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  name text,
  frequency text check (frequency in ('monthly', 'quarterly', 'yearly')),
  -- for: the kind of number; after and day: the month after the period's last month and
  -- the day in it; except: other after/day by the period's last month; state_day: another
  -- day by GSTIN state; months: the only period months; one_of and scheme: services that
  -- exclude each other. An extension row holds only {"on": "<date>"}.
  due_rule jsonb not null,
  source_url text check (source_url ~ '^https://'),
  verified_on date,
  approved_by text,
  effective_from date,
  effective_to date,
  primary key (code, period_key),
  check (period_key <> '' or (name is not null and frequency is not null and due_rule ? 'for')),
  check ((verified_on is null) = (approved_by is null) and (verified_on is null or source_url is not null))
);
alter table public.compliance_types enable row level security;
revoke all on public.compliance_types from anon, authenticated;
grant select on public.compliance_types to authenticated;
create policy compliance_types_select on public.compliance_types for select to authenticated using (true);

-- The statutory defaults of PLAN.md 5.1, unverified: a CA checks each against the current
-- CBIC, CBDT and MCA notifications and records the source before any reminder is sent.
-- AOC-4 and MGT-7 follow the AGM date and arrive when that date is recorded.
insert into public.compliance_types (code, name, frequency, due_rule) values
  ('GSTR1_M', 'GSTR-1 (monthly)', 'monthly', '{"for": "gstin", "after": 1, "day": 11, "one_of": "gstr1", "scheme": "regular"}'),
  ('GSTR1_Q', 'GSTR-1 (QRMP)', 'quarterly', '{"for": "gstin", "after": 1, "day": 13, "one_of": "gstr1", "scheme": "regular"}'),
  ('GSTR3B_M', 'GSTR-3B (monthly)', 'monthly', '{"for": "gstin", "after": 1, "day": 20, "one_of": "gstr3b", "scheme": "regular"}'),
  ('GSTR3B_Q', 'GSTR-3B (QRMP)', 'quarterly', '{"for": "gstin", "after": 1, "day": 24, "one_of": "gstr3b", "scheme": "regular", "state_day": {"22": 22, "23": 22, "24": 22, "25": 22, "26": 22, "27": 22, "29": 22, "30": 22, "31": 22, "32": 22, "33": 22, "34": 22, "35": 22, "36": 22, "37": 22}}'),
  ('PMT06', 'GST payment (QRMP, months 1 and 2)', 'monthly', '{"for": "gstin", "after": 1, "day": 25, "months": [1, 2, 4, 5, 7, 8, 10, 11], "scheme": "regular"}'),
  ('CMP08', 'CMP-08 (composition)', 'quarterly', '{"for": "gstin", "after": 1, "day": 18, "scheme": "composition"}'),
  ('GSTR4', 'GSTR-4 (composition annual)', 'yearly', '{"for": "gstin", "after": 3, "day": 30, "scheme": "composition"}'),
  ('GSTR9', 'GSTR-9 / 9C annual', 'yearly', '{"for": "gstin", "after": 9, "day": 31, "scheme": "regular"}'),
  ('TDS_PAY', 'TDS/TCS payment', 'monthly', '{"for": "tan", "after": 1, "day": 7, "except": {"03": {"after": 1, "day": 30}}}'),
  ('TDS_RET', 'TDS returns 24Q/26Q', 'quarterly', '{"for": "tan", "after": 1, "day": 31, "except": {"03": {"after": 2, "day": 31}}}'),
  ('ADV_TAX', 'Advance tax instalment', 'quarterly', '{"for": "pan", "after": 0, "day": 15}'),
  ('ITR_NA', 'ITR (non-audit)', 'yearly', '{"for": "pan", "after": 4, "day": 31, "one_of": "itr"}'),
  ('TAX_AUDIT', 'Tax audit report', 'yearly', '{"for": "pan", "after": 6, "day": 30}'),
  ('ITR_AUDIT', 'ITR (audit cases)', 'yearly', '{"for": "pan", "after": 7, "day": 31, "one_of": "itr"}'),
  ('DIR3KYC', 'DIR-3 KYC', 'yearly', '{"for": "pan", "after": 6, "day": 30}'),
  ('LLP11', 'LLP Form 11', 'yearly', '{"for": "llpin", "after": 2, "day": 30}'),
  ('LLP8', 'LLP Form 8', 'yearly', '{"for": "llpin", "after": 7, "day": 30}');

-- Services sit on a number; the calendar's tasks point at it.
alter table public.client_registrations add column services text[] not null default '{}',
  add unique (firm_id, id);
grant update (services) on public.client_registrations to authenticated;
create policy registrations_update on public.client_registrations for update to authenticated
  using (public.member_role(firm_id) in ('owner', 'partner', 'manager'))
  with check (public.member_role(firm_id) in ('owner', 'partner', 'manager'));

-- Notices, review deadlines and work requests join this table with their milestones.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  registration_id uuid,
  kind text not null default 'compliance' check (kind in ('compliance')),
  code text,
  period_key text,
  due_on date not null,
  status text not null default 'upcoming' check (status in ('upcoming', 'in_progress', 'filed')),
  -- Filing: filed_on and the acknowledgement number.
  details jsonb not null default '{}',
  foreign key (firm_id, client_id) references public.clients (firm_id, id) on delete cascade,
  foreign key (firm_id, registration_id) references public.client_registrations (firm_id, id) on delete cascade,
  unique (firm_id, registration_id, code, period_key),
  check (status <> 'filed' or details ? 'filed_on')
);
create index tasks_due on public.tasks (firm_id, due_on) where status <> 'filed';
create index tasks_client on public.tasks (firm_id, client_id);
alter table public.tasks enable row level security;
revoke all on public.tasks from anon, authenticated;
grant select, update (status, details) on public.tasks to authenticated;
-- Tasks follow the client's visibility; every member may mark one in progress or filed
-- (the filing work itself, 5.17.2).
create policy tasks_select on public.tasks for select to authenticated
  using (public.can_access_client(firm_id, client_id));
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_access_client(firm_id, client_id))
  with check (public.can_access_client(firm_id, client_id));
create trigger tasks_logged after update on public.tasks
  for each row execute function public.log_change('task', 'id', 'task');

-- The due date of one period: the rule, with its exception for that month merged in.
create function private.due_on(rule jsonb, period_end date, state text) returns date
language sql immutable set search_path = '' as $$
  select least((start + interval '1 month - 1 day')::date, start + coalesce((r -> 'state_day' ->> state)::int, (r ->> 'day')::int) - 1)
  from (select rule || coalesce(rule -> 'except' -> to_char(period_end, 'MM'), '{}') as r) merged,
    lateral (select (date_trunc('month', period_end::timestamp) + make_interval(months => (r ->> 'after')::int))::date as start) s
$$;

-- Tasks due from today to 12 months ahead, for one registration or all; a task not yet
-- filed follows a changed rule. Archived clients get no new tasks.
create function private.plan_tasks(registration uuid default null, today date default (now() at time zone 'Asia/Kolkata')::date)
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
    where (registration is null or r.id = registration)
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

-- Services must sit on their kind of number and not exclude each other. Removing one
-- drops its tasks not yet started; filed ones stay.
create function private.services_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.services) s (code)
      left join public.compliance_types t on t.code = s.code and t.period_key = ''
      where t.code is null or t.due_rule ->> 'for' <> new.kind)
    or exists (select 1 from unnest(new.services) s (code)
      join public.compliance_types t on t.code = s.code and t.period_key = ''
      group by t.due_rule ->> 'one_of' having t.due_rule ->> 'one_of' is not null and count(*) > 1)
    or (select count(distinct t.due_rule ->> 'scheme') from unnest(new.services) s (code)
      join public.compliance_types t on t.code = s.code and t.period_key = '') > 1 then
    raise exception 'These services do not fit this number.' using errcode = '23514';
  end if;
  delete from public.tasks where registration_id = new.id and status = 'upcoming' and code <> all (new.services);
  perform private.plan_tasks(new.id);
  return null;
end;
$$;
create trigger registration_services after update of services on public.client_registrations
  for each row when (old.services is distinct from new.services) execute function private.services_changed();
create trigger registration_services_logged after update of services on public.client_registrations
  for each row execute function public.log_change('registration', 'client_id');

-- Every night at 00:30 India time the calendar is topped up to 12 months ahead.
select cron.schedule('calendar-top-up', '0 19 * * *', 'select private.plan_tasks()');
