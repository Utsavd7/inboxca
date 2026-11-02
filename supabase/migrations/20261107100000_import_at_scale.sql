-- A client list of hundreds with services imports in one statement (follows 20261105300000).
-- Setting services after the insert fired the services trigger once a number, each planning 12
-- months of tasks, past the 8 second statement timeout at 150 clients. Now the numbers are
-- inserted with their services (no trigger), checked once with the trigger's own rule, and the
-- calendar is planned by the firm's calendar_top_up job straight after, as every night.
--
-- A firm joining mid year also gets the period just gone for each service (last month's GST
-- returns, the last tax year's ITR) when its due date has passed, so the registers have the
-- return to fill, and the firm marks the ones already filed on the Calendar. A last tax year's
-- ITR is offered only in the calendar year its due date fell in; its legal belated window is
-- not taken from official text here and a CA confirms it.
--
-- "looked_after" on a client is the user id of the person who looks after it (the Looked after
-- by column of the list), assigned by their firm role.

-- The services trigger's rule, for the trigger and the import alike: each service on its kind
-- of number, at most one of each return, one GST scheme.
create or replace function private.services_fit(services text[], number_kind text) returns boolean
language sql stable set search_path = '' as $$
  select not exists (select 1 from unnest(services) s (code)
      left join public.compliance_types t on t.code = s.code and t.period_key = ''
      where t.code is null or t.due_rule ->> 'for' <> number_kind)
    and not exists (select 1 from unnest(services) s (code)
      join public.compliance_types t on t.code = s.code and t.period_key = ''
      group by t.due_rule ->> 'one_of' having t.due_rule ->> 'one_of' is not null and count(*) > 1)
    and (select count(distinct t.due_rule ->> 'scheme') from unnest(services) s (code)
      join public.compliance_types t on t.code = s.code and t.period_key = '') <= 1
$$;
revoke all on function private.services_fit(text[], text) from public, anon, authenticated, service_role;

create or replace function private.services_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.services_fit(new.services, new.kind) then
    raise exception 'These services do not fit this number.' using errcode = '23514';
  end if;
  delete from public.tasks where registration_id = new.id and status = 'upcoming' and code <> all (new.services);
  perform private.plan_tasks(new.id);
  return null;
end;
$$;

create or replace function public.add_clients(target_firm uuid, clients jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') then
    return 0;
  end if;
  insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx, phone_enc)
  select (c ->> 'id')::uuid, target_firm, c ->> 'name', c ->> 'kind', c ->> 'email_enc', c ->> 'email_bidx', c ->> 'phone_enc'
  from jsonb_array_elements(clients) c;
  insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code, identity_hash, services)
  select target_firm, (c ->> 'id')::uuid, r ->> 'kind', r ->> 'number_enc', r ->> 'number_bidx', r ->> 'state_code', r ->> 'identity_hash',
    case when jsonb_typeof(r -> 'services') = 'array' then array(select jsonb_array_elements_text(r -> 'services')) else '{}' end
  from jsonb_array_elements(clients) c, jsonb_array_elements(c -> 'registrations') r;
  if exists (select 1 from jsonb_array_elements(clients) c, jsonb_array_elements(c -> 'registrations') r
      where jsonb_typeof(r -> 'services') = 'array' and jsonb_array_length(r -> 'services') > 0
        and not private.services_fit(array(select jsonb_array_elements_text(r -> 'services')), r ->> 'kind')) then
    raise exception 'These services do not fit this number.' using errcode = '23514';
  end if;
  insert into public.client_assignments (firm_id, client_id, user_id, role)
  select target_firm, (c ->> 'id')::uuid, m.user_id, case m.role when 'owner' then 'partner_in_charge' when 'partner' then 'partner_in_charge' when 'manager' then 'manager' else 'staff' end
  from jsonb_array_elements(clients) c
  join public.firm_members m on m.firm_id = target_firm and m.user_id = (c ->> 'looked_after')::uuid and m.status = 'active';
  -- The period just gone whose due date has passed, one a service, by the calendar's rules
  -- (private.plan_tasks_for); only the ITR among yearly returns, in its due date's year.
  insert into public.tasks (firm_id, client_id, registration_id, code, period_key, due_on)
  select distinct on (registration_id, code) firm_id, client_id, registration_id, code, period_key, due_on from (
    select r.firm_id, r.client_id, r.id as registration_id, t.code, t.frequency, to_char(p.period_end, 'YYYY-MM') as period_key,
      coalesce((x.due_rule ->> 'on')::date, private.due_on(t.due_rule, p.period_end, r.state_code)) as due_on
    from jsonb_array_elements(clients) c
    join public.client_registrations r on r.firm_id = target_firm and r.client_id = (c ->> 'id')::uuid
    join public.clients k on k.firm_id = r.firm_id and k.id = r.client_id
    cross join unnest(r.services) s (code)
    join public.compliance_types t on t.code = s.code and t.period_key = '' and (t.client_kinds is null or k.kind = any (t.client_kinds))
    cross join lateral (select (date_trunc('month', today::timestamp) + make_interval(months => n))::date as period_end from generate_series(-14, -1) n) p
    left join public.compliance_types x on x.code = t.code and x.period_key = to_char(p.period_end, 'YYYY-MM') and x.verified_on is not null
    where (t.frequency <> 'yearly' or t.code like 'ITR%')
      and case
        when t.due_rule ? 'months' then t.due_rule -> 'months' @> to_jsonb(extract(month from p.period_end)::int)
        when t.frequency = 'quarterly' then extract(month from p.period_end) in (3, 6, 9, 12)
        when t.frequency = 'yearly' then extract(month from p.period_end) = 3
        else true end
      and p.period_end >= coalesce(t.effective_from, '-infinity') and p.period_end <= coalesce(t.effective_to, 'infinity')
  ) gone
  where due_on < today and (frequency <> 'yearly' or extract(year from due_on) = extract(year from today))
  order by registration_id, code, period_key desc
  on conflict (firm_id, registration_id, code, period_key) do nothing;
  -- The due dates ahead follow in the firm's own calendar job, outside this statement's time.
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  values (target_firm, 'calendar_top_up', 'firm', target_firm, 'calendar_top_up:' || target_firm || ':import:' || gen_random_uuid());
  return jsonb_array_length(clients);
