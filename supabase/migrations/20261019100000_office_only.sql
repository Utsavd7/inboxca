-- M7 step 1: the Office only switch (PLAN.md 5.8, 5.17.3). With it on, staff, managers and
-- front desk reach the firm only from a confirmed office connection. The app server sees the
-- connection, so it is the server that vouches for it: on each request from an office line
-- it sends the database a short proof, signed with a key only the server and the database
-- hold, bound to the person and their session and good for a few minutes. member_role checks
-- it, so a session token alone, used from anywhere else, reaches nothing. The owner and
-- partners are not bound by the switch. The office lines live in firms.settings.office.

-- The signing key, made here at random; it is in no file and only the server reads it.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'office_proof_key', 'Signs the office proofs the app server sends with staff requests');

create function public.office_proof_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'office_proof_key'
$$;
revoke all on function public.office_proof_key() from public, anon, authenticated;
grant execute on function public.office_proof_key() to service_role;

-- Whether this request may reach the firm under the switch: always when the switch is off or
-- the role is not bound by it, else only with a current, valid proof for this person and session.
create function public.office_allows(settings jsonb, member_role text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  proof text := current_setting('request.headers', true)::json ->> 'x-inboxca-office';
  until bigint;
begin
  if coalesce((settings -> 'office' ->> 'on')::boolean, false) is false or member_role not in ('staff', 'manager', 'front_desk') then
    return true;
  end if;
  if proof is null or proof !~ '^[0-9]+\.[0-9a-f]{64}$' then
    return false;
  end if;
  until := split_part(proof, '.', 1)::bigint;
  return until >= extract(epoch from now())
    and split_part(proof, '.', 2) = encode(extensions.hmac(
      (select auth.uid())::text || ':' || coalesce((select auth.jwt() ->> 'session_id'), '') || ':' || until,
      public.office_proof_key(), 'sha256'), 'hex');
end;
$$;
revoke all on function public.office_allows(jsonb, text) from public, anon;
grant execute on function public.office_allows(jsonb, text) to authenticated;

create or replace function public.member_role(target_firm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and public.open_to(f.settings, m.role, m.access)
    and coalesce(public.two_step_at() > now() - make_interval(
      hours => (public.access_setting(f.settings, m.role, m.access, 'session_hours'))::int), true)
    and public.office_allows(f.settings, m.role)
$$;

-- Why a member sees nothing now: outside hours, away from the office, or a session to end.
create or replace function public.closed_firms()
returns table (firm_name text, hours jsonb, reason text)
language sql stable security definer set search_path = '' as $$
  select f.name, f.settings -> 'hours',
    case when not public.open_to(f.settings, m.role, m.access) then 'hours'
         when not public.office_allows(f.settings, m.role) then 'office'
         else 'session' end
  from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and public.member_role(f.id) is null
$$;
