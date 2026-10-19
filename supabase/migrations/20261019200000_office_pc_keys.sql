-- M7 step 11 (PLAN.md 5.17, 5.17.4 #32, #36, #38, #50): a PC that stays in the office keeps a
-- key of its own (a passkey that cannot leave it, such as Windows Hello's). Only a check with
-- that key, on that PC, confirms a changed office connection by itself; without it the PC waits
-- for the owner or a deputy like a laptop. Only the key's public half is kept.
alter table public.devices
  add column key_id text check (length(key_id) <= 400),
  add column key_public text check (length(key_public) <= 400),
  add constraint devices_key check ((key_id is null) = (key_public is null));

drop function public.observe_office(uuid, uuid, uuid, jsonb);
create function public.observe_office(target_firm uuid, person uuid, pc uuid, connection jsonb, proven boolean default false)
returns boolean
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
    update public.firms set settings = jsonb_set(firm_settings, '{office,lines}', lines) where id = target_firm;
    if learned then
      insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
        values (target_firm, person, 'office.learned', 'device', pc);
    end if;
  end if;
  return matched;
end;
$$;

revoke all on function public.observe_office(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.observe_office(uuid, uuid, uuid, jsonb, boolean) to service_role;
