-- M1 step 2: editing, numbers and archiving. The owner, a partner or a manager changes a
-- client's name and kind, adds or removes its numbers, and archives or restores it; staff
-- view only. One trigger logs every change to clients and their numbers, whichever way it
-- is made (column names and the kind of number only, never a number).

alter table public.clients add column archived_at timestamptz;

create function public.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
begin
  -- Deleting a whole firm removes its clients too; that is not a change to log.
  if not exists (select 1 from public.firms where id = (row ->> 'firm_id')::uuid) then
    return null;
  end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values ((row ->> 'firm_id')::uuid, (select auth.uid()),
    tg_argv[0] || case tg_op when 'INSERT' then '.added' when 'DELETE' then '.removed' else '.changed' end,
    'client', (row ->> tg_argv[1])::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('changed',
      (select jsonb_agg(key) from jsonb_each(to_jsonb(new)) n where n.value is distinct from to_jsonb(old) -> n.key))
    else jsonb_strip_nulls(jsonb_build_object('kind', row ->> 'kind')) end);
  return null;
end;
$$;
create trigger clients_logged after insert or update or delete on public.clients
  for each row execute function public.log_change('client', 'id');
create trigger client_registrations_logged after insert or delete on public.client_registrations
  for each row execute function public.log_change('registration', 'client_id');

-- add_client no longer writes its own log line: the trigger does.
create or replace function public.add_client(target_firm uuid, client uuid, client_name text, client_kind text, registrations jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') then
    return false;
  end if;
  insert into public.clients (id, firm_id, name, kind) values (client, target_firm, client_name, client_kind);
  insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code)
  select target_firm, client, r ->> 'kind', r ->> 'number_enc', r ->> 'number_bidx', r ->> 'state_code'
  from jsonb_array_elements(registrations) r;
  return true;
end;
$$;

grant update (name, kind, archived_at) on public.clients to authenticated;
grant insert (firm_id, client_id, kind, number_enc, number_bidx, state_code), delete on public.client_registrations to authenticated;
create policy clients_update on public.clients for update to authenticated
  using (public.member_role(firm_id) in ('owner', 'partner', 'manager'))
  with check (public.member_role(firm_id) in ('owner', 'partner', 'manager'));
create policy registrations_insert on public.client_registrations for insert to authenticated
  with check (public.member_role(firm_id) in ('owner', 'partner', 'manager'));
create policy registrations_delete on public.client_registrations for delete to authenticated
  using (public.member_role(firm_id) in ('owner', 'partner', 'manager'));
