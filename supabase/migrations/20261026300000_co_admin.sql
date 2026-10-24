-- M0 access policies (PLAN.md 5.17.4 #22): the owner may name one deputy as co-admin
-- (settings.office.co_admin). The co-admin also does the owner's security work: Office only
-- on and off, office connections, office hours, holidays, signing in limits, presets and
-- permissions. Naming deputies and the co-admin, the firm's name, email, drive, people and
-- closing the firm stay the owner's.

create function private.firm_admin(target_firm uuid, person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.firm_members m join public.firms f on f.id = m.firm_id
    where m.firm_id = target_firm and m.user_id = person and m.status = 'active'
      and (m.role = 'owner' or m.role = 'partner' and f.settings -> 'office' -> 'deputies' ? person::text
        and f.settings -> 'office' ->> 'co_admin' = person::text))
$$;
revoke all on function private.firm_admin(uuid, uuid) from public, anon, authenticated;

drop function public.office_control(uuid, uuid, text, uuid, jsonb, uuid[]);
create function public.office_control(target_firm uuid, actor uuid, decision text,
  request_id uuid default null, connection jsonb default null, deputies uuid[] default null, co_admin uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare firm_settings jsonb; office jsonb; line jsonb; lines jsonb; request public.requests; is_owner boolean;
begin
  select f.settings into firm_settings from public.firms f where f.id = target_firm for update;
  if not private.office_approver(target_firm, actor) then raise exception 'Only the owner or a deputy may approve'; end if;
  select role = 'owner' into is_owner from public.firm_members where firm_id = target_firm and user_id = actor and status = 'active';
  office := coalesce(firm_settings -> 'office', '{}'); lines := coalesce(office -> 'lines', '[]');
  if decision in ('on', 'off', 'forget', 'fixed') and not private.firm_admin(target_firm, actor) then raise exception 'Only the owner or the co-admin may change this'; end if;
  if decision = 'deputies' and not is_owner then raise exception 'Only the owner may change this'; end if;
  if request_id is not null then
    select * into request from public.requests where id = request_id and firm_id = target_firm and entity_type = 'office_connection' and status = 'pending';
    if request.id is null then return; end if;
    if not is_owner and request.details ->> 'person' = actor::text then raise exception 'Ask another approver'; end if;
    if not exists (select from public.devices where id = request.entity_id and firm_id = target_firm and status = 'approved') then raise exception 'PC is not approved'; end if;
    line := request.details -> 'line';
  else line := connection; end if;
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
    update public.requests set status = 'done' where firm_id = target_firm and entity_type = 'office_connection' and status = 'pending';
  elsif decision = 'forget' then lines := '[]';
  else raise exception 'Unknown decision'; end if;
  update public.firms set settings = jsonb_set(firm_settings, '{office}', office || jsonb_build_object('lines', lines)) where id = target_firm;
  if request.id is not null then update public.requests set status = 'done' where id = request.id; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    values (target_firm, actor, 'office.' || decision, 'firm', target_firm,
      case when decision = 'deputies' then jsonb_build_object('deputies', deputies, 'co_admin', co_admin) else '{}' end);
end
$$;
revoke all on function public.office_control(uuid, uuid, text, uuid, jsonb, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.office_control(uuid, uuid, text, uuid, jsonb, uuid[], uuid) to service_role;

-- The co-admin saves the access settings like the owner, through the same policy.
drop policy firms_update on public.firms;
create policy firms_update on public.firms for update to authenticated
  using (public.member_role(id) = 'owner' or public.member_role(id) = 'partner'
    and settings -> 'office' -> 'deputies' ? (select auth.uid())::text and settings -> 'office' ->> 'co_admin' = (select auth.uid())::text)
  with check (public.member_role(id) = 'owner' or public.member_role(id) = 'partner'
    and settings -> 'office' -> 'deputies' ? (select auth.uid())::text and settings -> 'office' ->> 'co_admin' = (select auth.uid())::text);

-- Through the API anyone but the owner changes only the access settings, never the
-- deputies or the co-admin. Run as the caller, so the server's own functions pass.
create function private.firms_admin_guard() returns trigger
language plpgsql set search_path = '' as $$
declare kept text[] := array['access', 'hours', 'holidays', 'special_hours', 'office', 'permissions', 'second_form_approval', 'viewer_hide_inactive'];
begin
  if current_user = 'authenticated' and public.member_role(new.id) is distinct from 'owner' and (new.name is distinct from old.name
    or new.settings - kept is distinct from old.settings - kept
    or new.settings -> 'office' -> 'deputies' is distinct from old.settings -> 'office' -> 'deputies'
    or new.settings -> 'office' -> 'co_admin' is distinct from old.settings -> 'office' -> 'co_admin') then
    raise exception 'Only the owner may change this';
  end if;
  return new;
end
$$;
create trigger firms_admin_guard before update of name, settings on public.firms for each row execute function private.firms_admin_guard();
revoke all on function private.firms_admin_guard() from public, anon, authenticated, service_role;

-- Staff kept out by Office only see whether they may ask to use their own device away from
-- the office: under the Office only and Solo CA presets they may not.
drop function if exists public.closed_firms();
create function public.closed_firms()
returns table (firm_name text, hours jsonb, reason text, away boolean)
language sql stable security definer set search_path = '' as $$
  select f.name, f.settings -> 'hours',
    case when public.session_ended() and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
           and m.role in ('staff', 'manager', 'front_desk') then 'session'
         when not public.open_to(f.settings, m.role, m.access) then 'hours'
         when not public.office_allows(f.settings, m.role) then 'office'
         else 'session' end,
    coalesce((f.settings -> 'office' ->> 'away')::boolean, true)
  from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and ((select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk')
        and (public.office_allows(f.settings, m.role) or public.session_ended())))
    and public.member_role(f.id) is null
$$;
revoke all on function public.closed_firms() from public, anon, authenticated, service_role;
grant execute on function public.closed_firms() to authenticated;
