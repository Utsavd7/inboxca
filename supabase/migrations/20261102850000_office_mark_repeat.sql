-- Office follow-up #38 (PLAN.md 5.17.4): a "Not my office" now names the PC in its log line
-- (details.device), so refusals are counted per PC, and a PC that stays in the office loses
-- that mark when its connection is refused a second time in 30 days, as it already did when
-- its own confirmation was refused; the log line says so (details.unmarked). As in
-- 20261031200000_access_leftovers.sql otherwise.
create or replace function public.office_control(target_firm uuid, actor uuid, decision text,
  request_id uuid default null, connection jsonb default null, deputies uuid[] default null, co_admin uuid default null,
  branch uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare firm_settings jsonb; office jsonb; line jsonb; lines jsonb; request public.requests; is_owner boolean; closes timestamptz; unmarked boolean;
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
    -- A PC that stays in the office loses that mark when its own confirmation is refused, or
    -- when its connection is refused a second time in 30 days (5.17.4 #38).
    if request.reason_code = 'office_changed' or exists (select from public.activity_log a where a.firm_id = target_firm
        and a.action = 'office.refuse' and a.details ->> 'device' = request.entity_id::text and a.at > now() - interval '30 days') then
      update public.devices set kind = 'laptop' where firm_id = target_firm and id = request.entity_id and kind = 'office';
      unmarked := found;
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
        when decision = 'refuse' and request.id is not null then jsonb_strip_nulls(jsonb_build_object('branch', branch, 'device', request.entity_id, 'unmarked', nullif(unmarked, false)))
        when branch is not null then jsonb_build_object('branch', branch) else '{}' end);
end
$$;
