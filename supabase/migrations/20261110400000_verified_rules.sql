-- Due dates checked against official text on 3 Nov 2026 (runbooks/ca-research-3nov.md, local).
-- Each rule read in the official text gets its link, so a firm's owner can open it and
-- confirm the date for their firm in one click (public.confirm_due_date). Orelu's own CA check
-- (verified_on, approved_by) is not given here. DPT-3, LLP Form 8 and LLP Form 11 stay without
-- a link: MCA and India Code did not serve their text.
update public.compliance_types t set source_url = links.url
from (values
  ('ITR_NA', 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf'),
  ('ITR_BIZ', 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf'),
  ('ITR_AUDIT', 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf'),
  ('ITR_TP', 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf'),
  ('ADV_TAX', 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf'),
  ('ADV_TAX_P', 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf'),
  ('TAX_AUDIT', 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf'),
  ('TDS_PAY', 'https://www.incometaxindia.gov.in/documents/81799/11848482/FAQs-on-Interplay-and-Transition.pdf'),
  ('TDS_RET', 'https://www.incometaxindia.gov.in/w/rule-219-1'),
  ('GSTR1_M', 'https://gstcouncil.gov.in/node/4274'),
  ('GSTR1_Q', 'https://gstcouncil.gov.in/node/4274'),
  ('GSTR3B_M', 'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule61_v1.00.html'),
  ('GSTR3B_Q', 'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule61_v1.00.html'),
  ('PMT06', 'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule61_v1.00.html'),
  ('CMP08', 'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule62_v1.00.html'),
  ('GSTR4', 'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule62_v1.00.html'),
  ('GSTR9', 'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter8/rule80_v1.00.html'),
  ('AOC4', 'https://www.indiacode.nic.in/bitstream/123456789/2114/5/A2013-18.pdf'),
  ('MGT7', 'https://www.indiacode.nic.in/bitstream/123456789/2114/5/A2013-18.pdf'),
  ('ADT1', 'https://www.indiacode.nic.in/bitstream/123456789/2114/5/A2013-18.pdf'),
  ('MSME1', 'https://egazette.gov.in/WriteReadData/2019/195751.pdf')
) links (code, url)
where t.code = links.code and t.period_key = '' and t.verified_on is null;

-- DIR-3 KYC: rule 12A of the Companies (Appointment and Qualification of Directors) Rules,
-- 2014, as substituted by G.S.R. 943(E) of 31 Dec 2025 (in force 31 March 2026,
-- https://egazette.gov.in/WriteReadData/2025/268970.pdf): Form DIR-3 KYC Web on or before
-- 30 June immediately following every third consecutive financial year, and again within 30
-- days of a change of mobile, email or residential address. The three year cycle is the
-- director's own, so, like the AGM date, the calendar plans nothing until the financial year
-- of the last KYC is recorded (record_kyc below): "from" gives no fixed date. Tasks planned
-- under the old yearly 30 September rule and not filed are taken off; filed ones keep their
-- record and date the next cycle.
update public.compliance_types set name = 'DIR-3 KYC Web', source_url = 'https://egazette.gov.in/WriteReadData/2025/268970.pdf',
  due_rule = '{"for": "pan", "from": "kyc", "years": 3, "month": 6, "day": 30}'
where code = 'DIR3KYC' and period_key = '' and verified_on is null;
delete from public.tasks where kind = 'compliance' and code = 'DIR3KYC' and status <> 'filed';

-- The financial year of a director's last DIR-3 KYC, typed by the owner, a partner or a
-- manager of the client: the next KYC is due the rule's years on, by its month and day, and
-- any earlier KYC task not yet started goes. A task already filed is left alone. Logged.
create or replace function public.record_kyc(target_firm uuid, registration uuid, year_end text) returns integer
language plpgsql security definer set search_path = '' as $$
declare made integer;
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') or year_end !~ '^[0-9]{4}-03$' then return 0; end if;
  if (year_end || '-01')::date not between (now() at time zone 'Asia/Kolkata')::date - interval '10 years' and (now() at time zone 'Asia/Kolkata')::date then return 0; end if;
  with planned as (
    insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on, details)
    select r.firm_id, r.client_id, r.id, t.code, to_char(n.period_end, 'YYYY-MM'),
      make_date(extract(year from n.period_end)::int, (t.due_rule ->> 'month')::int, (t.due_rule ->> 'day')::int), jsonb_build_object('last_kyc', year_end)
    from public.client_registrations r
    join public.clients c on c.id = r.client_id and c.firm_id = r.firm_id and c.archived_at is null
    cross join unnest(r.services) s (code)
    join public.compliance_types t on t.code = s.code and t.period_key = '' and t.due_rule ->> 'from' = 'kyc'
    cross join lateral (select ((year_end || '-01')::date + make_interval(years => (t.due_rule ->> 'years')::int))::date as period_end) n
    where r.firm_id = target_firm and r.id = registration
      and (target_firm in (select public.open_firms()) or r.client_id in (select public.assigned_clients()))
    on conflict (firm_id, registration_id, code, period_key) do update set due_on = excluded.due_on, details = tasks.details || excluded.details
      where tasks.status <> 'filed'
    returning id, code, period_key
  ), cleared as (
    delete from public.tasks x using planned p
    where x.firm_id = target_firm and x.registration_id = registration and x.code = p.code and x.period_key <> p.period_key and x.status = 'upcoming'
    returning 1
  ) select count(*) into made from planned;
  if made > 0 then
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
      values (target_firm, (select auth.uid()), 'kyc.recorded', 'registration', registration, jsonb_build_object('year_end', year_end, 'returns', made));
  end if;
  return made;
end;
$$;
revoke all on function public.record_kyc(uuid, uuid, text) from public, anon;
grant execute on function public.record_kyc(uuid, uuid, text) to authenticated;

-- Tax audit report: one month before the return's due date (Income-tax Act, 2025, s.63(5)(a)).
-- Where transfer pricing applies the return is due 30 November (s.263(1) Table Sl. No. 1), so
-- the report is due 31 October; every other audit case stays at 30 September. A rule's "with"
-- names another service on the same number and the after/day that apply beside it.
update public.compliance_types set due_rule = due_rule || '{"with": {"ITR_TP": {"after": 7, "day": 31}}}'
where code = 'TAX_AUDIT' and period_key = '' and verified_on is null;

-- As in 20261028300000_services_by_kind.sql, with a rule's "with" merged in when the number
-- also has that service.
create or replace function private.plan_tasks_for(registration uuid, target_firm uuid, today date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on)
  select firm_id, client_id, registration_id, code, period_key, due_on from (
    select r.firm_id, r.client_id, r.id as registration_id, t.code, to_char(p.period_end, 'YYYY-MM') as period_key,
      coalesce((x.due_rule ->> 'on')::date, private.due_on(t.due_rule || coalesce((select t.due_rule -> 'with' -> w from unnest(r.services) w where t.due_rule -> 'with' ? w limit 1), '{}'), p.period_end, r.state_code)) as due_on
    from public.client_registrations r
    join public.clients c on c.firm_id = r.firm_id and c.id = r.client_id and c.archived_at is null
    cross join unnest(r.services) s (code)
    join public.compliance_types t on t.code = s.code and t.period_key = '' and (t.client_kinds is null or c.kind = any (t.client_kinds))
    cross join lateral (select (date_trunc('month', today::timestamp) + make_interval(months => n))::date as period_end from generate_series(-14, 12) n) p
    left join public.compliance_types x on x.code = t.code and x.period_key = to_char(p.period_end, 'YYYY-MM') and x.verified_on is not null
    where (registration is null or r.id = registration) and (target_firm is null or r.firm_id = target_firm)
      and case
        when t.due_rule ? 'months' then t.due_rule -> 'months' @> to_jsonb(extract(month from p.period_end)::int)
        when t.frequency = 'quarterly' then extract(month from p.period_end) in (3, 6, 9, 12)
        when t.frequency = 'yearly' then extract(month from p.period_end) = 3
        else true end
      and p.period_end >= coalesce(t.effective_from, '-infinity') and p.period_end <= coalesce(t.effective_to, 'infinity')
  ) planned
  where due_on between today and today + interval '12 months'
  on conflict (firm_id, registration_id, code, period_key) do update set due_on = excluded.due_on
    where tasks.status <> 'filed' and tasks.due_on <> excluded.due_on;
end;
$$;

-- Tax audit reports already planned for a transfer pricing client move to 31 October, filed
-- ones excepted.
update public.tasks t set due_on = private.due_on(x.due_rule || (x.due_rule -> 'with' -> 'ITR_TP'), to_date(t.period_key, 'YYYY-MM'), null)
from public.client_registrations r, public.compliance_types x
where r.firm_id = t.firm_id and r.id = t.registration_id and 'ITR_TP' = any (r.services)
  and t.kind = 'compliance' and t.code = 'TAX_AUDIT' and t.status <> 'filed' and x.code = 'TAX_AUDIT' and x.period_key = '';

-- A One Person Company holds no AGM (Companies Act 2013, s.96(1)) and files its financial
-- statements within 180 days from the close of the financial year (s.137(1), third proviso):
-- 27 September. Choosing this service on the company's CIN, in place of the AGM based AOC-4,
-- is how a company is marked a One Person Company; the two exclude each other.
insert into public.compliance_types (code, name, frequency, due_rule, client_kinds, source_url) values
  ('AOC4_OPC', 'AOC-4 (One Person Company, no AGM)', 'yearly', '{"for": "cin", "after": 6, "day": 27, "one_of": "aoc4"}', '{company}', 'https://www.indiacode.nic.in/bitstream/123456789/2114/5/A2013-18.pdf')
on conflict (code, period_key) do nothing;
update public.compliance_types set due_rule = due_rule || '{"one_of": "aoc4"}' where code = 'AOC4' and period_key = '' and not due_rule ? 'one_of';
