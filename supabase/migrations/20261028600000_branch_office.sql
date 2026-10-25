-- Branch office (PLAN.md 5.17, 5.17.4 #13): a branch may have its own Office only switch and
-- office connections, kept in groups.settings -> 'office' as {on, lines}. Its people are then
-- checked against their branch's office; everyone else, and every firm without one, against
-- the firm's as before. Deputies, the co-admin and asking to work away stay the firm's.

-- The firm's settings as they apply to a person of this branch.
create or replace function private.branch_settings(firm_settings jsonb, branch uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((select jsonb_set(firm_settings, '{office}',
      coalesce(firm_settings -> 'office', '{}') || '{"on": false, "lines": []}' || (g.settings -> 'office'))
    from public.groups g where g.id = branch and g.kind = 'branch' and g.settings ? 'office'), firm_settings)
$$;

-- The branch whose own office applies to a person, or null for the firm's.
create or replace function private.office_branch(target_firm uuid, person uuid) returns uuid
language sql stable set search_path = '' as $$
  select g.id from public.firm_members m join public.groups g on g.firm_id = m.firm_id and g.id = m.branch_id
  where m.firm_id = target_firm and m.user_id = person and g.kind = 'branch' and g.settings ? 'office'
$$;
revoke all on function private.branch_settings(jsonb, uuid), private.office_branch(uuid, uuid) from public, anon, authenticated;

create or replace function public.member_role(target_firm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.firm_members m
    cross join lateral (select private.branch_settings(f.settings, m.branch_id) as settings from public.firms f where f.id = m.firm_id) f
  where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active'
    and (
      (select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk'))
    )
    and public.open_to(f.settings, m.role, m.access)
    and coalesce((case when (select auth.jwt() ->> 'aal') = 'aal1' then
      (select to_timestamp(max((a ->> 'timestamp')::bigint))
       from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]')) a)
      else public.two_step_at() end) > now() - make_interval(
        hours => (public.access_setting(f.settings, m.role, m.access, 'session_hours'))::int), true)
    and public.office_allows(f.settings, m.role)
$$;

create or replace function public.closed_firms()
returns table (firm_name text, hours jsonb, reason text, away boolean)
language sql stable security definer set search_path = '' as $$
  select f.name, f.settings -> 'hours',
    case when public.session_ended() and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
           and m.role in ('staff', 'manager', 'front_desk') then 'session'
         when not public.open_to(f.settings, m.role, m.access) then 'hours'
         when not public.office_allows(f.settings, m.role) then 'office'
         else 'session' end,
    coalesce((f.settings -> 'office' ->> 'away')::boolean, true)
  from public.firm_members m
    cross join lateral (select f.id, f.name, private.branch_settings(f.settings, m.branch_id) as settings from public.firms f where f.id = m.firm_id) f
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and ((select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk')
        and (public.office_allows(f.settings, m.role) or public.session_ended())))
    and public.member_role(f.id) is null
$$;

create or replace function public.end_other_sessions() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  ended integer;
begin
  if not exists (
    select 1 from public.firm_members m join public.firms f on f.id = m.firm_id
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role in ('staff', 'manager', 'front_desk')
      and coalesce((private.branch_settings(f.settings, m.branch_id) -> 'office' ->> 'on')::boolean, false)
  ) then
    return 0;
  end if;
  delete from auth.sessions
  where user_id = (select auth.uid()) and id <> nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
  get diagnostics ended = row_count;
  return ended;
end;
$$;

create or replace function public.office_refused(target_firm uuid, person uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.firms where id = target_firm for update;
  if not exists (select from public.firm_members m join public.firms f on f.id = m.firm_id
    where m.firm_id = target_firm and m.user_id = person and m.status = 'active'
      and m.role in ('staff', 'manager', 'front_desk') and (private.branch_settings(f.settings, m.branch_id) -> 'office' ->> 'on')::boolean) then return; end if;
  if not exists (select from public.activity_log where firm_id = target_firm and actor_id = person
    and action = 'office.refused' and at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') then
    insert into public.activity_log (firm_id, actor_id, action, details)
      values (target_firm, person, 'office.refused', jsonb_build_object('reason', reason));
  end if;
end
$$;

-- A person of a branch with its own office is matched against, and teaches, that branch's lines.
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
  if not matched and device.kind = 'office' and proven and device.key_id is not null then
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

-- With a branch, the switch and connection decisions change that branch's own office, which
-- starts off with no connections. A request about a person changes the office they are checked against.
drop function public.office_control(uuid, uuid, text, uuid, jsonb, uuid[], uuid);
create function public.office_control(target_firm uuid, actor uuid, decision text,
  request_id uuid default null, connection jsonb default null, deputies uuid[] default null, co_admin uuid default null,
  branch uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare firm_settings jsonb; office jsonb; line jsonb; lines jsonb; request public.requests; is_owner boolean;
begin
  select f.settings into firm_settings from public.firms f where f.id = target_firm for update;
  if not private.office_approver(target_firm, actor) then raise exception 'Only the owner or a deputy may approve'; end if;
  select role = 'owner' into is_owner from public.firm_members where firm_id = target_firm and user_id = actor and status = 'active';
  if decision in ('on', 'off', 'forget', 'fixed') and not private.firm_admin(target_firm, actor) then raise exception 'Only the owner or the co-admin may change this'; end if;
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
  office := case when branch is null then coalesce(firm_settings -> 'office', '{}')
    else coalesce((select g.settings -> 'office' from public.groups g where g.id = branch), '{"on": false}') end;
  lines := coalesce(office -> 'lines', '[]');
  if decision in ('here', 'confirm', 'today', 'fixed') then
    if line is null or not (line ? 'ipv4' or line ? 'ipv6') then raise exception 'No connection to confirm'; end if;
    if decision = 'fixed' then line := line || '{"fixed":true}'; end if;
    if decision = 'today' then
      if public.office_closes(firm_settings) <= now() then raise exception 'The firm is closed for today'; end if;
      line := line || jsonb_build_object('until', public.office_closes(firm_settings));
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
  else raise exception 'Unknown decision'; end if;
  if branch is null then
    update public.firms set settings = jsonb_set(firm_settings, '{office}', office || jsonb_build_object('lines', lines)) where id = target_firm;
  else
    update public.groups set settings = jsonb_set(settings, '{office}', office || jsonb_build_object('lines', lines)) where id = branch;
  end if;
  -- Off closes the waiting connections of the people this office checks.
  if decision = 'off' then
    update public.requests set status = 'done' where firm_id = target_firm and entity_type = 'office_connection' and status = 'pending'
      and private.office_branch(target_firm, (details ->> 'person')::uuid) is not distinct from branch;
  end if;
  if request.id is not null then update public.requests set status = 'done' where id = request.id; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    values (target_firm, actor, 'office.' || decision, 'firm', target_firm,
      case when decision = 'deputies' then jsonb_build_object('deputies', deputies, 'co_admin', co_admin)
        when branch is not null then jsonb_build_object('branch', branch) else '{}' end);
end
$$;
revoke all on function public.office_control(uuid, uuid, text, uuid, jsonb, uuid[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.office_control(uuid, uuid, text, uuid, jsonb, uuid[], uuid, uuid) to service_role;

-- Branch lines are kept and dropped like the firm's.
create or replace function public.office_housekeeping(target_firm uuid, at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare firm_settings jsonb; lines jsonb;
begin
  select f.settings into firm_settings from public.firms f where id = target_firm for update;
  select coalesce(jsonb_agg(l), '[]') into lines from jsonb_array_elements(coalesce(firm_settings -> 'office' -> 'lines', '[]')) l
    where (not l ? 'until' or (l ->> 'until')::timestamptz > at)
      and (coalesce((l ->> 'fixed')::boolean, false) or coalesce(l ->> 'seen_on', l ->> 'confirmed_on')::date > (at at time zone 'Asia/Kolkata')::date - 7);
  update public.firms set settings = jsonb_set(firm_settings, '{office,lines}', lines)
    where id = target_firm and firm_settings -> 'office' -> 'lines' is distinct from lines;
  update public.groups g set settings = jsonb_set(g.settings, '{office,lines}', (select coalesce(jsonb_agg(l), '[]')
      from jsonb_array_elements(coalesce(g.settings -> 'office' -> 'lines', '[]')) l
      where (not l ? 'until' or (l ->> 'until')::timestamptz > at)
        and (coalesce((l ->> 'fixed')::boolean, false) or coalesce(l ->> 'seen_on', l ->> 'confirmed_on')::date > (at at time zone 'Asia/Kolkata')::date - 7)))
    where g.firm_id = target_firm and g.kind = 'branch' and g.settings ? 'office';
end
$$;
