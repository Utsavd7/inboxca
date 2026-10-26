-- Access policy leftovers (PLAN.md 5.17, 5.17.4 #13):
-- * a branch's own office hours, holidays and special hours (groups.settings, the keys firms
--   use), which replace the main office's for its people;
-- * a branch's own PCs: a PC belongs to the office of the person who first used it
--   (devices.branch_id, empty for the main office), and only that office's PCs prove its
--   changed connection; a branch can follow the main office again;
-- * Remote friendly's approved devices: Office only with office.anywhere, where staff use the
--   devices the owner approved from any connection, always with the 2 step code;
-- * India only checked here too, from a proof the server sends (x-inboxca-country, like the
--   office proof), so a sign in token used from elsewhere reaches nothing;
-- * the policy tester, access_check.

alter table public.devices add column if not exists branch_id uuid,
  drop constraint if exists devices_firm_id_branch_id_fkey,
  add constraint devices_firm_id_branch_id_fkey foreign key (firm_id, branch_id)
    references public.groups (firm_id, id) on delete set null (branch_id);

-- The firm's settings as they apply to a person of this branch: its own hours, holidays and
-- special hours, and its own office (which starts off, with no connections, in the office mode).
create or replace function private.branch_settings(firm_settings jsonb, branch uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((select case when g.settings ? 'office' then jsonb_set(own.settings, '{office}',
        coalesce(firm_settings -> 'office', '{}') || '{"on": false, "lines": [], "anywhere": false}' || (g.settings -> 'office'))
      else own.settings end
    from public.groups g
      cross join lateral (select firm_settings || coalesce((select jsonb_object_agg(key, value) from jsonb_each(g.settings)
        where key in ('hours', 'holidays', 'special_hours')), '{}') as settings) own
    where g.id = branch and g.kind = 'branch'), firm_settings)
$$;

-- India only (Remote friendly): for anyone it binds, the server's proof that this request came
-- from India, good for 5 minutes, for this person and session, signed like the office proof.
create or replace function private.country_allows(settings jsonb, member_role text, person jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  proof text := current_setting('request.headers', true)::json ->> 'x-inboxca-country';
  until bigint;
begin
  if member_role = 'owner' or not coalesce((public.access_setting(settings, member_role, person, 'india_only'))::boolean, false) then
    return true;
  end if;
  if proof is null or proof !~ '^[0-9]{1,12}\.[0-9a-f]{64}$' then
    return false;
  end if;
  until := split_part(proof, '.', 1)::bigint;
  return until >= extract(epoch from now())
    and split_part(proof, '.', 2) = encode(extensions.hmac(
      'country:' || (select auth.uid())::text || ':' || coalesce((select auth.jwt() ->> 'session_id'), '') || ':' || until,
      public.office_proof_key(), 'sha256'), 'hex');
end;
$$;
revoke all on function private.country_allows(jsonb, text, jsonb) from public, anon, authenticated;

-- As in 20261030800000_current_firm.sql, with India only, and the email code alone only on
-- the office connection, never with approved devices anywhere.
create or replace function public.member_role(target_firm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.firm_members m
    cross join lateral (select private.branch_settings(f.settings, m.branch_id) as settings from public.firms f where f.id = m.firm_id) f
  where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active'
    and target_firm = coalesce(private.request_firm(), target_firm)
    and (
      (select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and not coalesce((f.settings -> 'office' ->> 'anywhere')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk'))
    )
    and public.open_to(f.settings, m.role, m.access)
    and coalesce((case when (select auth.jwt() ->> 'aal') = 'aal1' then
      (select to_timestamp(max((a ->> 'timestamp')::bigint))
       from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]')) a)
      else public.two_step_at() end) > now() - make_interval(
        hours => (public.access_setting(f.settings, m.role, m.access, 'session_hours'))::int), true)
    and public.office_allows(f.settings, m.role)
    and private.country_allows(f.settings, m.role, m.access)
$$;

create or replace function public.closed_firms()
returns table (firm_name text, hours jsonb, reason text, away boolean)
language sql stable security definer set search_path = '' as $$
  select f.name, f.settings -> 'hours',
    case when public.session_ended() and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
           and m.role in ('staff', 'manager', 'front_desk') then 'session'
         when not public.open_to(f.settings, m.role, m.access) then 'hours'
         when not public.office_allows(f.settings, m.role) then 'office'
         when not private.country_allows(f.settings, m.role, m.access) then 'country'
         else 'session' end,
    coalesce((f.settings -> 'office' ->> 'away')::boolean, true)
  from public.firm_members m
    cross join lateral (select f.id, f.name, private.branch_settings(f.settings, m.branch_id) as settings from public.firms f where f.id = m.firm_id) f
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and ((select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and not coalesce((f.settings -> 'office' ->> 'anywhere')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk')
        and (public.office_allows(f.settings, m.role) or public.session_ended())))
    and public.member_role(f.id) is null
$$;

-- A PC belongs to the office of the person who first uses it.
create or replace function public.register_device(target_firm uuid, actor uuid, token_digest text, label text, away boolean default false)
returns table (id uuid, status text)
language sql security definer set search_path = '' as $$
  with inserted as (
    insert into public.devices (firm_id, token_hash, name, branch_id)
    values (target_firm, token_digest, label, private.office_branch(target_firm, actor))
    on conflict (token_hash) do nothing
    returning devices.id, devices.status
  ), logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select target_firm, actor, 'device.first_seen', 'device', inserted.id,
      case when away then '{"away": true}'::jsonb else '{}'::jsonb end
    from inserted
    returning entity_id
  )
  select inserted.id, inserted.status from inserted join logged on logged.entity_id = inserted.id
  union all
  select devices.id, devices.status from public.devices
  where devices.firm_id = target_firm and devices.token_hash = token_digest
    and not exists (select from inserted)
$$;

-- Approve all covers one office's waiting PCs, as staying in the office or, for approved
-- devices anywhere, as laptops.
drop function if exists public.review_devices(uuid, uuid, uuid, text, date);
create or replace function public.review_devices(target_firm uuid, actor uuid, target_device uuid, decision text, until_day date default null, branch uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform 1 from public.firms where id = target_firm for update;
  if not private.office_approver(target_firm, actor) then raise exception 'Only the owner or a deputy may approve'; end if;
  if decision = 'personal' and (until_day is null or until_day < today or until_day > today + 90) then
    raise exception 'A personal device is allowed until a day within 90 days';
  end if;
  with changed as (
    update public.devices d set
      status = case when decision in ('refuse', 'withdraw') then 'refused' else 'approved' end,
      kind = case when decision in ('office', 'laptop', 'personal') then decision end,
      person_id = case when decision = 'personal' then (select a.actor_id from public.activity_log a
        where a.firm_id = target_firm and a.entity_id = d.id and a.action = 'device.first_seen' limit 1) end,
      ends_on = case when decision = 'personal' then until_day end
    where d.firm_id = target_firm
      and (d.status = 'waiting' and decision in ('office', 'laptop', 'personal', 'refuse')
        or d.status = 'approved' and decision = 'withdraw')
      and (d.id = target_device or target_device = '00000000-0000-0000-0000-000000000000' and decision in ('office', 'laptop')
        and d.branch_id is not distinct from branch
        and not exists (select from public.activity_log a where a.firm_id = target_firm and a.entity_id = d.id
          and a.action = 'device.first_seen' and a.details ? 'away'))
      and not exists (select from public.activity_log a join public.firm_members m on m.firm_id = a.firm_id and m.user_id = actor
        where a.entity_id = d.id and a.firm_id = target_firm and a.action = 'device.first_seen' and a.actor_id = actor and m.role <> 'owner')
    returning d.id)
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select target_firm, actor, case decision when 'refuse' then 'device.refused' when 'withdraw' then 'device.withdrawn' else 'device.approved' end,
      'device', id, jsonb_strip_nulls(jsonb_build_object('kind', decision, 'until', until_day)) from changed;
end;
$$;
revoke all on function public.review_devices(uuid, uuid, uuid, text, date, uuid) from public, anon, authenticated;
grant execute on function public.review_devices(uuid, uuid, uuid, text, date, uuid) to service_role;

-- As in 20261028600000_branch_office.sql; only a PC of the person's own office confirms its
-- changed connection by itself.
create or replace function public.observe_office(target_firm uuid, person uuid, pc uuid, connection jsonb, proven boolean default false)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  firm_settings jsonb; office jsonb; lines jsonb; line jsonb; next_line jsonb; device public.devices; branch uuid;
  today text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD');
  matched boolean := false; learned boolean := false;
begin
  select f.settings into firm_settings from public.firms f where f.id = target_firm for update;
  branch := private.office_branch(target_firm, person);
  office := coalesce(private.branch_settings(firm_settings, branch) -> 'office', '{}');
  if not coalesce((office ->> 'on')::boolean, false) then return false; end if;
  select * into device from public.devices where firm_id = target_firm and id = pc and status = 'approved';
  if device.id is null or not exists (select from public.firm_members where firm_id = target_firm and user_id = person
    and status = 'active' and role in ('staff', 'manager', 'front_desk'))
    or not (connection ? 'ipv4' or connection ? 'ipv6') then return false; end if;
  lines := '[]';
  for line in select * from jsonb_array_elements(coalesce(office -> 'lines', '[]')) loop
    if (not line ? 'until' or (line ->> 'until')::timestamptz > now()) and
       ((connection ? 'ipv4' and line ->> 'ipv4' = connection ->> 'ipv4')
         or (connection ? 'ipv6' and line ->> 'ipv6' = connection ->> 'ipv6')) then
      -- One confirmed half can teach the other half, only on this approved PC request.
      next_line := line || connection || jsonb_build_object('seen_on', today);
      learned := learned or (next_line - 'seen_on' <> line - 'seen_on');
      matched := true;
      lines := lines || jsonb_build_array(next_line);
    else lines := lines || jsonb_build_array(line); end if;
  end loop;
  if not matched and device.kind = 'office' and proven and device.key_id is not null and device.branch_id is not distinct from branch then
    next_line := connection || jsonb_build_object('id', gen_random_uuid(), 'confirmed_on', today, 'seen_on', today, 'device', pc);
    lines := lines || jsonb_build_array(next_line);
    matched := true; learned := true;
    insert into public.requests (firm_id, kind, entity_type, entity_id, reason_code, details)
      values (target_firm, 'alert', 'office_connection', pc, 'office_changed', jsonb_build_object('line', next_line, 'person', person, 'day', today))
      on conflict (kind, entity_type, entity_id) do update set status = 'pending', reason_code = excluded.reason_code, details = excluded.details;
  elsif not matched then
    insert into public.requests (firm_id, kind, entity_type, entity_id, reason_code, details)
      values (target_firm, 'alert', 'office_connection', pc, 'office_waiting', jsonb_build_object('line', connection, 'person', person, 'day', today))
      on conflict (kind, entity_type, entity_id) do update set status = 'pending', reason_code = excluded.reason_code, details = excluded.details
      where requests.details ->> 'day' is distinct from today or requests.details -> 'line' <> connection;
    perform public.office_refused(target_firm, person, 'connection');
  end if;
  if matched and office -> 'lines' is distinct from lines then
    if branch is null then
      update public.firms set settings = jsonb_set(firm_settings, '{office,lines}', lines) where id = target_firm;
    else
      update public.groups set settings = jsonb_set(settings, '{office,lines}', lines) where id = branch;
    end if;
    if learned then
      insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
        values (target_firm, person, 'office.learned', 'device', pc);
    end if;
  end if;
  return matched;
end;
$$;

-- As in 20261028600000_branch_office.sql, with follow (a branch drops its own office, and its
-- PCs and waiting connections go to the main office), and today's network lasting to the
-- closing time of the person's own office.
create or replace function public.office_control(target_firm uuid, actor uuid, decision text,
  request_id uuid default null, connection jsonb default null, deputies uuid[] default null, co_admin uuid default null,
  branch uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare firm_settings jsonb; office jsonb; line jsonb; lines jsonb; request public.requests; is_owner boolean; closes timestamptz;
begin
  select f.settings into firm_settings from public.firms f where f.id = target_firm for update;
  if not private.office_approver(target_firm, actor) then raise exception 'Only the owner or a deputy may approve'; end if;
  select role = 'owner' into is_owner from public.firm_members where firm_id = target_firm and user_id = actor and status = 'active';
  if decision in ('on', 'off', 'forget', 'fixed', 'follow') and not private.firm_admin(target_firm, actor) then raise exception 'Only the owner or the co-admin may change this'; end if;
  if decision = 'deputies' and not is_owner then raise exception 'Only the owner may change this'; end if;
  if request_id is not null then
    select * into request from public.requests where id = request_id and firm_id = target_firm and entity_type = 'office_connection' and status = 'pending';
    if request.id is null then return; end if;
    if not is_owner and request.details ->> 'person' = actor::text then raise exception 'Ask another approver'; end if;
    if not exists (select from public.devices where id = request.entity_id and firm_id = target_firm and status = 'approved') then raise exception 'PC is not approved'; end if;
    line := request.details -> 'line';
    branch := private.office_branch(target_firm, (request.details ->> 'person')::uuid);
  else line := connection; end if;
  if decision = 'deputies' then branch := null; end if;
  if branch is not null and not exists (select from public.groups g where g.id = branch and g.firm_id = target_firm and g.kind = 'branch') then
    raise exception 'No such branch';
  end if;
  if decision = 'follow' and branch is null then raise exception 'No such branch'; end if;
  office := case when branch is null then coalesce(firm_settings -> 'office', '{}')
    else coalesce((select g.settings -> 'office' from public.groups g where g.id = branch), '{"on": false}') end;
  lines := coalesce(office -> 'lines', '[]');
  if decision in ('here', 'confirm', 'today', 'fixed') then
    if line is null or not (line ? 'ipv4' or line ? 'ipv6') then raise exception 'No connection to confirm'; end if;
    if decision = 'fixed' then line := line || '{"fixed":true}'; end if;
    if decision = 'today' then
      closes := public.office_closes(private.branch_settings(firm_settings, (select m.branch_id from public.firm_members m
        where m.firm_id = target_firm and m.user_id = (request.details ->> 'person')::uuid)));
      if closes <= now() then raise exception 'The firm is closed for today'; end if;
      line := line || jsonb_build_object('until', closes);
    end if;
    lines := lines || jsonb_build_array(line || jsonb_build_object('id', gen_random_uuid(), 'confirmed_on', (now() at time zone 'Asia/Kolkata')::date, 'seen_on', (now() at time zone 'Asia/Kolkata')::date));
  elsif decision = 'refuse' then
    select coalesce(jsonb_agg(l), '[]') into lines from jsonb_array_elements(lines) l where l ->> 'id' is distinct from line ->> 'id';
    if request.reason_code = 'office_changed' then
      update public.devices set kind = 'laptop' where firm_id = target_firm and id = request.entity_id;
    end if;
  elsif decision = 'deputies' then
    if cardinality(deputies) > 2 or cardinality(deputies) <> (select count(distinct u) from unnest(deputies) u)
      or exists (select from unnest(deputies) u where not exists (select from public.firm_members where firm_id = target_firm and user_id = u and role = 'partner' and status = 'active'))
      then raise exception 'Choose up to two active partners'; end if;
    if co_admin is not null and not co_admin = any(deputies) then raise exception 'The co-admin must be a deputy'; end if;
    office := office || jsonb_build_object('deputies', to_jsonb(coalesce(deputies, '{}')), 'co_admin', co_admin);
  elsif decision = 'on' then office := office || '{"on":true}';
    if line is not null then lines := lines || jsonb_build_array(line); end if;
  elsif decision = 'off' then office := office || '{"on":false}';
  elsif decision = 'forget' then lines := '[]';
  elsif decision <> 'follow' then raise exception 'Unknown decision'; end if;
  -- Off and follow close the waiting connections of the people this office checks.
  if decision in ('off', 'follow') then
    update public.requests set status = 'done' where firm_id = target_firm and entity_type = 'office_connection' and status = 'pending'
      and private.office_branch(target_firm, (details ->> 'person')::uuid) is not distinct from branch;
  end if;
  if decision = 'follow' then
    update public.groups set settings = settings - 'office' where id = branch;
    update public.devices set branch_id = null where firm_id = target_firm and branch_id = branch;
  elsif branch is null then
    update public.firms set settings = jsonb_set(firm_settings, '{office}', office || jsonb_build_object('lines', lines)) where id = target_firm;
  else
    update public.groups set settings = jsonb_set(settings, '{office}', office || jsonb_build_object('lines', lines)) where id = branch;
  end if;
  if request.id is not null then update public.requests set status = 'done' where id = request.id; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    values (target_firm, actor, 'office.' || decision, 'firm', target_firm,
      case when decision = 'deputies' then jsonb_build_object('deputies', deputies, 'co_admin', co_admin)
        when branch is not null then jsonb_build_object('branch', branch) else '{}' end);
end
$$;

-- A branch's own hours, holidays or special hours, changed by the owner or the co-admin; a
-- setting given as null goes back to the main office's.
create or replace function public.branch_hours(target_firm uuid, actor uuid, branch uuid, changes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.firms where id = target_firm for update;
  if not private.firm_admin(target_firm, actor) then raise exception 'Only the owner or the co-admin may change this'; end if;
  if jsonb_typeof(changes) is distinct from 'object' or changes = '{}'
    or exists (select from jsonb_object_keys(changes) k where k not in ('hours', 'holidays', 'special_hours')) then
    raise exception 'Unknown setting';
  end if;
  update public.groups g set settings = (g.settings - array(select key from jsonb_each(changes) where value = 'null'))
      || coalesce((select jsonb_object_agg(key, value) from jsonb_each(changes) where value <> 'null'), '{}')
    where g.id = branch and g.firm_id = target_firm and g.kind = 'branch';
  if not found then raise exception 'No such branch'; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    values (target_firm, actor, 'branch.hours', 'group', branch, jsonb_build_object('settings', (select jsonb_agg(k) from jsonb_object_keys(changes) k)));
end
$$;
revoke all on function public.branch_hours(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.branch_hours(uuid, uuid, uuid, jsonb) to service_role;

-- The policy tester (5.17): what would refuse this person now, on the PC with this browser
-- secret and from this connection and country (empty when the host names none), by the same
-- rules as member_role; an empty list means they get in. view_only is a note, not a refusal.
-- Only the owner or the co-admin asks, about their own firm.
create or replace function public.access_check(target_firm uuid, person uuid, connection jsonb, token_digest text, country text)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  member public.firm_members; settings jsonb; office jsonb; pc public.devices; refusals text[] := '{}';
begin
  if public.member_role(target_firm) is null or not private.firm_admin(target_firm, (select auth.uid())) then
    raise exception 'Only the owner or the co-admin may check this';
  end if;
  select * into member from public.firm_members m where m.firm_id = target_firm and m.user_id = person and m.status = 'active';
  if member.user_id is null then return array['not_member']; end if;
  select private.branch_settings(f.settings, member.branch_id) into settings from public.firms f where f.id = target_firm;
  if not public.open_to(settings, member.role, member.access) then refusals := array_append(refusals, 'hours'); end if;
  if member.role <> 'owner' and coalesce(nullif(country, ''), 'IN') <> 'IN'
    and coalesce((public.access_setting(settings, member.role, member.access, 'india_only'))::boolean, false) then
    refusals := array_append(refusals, 'country');
  end if;
  office := coalesce(settings -> 'office', '{}');
  if coalesce((office ->> 'on')::boolean, false) and member.role in ('staff', 'manager', 'front_desk') then
    select * into pc from public.devices d where d.firm_id = target_firm and d.token_hash = token_digest;
    if pc.id is null or pc.status = 'waiting' then refusals := array_append(refusals, 'pc_new');
    elsif pc.status = 'refused' then refusals := array_append(refusals, 'pc_refused');
    elsif pc.kind = 'personal' then
      refusals := array_append(refusals, case when pc.person_id = person and pc.ends_on >= (now() at time zone 'Asia/Kolkata')::date
        and coalesce((office ->> 'away')::boolean, true) then 'view_only' else 'pc_personal' end);
    elsif not coalesce((office ->> 'anywhere')::boolean, false) and not exists (
      select from jsonb_array_elements(coalesce(office -> 'lines', '[]')) l
      where (not l ? 'until' or (l ->> 'until')::timestamptz > now())
        and (connection ? 'ipv4' and l ->> 'ipv4' = connection ->> 'ipv4' or connection ? 'ipv6' and l ->> 'ipv6' = connection ->> 'ipv6')) then
      refusals := array_append(refusals, 'connection');
    end if;
  end if;
  return refusals;
end
$$;
revoke all on function public.access_check(uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.access_check(uuid, uuid, jsonb, text, text) to authenticated;
