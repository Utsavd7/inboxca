-- M7 step 9 (PLAN.md 5.17.4 #28, #48, #51): a personal device, at home or elsewhere, is refused
-- until the owner or a deputy allows it for the one person who asked, until an end date; it
-- then only views. Any approved device can be withdrawn at once.
alter table public.devices drop constraint devices_kind_check;
alter table public.devices
  add column person_id uuid references auth.users (id) on delete cascade,
  add column ends_on date,
  add constraint devices_kind_check check (kind in ('office', 'laptop', 'personal')),
  add constraint devices_personal check ((coalesce(kind, '') = 'personal') = (person_id is not null and ends_on is not null));

-- A device first used away from the office is recorded only when its person asks, and the
-- first use says so (details.away), so the approver sees what is asked.
drop function public.register_device(uuid, uuid, text, text);
create function public.register_device(target_firm uuid, actor uuid, token_digest text, label text, away boolean default false)
returns table (id uuid, status text)
language sql security definer set search_path = '' as $$
  with inserted as (
    insert into public.devices (firm_id, token_hash, name)
    values (target_firm, token_digest, label)
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
revoke all on function public.register_device(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.register_device(uuid, uuid, text, text, boolean) to service_role;

-- Decisions: office, laptop or refuse for a waiting device; personal (for its person, until a
-- date within 90 days); withdraw for an approved one. Nobody but the owner decides on a
-- device they first used themselves.
drop function public.review_devices(uuid, uuid, uuid, text);
create function public.review_devices(target_firm uuid, actor uuid, target_device uuid, decision text, until_day date default null)
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
      and (d.id = target_device or target_device = '00000000-0000-0000-0000-000000000000' and decision = 'office'
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
revoke all on function public.review_devices(uuid, uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.review_devices(uuid, uuid, uuid, text, date) to service_role;
