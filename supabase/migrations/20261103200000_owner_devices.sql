-- The owner's login on approved computers only (PLAN.md D38, 5.14, 5.17): each new computer that
-- signs in to the owner's login waits until the owner approves it from a computer already signed
-- in, and the login in use on several computers at once tells the owner, once a day.
-- * The computers the owner approved are kept as short keyed digests of their random device
--   cookie (inboxca_device) in the owner's app_metadata.devices, which only the server writes and
--   which travels in their sign in token; nothing about the computer itself is kept.
-- * A computer asking is one requests row (kind alert, entity_type owner_device) for its sign in
--   session, open 30 minutes; no new table or column.

-- The server's proof that this request comes from one of the owner's approved computers, good for
-- 5 minutes, for this person and a session that still exists, signed like the office proof, so a
-- computer removed (its sessions ended) reaches nothing at once. An owner with no approved
-- computer yet needs none: the first computer is approved by itself, as the server does.
create or replace function private.device_allows(member_role text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  proof text := current_setting('request.headers', true)::json ->> 'x-inboxca-device';
  until bigint;
begin
  if member_role <> 'owner' or jsonb_array_length(coalesce((select auth.jwt()) -> 'app_metadata' -> 'devices', '[]')) = 0 then
    return true;
  end if;
  if proof is null or proof !~ '^[0-9]{1,12}\.[0-9a-f]{64}$' then
    return false;
  end if;
  until := split_part(proof, '.', 1)::bigint;
  return until >= extract(epoch from now())
    and public.session_live()
    and split_part(proof, '.', 2) = encode(extensions.hmac(
      'device:' || (select auth.uid())::text || ':' || coalesce((select auth.jwt() ->> 'session_id'), '') || ':' || until,
      public.office_proof_key(), 'sha256'), 'hex');
end;
$$;
revoke all on function private.device_allows(text) from public, anon, authenticated;

-- As in 20261031200000_access_leftovers.sql, with the owner's approved computers.
create or replace function public.member_role(target_firm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.firm_members m
    cross join lateral (select private.branch_settings(f.settings, m.branch_id) as settings from public.firms f where f.id = m.firm_id) f
  where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active'
    and target_firm = coalesce(private.request_firm(), target_firm)
    and (
      (select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and not coalesce((f.settings -> 'office' ->> 'anywhere')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk'))
    )
    and public.open_to(f.settings, m.role, m.access)
    and coalesce((case when (select auth.jwt() ->> 'aal') = 'aal1' then
      (select to_timestamp(max((a ->> 'timestamp')::bigint))
       from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]')) a)
      else public.two_step_at() end) > now() - make_interval(
        hours => (public.access_setting(f.settings, m.role, m.access, 'session_hours'))::int), true)
    and public.office_allows(f.settings, m.role)
    and private.country_allows(f.settings, m.role, m.access)
    and private.device_allows(m.role)
$$;

-- The owner's answer for a computer asking, from one of their approved computers (so never the
-- computer asking), while the request is open. True when it was answered.
create or replace function public.review_owner_device(request uuid, decision text) returns boolean
language sql volatile security definer set search_path = '' as $$
  with changed as (
    update public.requests r set status = case when decision = 'approve' then 'approved' else 'refused' end
    where r.id = request and r.kind = 'alert' and r.entity_type = 'owner_device' and r.status = 'pending'
      and decision in ('approve', 'refuse') and r.expires_at > now()
      and r.details ->> 'by' = (select auth.uid())::text
      and r.entity_id is distinct from nullif((select auth.jwt() ->> 'session_id'), '')::uuid
      and public.member_role(r.firm_id) = 'owner'
    returning r.firm_id, r.id
  )
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
    select firm_id, (select auth.uid()), case when decision = 'approve' then 'device.approved' else 'device.refused' end, 'owner_device', id
    from changed
  returning true
$$;
revoke all on function public.review_owner_device(uuid, text) from public, anon;
grant execute on function public.review_owner_device(uuid, text) to authenticated;

-- Only the owner reads their own computers' requests and alerts.
drop policy if exists owner_requests_read on public.requests;
create policy owner_requests_read on public.requests as restrictive for select to authenticated
  using (entity_type not in ('owner_device', 'owner_pcs') or details ->> 'by' = (select auth.uid())::text);

-- The owner is told of both at once, by phone notification and email (src/jobs/notify.ts).
drop trigger if exists requests_notice on public.requests;
create trigger requests_notice after insert or update of status, details on public.requests
  for each row when (new.status = 'pending' and (new.kind = 'permission' or new.entity_type in ('office_connection', 'owner_device', 'owner_pcs')))
  execute function private.queue_request_notice();

-- The owner's login in use on 2 or more computers within the hour: signed in sessions used in the
-- last hour, leaving out those on a computer still waiting, refused or never approved. Raised once
-- a day.
create or replace function private.owner_pcs_alerts() returns void
language sql security definer set search_path = '' as $$
  insert into public.requests (firm_id, kind, entity_type, entity_id, reason_code, details)
  select distinct on (m.user_id) m.firm_id, 'alert', 'owner_pcs', m.user_id, 'owner_pcs',
    jsonb_build_object('by', m.user_id, 'day', (now() at time zone 'Asia/Kolkata')::date, 'count', used.n)
  from public.firm_members m
    cross join lateral (select count(*) as n from auth.sessions s
      where s.user_id = m.user_id and s.aal = 'aal2'
        and greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'UTC') > now() - interval '1 hour'
        and not exists (select from public.requests r where r.kind = 'alert' and r.entity_type = 'owner_device'
          and r.entity_id = s.id and r.status in ('pending', 'refused'))) used
  where m.role = 'owner' and m.status = 'active' and used.n >= 2
  order by m.user_id, m.firm_id
  on conflict (kind, entity_type, entity_id) do update set firm_id = excluded.firm_id, details = excluded.details, status = 'pending'
    where public.requests.details ->> 'day' is distinct from excluded.details ->> 'day'
$$;
revoke all on function private.owner_pcs_alerts() from public, anon, authenticated, service_role;
select cron.schedule('owner-pcs', '*/10 * * * *', 'select private.owner_pcs_alerts()');
