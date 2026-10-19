-- Keep the settings value distinct from the table column in office operations.
create or replace function public.observe_office(target_firm uuid, person uuid, pc uuid, connection jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  firm_settings jsonb; office jsonb; lines jsonb; line jsonb; next_line jsonb; device public.devices;
  today text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD');
  matched boolean := false; learned boolean := false;
begin
  select f.settings into firm_settings from public.firms f where f.id = target_firm for update;
  office := coalesce(firm_settings -> 'office', '{}');
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
  if not matched and device.kind = 'office' then
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
      where requests.details ->> 'day' is distinct from today or requests.status = 'pending' and requests.details -> 'line' <> connection;
    perform public.office_refused(target_firm, person, 'connection');
  end if;
  if matched and office -> 'lines' is distinct from lines then
    update public.firms set settings = jsonb_set(firm_settings, '{office,lines}', lines) where id = target_firm;
    if learned then
      insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
        values (target_firm, person, 'office.learned', 'device', pc);
    end if;
  end if;
  return matched;
end
$$;

create or replace function public.office_control(target_firm uuid, actor uuid, decision text,
  request_id uuid default null, connection jsonb default null, deputies uuid[] default null) returns void
language plpgsql security definer set search_path = '' as $$
declare firm_settings jsonb; office jsonb; line jsonb; lines jsonb; request public.requests; is_owner boolean;
begin
  select f.settings into firm_settings from public.firms f where f.id = target_firm for update;
  if not private.office_approver(target_firm, actor) then raise exception 'Only the owner or a deputy may approve'; end if;
  select role = 'owner' into is_owner from public.firm_members where firm_id = target_firm and user_id = actor and status = 'active';
  office := coalesce(firm_settings -> 'office', '{}'); lines := coalesce(office -> 'lines', '[]');
  if decision in ('on', 'off', 'forget', 'deputies') and not is_owner then raise exception 'Only the owner may change this'; end if;
  if request_id is not null then
    select * into request from public.requests where id = request_id and firm_id = target_firm and entity_type = 'office_connection' and status = 'pending';
    if request.id is null then return; end if;
    if not is_owner and request.details ->> 'person' = actor::text then raise exception 'Ask another approver'; end if;
    if not exists (select from public.devices where id = request.entity_id and firm_id = target_firm and status = 'approved') then raise exception 'PC is not approved'; end if;
    line := request.details -> 'line';
  else line := connection; end if;
  if decision in ('here', 'confirm', 'today') then
    if line is null or not (line ? 'ipv4' or line ? 'ipv6') then raise exception 'No connection to confirm'; end if;
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
    office := office || jsonb_build_object('deputies', to_jsonb(coalesce(deputies, '{}')));
  elsif decision = 'on' then office := office || '{"on":true}';
    if line is not null then lines := lines || jsonb_build_array(line); end if;
  elsif decision = 'off' then office := office || '{"on":false}';
  elsif decision = 'forget' then lines := '[]';
  else raise exception 'Unknown decision'; end if;
  update public.firms set settings = jsonb_set(firm_settings, '{office}', office || jsonb_build_object('lines', lines)) where id = target_firm;
  if request.id is not null then update public.requests set status = 'done' where id = request.id; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
    values (target_firm, actor, 'office.' || decision, 'firm', target_firm);
end
$$;

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
end
$$;
