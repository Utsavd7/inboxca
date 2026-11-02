-- Client tags, an engagement note and licence dates (client gaps, 8 Nov 2026).
--
-- tags: the firm's own free words on a client ("Priority", "Audit 2027"), plain text since they
-- are the firm's words, not the client's data; filtered on the Clients list and set in bulk.
-- engagement_enc: one short note of what the firm does for the client and since when, encrypted
-- like the email because it can name people.
alter table public.clients add column if not exists tags text[] not null default '{}';
alter table public.clients add column if not exists engagement_enc text;
alter table public.clients drop constraint if exists clients_tags_check;
alter table public.clients add constraint clients_tags_check check (cardinality(tags) <= 10);
grant update (tags, engagement_enc) on public.clients to authenticated;
create index if not exists clients_tags_idx on public.clients using gin (tags);

-- The tags in use across the clients this person may see, for the list's filter.
create or replace function public.firm_tags(target_firm uuid) returns setof text
language sql stable security invoker set search_path = '' as $$
  select distinct t from public.clients c, unnest(c.tags) t where c.firm_id = target_firm and c.archived_at is null order by 1
$$;
revoke all on function public.firm_tags(uuid) from public, anon;
grant execute on function public.firm_tags(uuid) to authenticated;

-- A licence or registration's expiry (FSSAI, Shop Act, IEC, MSME and the like) is a task of
-- kind 'licence' with the firm's own label in details, no code and no rule: the Calendar and
-- Today show it before the date through the same due date engine, and it is marked filed
-- (renewed) the same way. These are the client's own dates, so no rule is verified and no
-- reminder goes to the client (the reminder jobs read compliance tasks only).
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('compliance', 'notice', 'licence'));
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (
  (kind in ('compliance', 'licence') and status in ('upcoming', 'in_progress', 'filed'))
  or (kind = 'notice' and status in ('upcoming', 'in_progress', 'replied', 'closed')));

create or replace function public.calendar_days(target_firm uuid, first_day date, last_day date, only_code text default null)
returns table (due_on date, returns integer, working integer, filed integer)
language sql stable set search_path = '' as $$
  select t.due_on,
    (count(*) filter (where t.status<>'filed'))::int,
    (count(*) filter (where t.status='in_progress'))::int,
    (count(*) filter (where t.status='filed'))::int
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null
  where t.firm_id=target_firm and t.kind in ('compliance', 'licence') and t.due_on between first_day and last_day
    and (only_code is null or t.code=only_code)
  group by t.due_on
  order by t.due_on
$$;

-- The import takes a Tags column (follows 20261107100000; only the clients insert changes).
create or replace function public.add_clients(target_firm uuid, clients jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') then
    return 0;
  end if;
  insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx, phone_enc, tags)
  select (c ->> 'id')::uuid, target_firm, c ->> 'name', c ->> 'kind', c ->> 'email_enc', c ->> 'email_bidx', c ->> 'phone_enc',
    case when jsonb_typeof(c -> 'tags') = 'array' then array(select jsonb_array_elements_text(c -> 'tags')) else '{}' end
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
