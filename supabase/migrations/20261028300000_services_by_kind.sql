-- Which kinds of client a service applies to (clients.kind); null means every kind. Like the
-- due date, it is part of the rule a CA checks before verifying it. Only plain rules are
-- filled; anything unsure stays null. The calendar plans no new task for a service outside
-- its kinds; tasks already made stay.
alter table public.compliance_types add column if not exists client_kinds text[];

-- DIR-3 KYC: only an individual can be a director (Companies Act s.149(1), Rule 12A). A
-- business or tax audit client may be a proprietor filed under the proprietor's own PAN.
update public.compliance_types set client_kinds = '{individual,business,tax_audit}' where code = 'DIR3KYC' and period_key = '';
-- Form 8 and Form 11 are filed by every LLP (LLP Act s.34 and s.35), by no one else.
update public.compliance_types set client_kinds = '{llp}' where code in ('LLP8', 'LLP11') and period_key = '';
-- Non-audit ITR: a company's due date is always the audit date (Income-tax Act s.139(1),
-- Explanation 2), and a business with tax audit is an audit case by its kind.
update public.compliance_types set client_kinds = '{individual,business,llp,trust}' where code = 'ITR_NA' and period_key = '';
-- Tax audit (Form 3CA/3CB with 3CD, s.44AB): a plain business is the kind without one. A
-- company, LLP, trust or professional individual can cross the s.44AB limits.
update public.compliance_types set client_kinds = '{individual,tax_audit,company,llp,trust}' where code = 'TAX_AUDIT' and period_key = '';
-- ITR_AUDIT stays null: a working partner of an audited firm is an individual audit case.

create or replace function private.plan_tasks_for(registration uuid, target_firm uuid, today date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on)
  select firm_id, client_id, registration_id, code, period_key, due_on from (
    select r.firm_id, r.client_id, r.id as registration_id, t.code, to_char(p.period_end, 'YYYY-MM') as period_key,
      coalesce((x.due_rule ->> 'on')::date, private.due_on(t.due_rule, p.period_end, r.state_code)) as due_on
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
