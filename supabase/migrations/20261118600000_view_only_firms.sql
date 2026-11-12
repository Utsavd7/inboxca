-- A firm that is closed, or that may only view until it pays (read_only), is changed only through
-- InboxCA's own server, which refuses there (src/lib/member.ts currentWriter). Before, its people
-- could still write by calling the database directly with their own sign in token: row level
-- security and the definer functions look at the member, not at the firm's status (deep audit,
-- 11 Nov 2026). Now such a request runs in a read only transaction, so nothing it reaches, a
-- table or a function, can write. Reads, and so the firm's download, are untouched, and no other
-- firm's request changes at all.

-- Whether the request came through InboxCA's server: its proof for this person and session, made
-- with the server's own key as the office and device proofs are (src/lib/supabase.ts).
create or replace function private.app_request() returns boolean
language plpgsql stable set search_path = '' as $$
declare
  proof text := current_setting('request.headers', true)::json ->> 'x-inboxca-app';
  until bigint;
begin
  if proof is null or proof !~ '^[0-9]{1,12}\.[0-9a-f]{64}$' then
    return false;
  end if;
  until := split_part(proof, '.', 1)::bigint;
  return until >= extract(epoch from now())
    and split_part(proof, '.', 2) = encode(extensions.hmac(
      'app:' || (select auth.uid())::text || ':' || coalesce((select auth.jwt() ->> 'session_id'), '') || ':' || until,
      public.office_proof_key(), 'sha256'), 'hex');
end;
$$;
revoke all on function private.app_request() from public, anon, authenticated;

-- Whether the signed in person is held to reading: someone of a closed or read only firm,
-- whichever firm the request names (some functions find the member themselves), whose request
-- did not come through InboxCA's server.
create or replace function public.view_only_request() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.firm_members m join public.firms f on f.id = m.firm_id
      where m.user_id = (select auth.uid()) and m.status = 'active' and f.status in ('closed', 'read_only'))
    and not private.app_request()
$$;
revoke all on function public.view_only_request() from public, anon;
grant execute on function public.view_only_request() to authenticated;

-- Run by the API before every request (pgrst.db_pre_request), as the request's own role. A
-- visitor and the server's own access pass straight through.
create or replace function public.guard_request() returns void
language plpgsql set search_path = '' as $$
begin
  -- Two steps, so the second is never tried for a visitor, who may not call it.
  if (select auth.role()) = 'authenticated' then
    if public.view_only_request() then
      perform set_config('transaction_read_only', 'on', true);
    end if;
  end if;
end;
$$;
revoke all on function public.guard_request() from public;
grant execute on function public.guard_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.guard_request';
notify pgrst, 'reload config';
