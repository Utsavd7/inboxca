-- M11 (PLAN.md 5.5.1 "Leaving Orelu", 8.0, 8.1): the owner downloads the firm's client list,
-- records and logs, and can close the firm. Closing signs everyone out, takes away staff
-- access, disconnects the firm's email and drive and stops waiting work; the owner can still
-- sign in and download for 30 days, then everything InboxCA keeps for the firm is deleted.
-- Client files stay in the firm's own drive and are never touched.

-- Everything the download holds. Encrypted values stay encrypted, for the server to read with
-- the firm's key. Owner only; each download is logged.
create function public.firm_export(target_firm uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if public.member_role(target_firm) is distinct from 'owner' then
    raise exception 'Only the owner downloads the firm''s data' using errcode = '42501';
  end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
    values (target_firm, (select auth.uid()), 'firm.downloaded', 'firm', target_firm);
  return jsonb_build_object(
    'clients', (select coalesce(jsonb_agg(r), '[]') from (select id, name, kind, email_enc, archived_at
      from public.clients where firm_id = target_firm order by name) r),
    'registrations', (select coalesce(jsonb_agg(r), '[]') from (select client_id, kind, number_enc, state_code
      from public.client_registrations where firm_id = target_firm) r),
    'tasks', (select coalesce(jsonb_agg(r), '[]') from (select client_id, kind, code, period_key, due_on, status
      from public.tasks where firm_id = target_firm order by due_on) r),
    'documents', (select coalesce(jsonb_agg(r), '[]') from (select client_id, name, document_type, work_type, period_key, status, received_at
      from public.documents where firm_id = target_firm order by received_at) r),
    'activity', (select coalesce(jsonb_agg(r), '[]') from (select l.at, u.email, l.action, l.entity_type, l.entity_id, l.details
      from public.activity_log l left join auth.users u on u.id = l.actor_id where l.firm_id = target_firm order by l.at) r)
  );
end;
$$;
revoke all on function public.firm_export(uuid) from public, anon;
grant execute on function public.firm_export(uuid) to authenticated;

-- The owner closes the firm by typing its name. Returns false when the name does not match
-- or the firm is already closed. The owner keeps this session to download; every other
-- session of the firm's people ends at once.
create function public.close_firm(target_firm uuid, typed_name text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if public.member_role(target_firm) is distinct from 'owner' then
    raise exception 'Only the owner closes the firm' using errcode = '42501';
  end if;
  update public.firms set status = 'closed'
  where id = target_firm and status <> 'closed' and lower(btrim(name)) = lower(btrim(typed_name));
  if not found then return false; end if;
  update public.firm_members set status = 'deactivated' where firm_id = target_firm and role <> 'owner';
  delete from public.connected_accounts where firm_id = target_firm;
  update public.jobs set state = 'cancelled' where firm_id = target_firm and state = 'pending';
  delete from auth.sessions s using public.firm_members m
  where m.firm_id = target_firm and s.user_id = m.user_id
    and s.id is distinct from nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
    values (target_firm, (select auth.uid()), 'firm.closed', 'firm', target_firm);
  -- No firm on the job, so it outlives the firm and its finished row records the deletion.
  insert into public.jobs (kind, entity_type, entity_id, run_at, idempotency_key)
    values ('delete_firm', 'firm', target_firm, now() + interval '30 days', 'delete_firm:' || target_firm);
  return true;
end;
$$;
revoke all on function public.close_firm(uuid, text) from public, anon;
grant execute on function public.close_firm(uuid, text) to authenticated;

-- Thirty days after closing: the firm and everything under it, its log included, and the
-- logins of its people who belong to no other firm. Server only.
create function public.delete_firm(target_firm uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  people uuid[];
begin
  if not exists (select 1 from public.firms where id = target_firm and status = 'closed')
    or not exists (select 1 from public.activity_log where firm_id = target_firm and action = 'firm.closed'
      and at <= now() - interval '30 days') then
    return false;
  end if;
  select array_agg(m.user_id) into people from public.firm_members m
  where m.firm_id = target_firm
    and not exists (select 1 from public.firm_members o where o.user_id = m.user_id and o.firm_id <> target_firm);
  perform set_config('app.log_purge', 'on', true);
  delete from public.firms where id = target_firm;
  perform set_config('app.log_purge', 'off', true);
  delete from auth.users where id = any(people);
  return true;
end;
$$;
revoke all on function public.delete_firm(uuid) from public, anon, authenticated;
grant execute on function public.delete_firm(uuid) to service_role;
