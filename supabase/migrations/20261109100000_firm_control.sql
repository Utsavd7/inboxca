-- Firm control over due dates and returns (PLAN.md 5.1, 5.2, 5.20):
-- 1. A firm's owner confirms a due date rule against its official notification for their firm
--    only; client reminders and the "what is due" answer then run for it. Orelu's own check in
--    /admin/due-dates stays and wins everywhere. Only a rule with an official link can be
--    confirmed, and only a default rule (an extension still waits for Orelu's CA).
-- 2. Who prepared, approved and filed a return, read by anyone who may see the client.
-- 3. Who is behind: open, late and asked work by person, for the owner, partners and a
--    manager's own team.
-- 4. ROC and tax audit rules for companies, unverified; the AGM date is asked, never guessed.

create table if not exists public.firm_due_dates (
  firm_id uuid not null references public.firms (id) on delete cascade,
  code text not null,
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  -- The link the owner saw and confirmed against, kept even if the rule's link changes later.
  source_url text not null check (source_url ~ '^https://'),
  primary key (firm_id, code)
);
alter table public.firm_due_dates enable row level security;
revoke all on public.firm_due_dates from anon, authenticated;
grant select on public.firm_due_dates to authenticated;
drop policy if exists firm_due_dates_select on public.firm_due_dates;
create policy firm_due_dates_select on public.firm_due_dates for select to authenticated using (public.member_role(firm_id) is not null);

-- The owner confirms a default rule's date, as the firm's professional, against the official
-- link the rule carries. Logged. False when the rule has no link, is checked already, or the
-- caller is not the owner.
create or replace function public.confirm_due_date(target_firm uuid, rule_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare link text;
begin
  if public.member_role(target_firm) is distinct from 'owner' then return false; end if;
  select source_url into link from public.compliance_types where code = rule_code and period_key = '' and source_url is not null and verified_on is null;
  if not found then return false; end if;
  insert into public.firm_due_dates (firm_id, code, confirmed_by, source_url) values (target_firm, rule_code, (select auth.uid()), link)
    on conflict do nothing;
  if not found then return false; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    values (target_firm, (select auth.uid()), 'due_date.confirmed', 'rule', target_firm, jsonb_build_object('code', rule_code, 'source_url', link));
  return true;
end;
$$;
revoke all on function public.confirm_due_date(uuid, text) from public, anon;
grant execute on function public.confirm_due_date(uuid, text) to authenticated;

-- Who prepared, approved and filed these returns (the log's form.* lines), for anyone who may
-- see the client. Only the owner reads the log itself.
create or replace function public.form_signoffs(target_firm uuid, docs uuid[])
returns table (document uuid, action text, actor_id uuid, at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.entity_id, l.action, l.actor_id, l.at
  from public.activity_log l
  join public.documents d on d.id = l.entity_id and d.firm_id = l.firm_id
  where l.firm_id = target_firm and l.entity_type = 'document' and l.entity_id = any (docs)
    and l.action in ('form.prepared', 'form.approved', 'form.rejected', 'form.filed')
    and public.member_role(target_firm) is not null
    and (target_firm in (select public.open_firms()) or d.client_id in (select public.assigned_clients()))
  order by l.at
$$;
revoke all on function public.form_signoffs(uuid, uuid[]) from public, anon;
grant execute on function public.form_signoffs(uuid, uuid[]) to authenticated;

-- Who is behind, by person: returns not filed, of them late, and clients still asked for
-- papers, on the clients each looks after by name or through their team. The owner and
-- partners see everyone; a manager their own team; others nobody.
create or replace function public.people_load(target_firm uuid)
returns table (user_id uuid, open int, late int, asks int)
language sql stable security definer set search_path = '' as $$
  with me as (
    select m.team_id, public.member_role(target_firm) as role from public.firm_members m where m.firm_id = target_firm and m.user_id = (select auth.uid())
  ), people as (
    select m.user_id, m.team_id from public.firm_members m, me
    where m.firm_id = target_firm and m.status = 'active'
      and (me.role in ('owner', 'partner') or me.role = 'manager' and m.team_id is not null and m.team_id = me.team_id)
  ), theirs as (
    select distinct p.user_id, a.client_id from people p
    join public.client_assignments a on a.firm_id = target_firm and (a.user_id = p.user_id or a.team_id is not null and a.team_id = p.team_id)
    join public.clients c on c.id = a.client_id and c.firm_id = target_firm and c.archived_at is null
  )
  select p.user_id,
    (select count(*)::int from theirs x join public.tasks t on t.firm_id = target_firm and t.client_id = x.client_id and t.kind = 'compliance' and t.status <> 'filed' where x.user_id = p.user_id),
    (select count(*)::int from theirs x join public.tasks t on t.firm_id = target_firm and t.client_id = x.client_id and t.kind = 'compliance' and t.status <> 'filed' and t.due_on < (now() at time zone 'Asia/Kolkata')::date where x.user_id = p.user_id),
    (select count(distinct r.client_id)::int from theirs x join public.requests r on r.firm_id = target_firm and r.client_id = x.client_id and r.kind = 'documents' and r.status = 'pending' and r.expires_at > now() where x.user_id = p.user_id)
  from people p
$$;
revoke all on function public.people_load(uuid) from public, anon;
grant execute on function public.people_load(uuid) to authenticated;

-- ROC filings for companies and the half year MSME-1. A rule with "from": "agm" has no fixed
-- date: private.due_on gives null for it, so the calendar makes no task until the AGM date is
-- recorded (record_agm below). Every rule is unverified: a CA checks each against the official
-- text (named here) in /admin/due-dates. Sources, not reachable by InboxCA's own fetch on
-- 2 Nov 2026 (MCA and India Code refused automated reads), so no link and no checked date:
--   AOC-4: Companies Act 2013, s.137(1) (financial statements, days after the AGM)
--   MGT-7: Companies Act 2013, s.92(4) (annual return, days after the AGM)
--   ADT-1: Companies Act 2013, s.139(1) and Companies (Audit and Auditors) Rules 2014, r.4(2)
--   DPT-3: Companies (Acceptance of Deposits) Rules 2014, r.16 (return of deposits, 30 June)
--   MSME-1: MCA order S.O. 368(E) of 22 Jan 2019 (half yearly return, April to September and
--           October to March)
-- The day counts after the AGM and the MSME-1 and DPT-3 dates below are the firm's to confirm;
-- they are not checked against the official text yet.
alter table public.compliance_types drop constraint if exists compliance_types_frequency_check;
alter table public.compliance_types add constraint compliance_types_frequency_check check (frequency in ('monthly', 'quarterly', 'half_yearly', 'yearly'));
insert into public.compliance_types (code, name, frequency, due_rule, client_kinds) values
  ('AOC4', 'AOC-4 (financial statements)', 'yearly', '{"for": "cin", "from": "agm", "days": 30}', '{company}'),
  ('MGT7', 'MGT-7 (annual return)', 'yearly', '{"for": "cin", "from": "agm", "days": 60}', '{company}'),
  ('ADT1', 'ADT-1 (auditor appointment)', 'yearly', '{"for": "cin", "from": "agm", "days": 15}', '{company}'),
  ('DPT3', 'DPT-3 (return of deposits)', 'yearly', '{"for": "cin", "after": 3, "day": 30}', '{company}'),
  ('MSME1', 'MSME-1 (half year)', 'half_yearly', '{"for": "cin", "after": 1, "day": 30, "months": [3, 9], "except": {"09": {"after": 1, "day": 31}}}', '{company}')
on conflict (code, period_key) do nothing;

-- The AGM date for a company's financial year, typed by the owner, a partner or a manager of
-- the client: each of its services that follows the AGM gets its task for that year, due the
-- rule's days after the AGM. A task already filed is left alone. Logged.
create or replace function public.record_agm(target_firm uuid, registration uuid, year_end text, agm date) returns integer
language plpgsql security definer set search_path = '' as $$
declare made integer;
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') or year_end !~ '^[0-9]{4}-03$' then return 0; end if;
  if agm < (year_end || '-01')::date or agm > (year_end || '-01')::date + interval '2 years' then return 0; end if;
  with planned as (
    insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on, details)
    select r.firm_id, r.client_id, r.id, t.code, year_end, agm + (t.due_rule ->> 'days')::int, jsonb_build_object('agm', agm)
    from public.client_registrations r
    join public.clients c on c.id = r.client_id and c.firm_id = r.firm_id and c.archived_at is null
    cross join unnest(r.services) s (code)
    join public.compliance_types t on t.code = s.code and t.period_key = '' and t.due_rule ->> 'from' = 'agm'
    where r.firm_id = target_firm and r.id = registration
      and (target_firm in (select public.open_firms()) or r.client_id in (select public.assigned_clients()))
    on conflict (firm_id, registration_id, code, period_key) do update set due_on = excluded.due_on, details = tasks.details || excluded.details
      where tasks.status <> 'filed'
    returning id
  ) select count(*) into made from planned;
  if made > 0 then
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
      values (target_firm, (select auth.uid()), 'agm.recorded', 'registration', registration, jsonb_build_object('year_end', year_end, 'agm', agm, 'returns', made));
  end if;
  return made;
end;
$$;
revoke all on function public.record_agm(uuid, uuid, text, date) from public, anon;
grant execute on function public.record_agm(uuid, uuid, text, date) to authenticated;
