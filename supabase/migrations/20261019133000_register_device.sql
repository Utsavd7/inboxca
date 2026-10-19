-- A PC and its first use activity entry are written together. A repeated request returns
-- the existing PC without writing a second first use entry.
create function public.register_device(target_firm uuid, actor uuid, token_digest text, label text)
returns table (id uuid, status text)
language sql security definer set search_path = '' as $$
  with inserted as (
    insert into public.devices (firm_id, token_hash, name)
    values (target_firm, token_digest, label)
    on conflict (token_hash) do nothing
    returning devices.id, devices.status
  ), logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
    select target_firm, actor, 'device.first_seen', 'device', inserted.id from inserted
    returning entity_id
  )
  select inserted.id, inserted.status from inserted join logged on logged.entity_id = inserted.id
  union all
  select devices.id, devices.status from public.devices
  where devices.firm_id = target_firm and devices.token_hash = token_digest
    and not exists (select from inserted)
$$;
revoke all on function public.register_device(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_device(uuid, uuid, text, text) to service_role;
