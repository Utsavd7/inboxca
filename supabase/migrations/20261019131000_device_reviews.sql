-- The server changes a waiting PC and writes its activity entry in the same statement.
create function public.review_devices(target_firm uuid, actor uuid, target_device uuid, decision text) returns void
language sql security definer set search_path = '' as $$
  with changed as (
    update public.devices
    set status = case when decision = 'refuse' then 'refused' else 'approved' end,
        kind = case when decision in ('office', 'laptop') then decision else null end
    where firm_id = target_firm and status = 'waiting'
      and decision in ('office', 'laptop', 'refuse')
      and (id = target_device or target_device is null and decision = 'office')
    returning id
  )
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  select target_firm, actor,
    case when decision = 'refuse' then 'device.refused' else 'device.approved' end,
    'device', id, jsonb_build_object('kind', decision)
  from changed
$$;
revoke all on function public.review_devices(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.review_devices(uuid, uuid, uuid, text) to service_role;