end;
$$;

-- The Inbox tells mail from someone who is not a client yet by its reason.
create or replace view public.email_outcomes with (security_invoker = true) as
select e.id, e.firm_id, e.client_id, e.contact_id, e.received_at, e.label, e.decision_source, e.provider_message_id,
  array_remove(array[
    case when r.status = 'pending' then case when r.details ->> 'snooze' > to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') then 'snoozed' else 'reply' end end,
    case when 'waiting' = any(s.states) then 'approval' end,
    case when r.status is null and e.delivery ->> 'ack' = 'held' then 'draft' end,
    case when 'to_check' = any(d.states) then 'check' end,
    case when r.status is null and s.states is null and not e.delivery ? 'ack' and e.label in ('records_past', 'records_current', 'ask_filed', 'ask_papers', 'ask_due') then 'unanswered' end,
    case when r.status is null and e.delivery ->> 'ack' in ('queued', 'sending', 'ready') then 'queued' end,
    case when r.status is null and ('sent' = any(s.states) or e.delivery ->> 'ack' = 'sent') then 'answered' end,
    case when r.status = 'done' and r.details ->> 'replied' = 'true' then 'replied' end,
    case when exists (select 1 from public.tasks t where t.kind = 'notice' and t.details ->> 'email_event_id' = e.id::text) then 'notice' end,
    case when d.states <> '{to_check}' then 'filed' end
  ], null) as outcomes,
  e.reason_code
from public.email_events e
left join public.requests r on r.kind = 'team_reply' and r.entity_type = 'email' and r.entity_id = e.id
left join lateral (select array_agg(distinct status) as states from public.shares where email_event_id = e.id) s on true
left join lateral (select array_agg(distinct status) as states from public.documents where email_event_id = e.id) d on true;
