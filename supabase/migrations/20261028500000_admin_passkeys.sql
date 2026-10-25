-- Orelu admins use passkeys (PLAN.md 8.1, 8.10): after the email code and the 2 step code an
-- admin checks a passkey, and only then does the console open, for that sign in session and an
-- hour at most. Only each passkey's public key and signature counter are kept; the server
-- checks the passkey (src/lib/pc-key.ts) and then sends the database a short proof with every
-- console request, signed like the office proof (office_allows).
create table if not exists public.admin_passkeys (
  id text primary key check (length(id) <= 400),
  user_id uuid not null references public.orelu_admins (user_id) on delete cascade,
  public_key text not null check (length(public_key) <= 400),
  counter bigint not null default 0
);
create index if not exists admin_passkeys_user on public.admin_passkeys (user_id);
alter table public.admin_passkeys enable row level security;
revoke all on public.admin_passkeys from anon, authenticated;

-- Orelu's own events (an admin's passkeys added, used or removed) belong to no firm: no firm's
-- owner reads them, and they go with the log's 36 month partitions.
alter table public.activity_log alter column firm_id drop not null;

-- A listed admin past the 2 step code, with a current passkey proof for this person and session.
create or replace function public.is_orelu_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  proof text := current_setting('request.headers', true)::json ->> 'x-orelu-admin';
  session text := coalesce((select auth.jwt() ->> 'session_id'), '');
  until bigint;
begin
  if coalesce((select auth.jwt() ->> 'aal') = 'aal2', false) is false or session = ''
    or proof is null or proof !~ '^[0-9]{1,12}\.[0-9a-f]{64}$'
    or not exists (select 1 from public.orelu_admins where user_id = (select auth.uid())) then
    return false;
  end if;
  until := split_part(proof, '.', 1)::bigint;
  return until >= extract(epoch from now())
    and public.session_live()
    and split_part(proof, '.', 2) = encode(extensions.hmac(
      'admin:' || (select auth.uid())::text || ':' || session || ':' || until,
      public.office_proof_key(), 'sha256'), 'hex');
end;
$$;

-- Every admin and how many passkeys each has.
create or replace function public.admin_people()
returns table (user_id uuid, email text, passkeys int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select a.user_id, u.email::text, (select count(*)::int from public.admin_passkeys k where k.user_id = a.user_id)
  from public.orelu_admins a join auth.users u on u.id = a.user_id
  order by u.email;
end;
$$;

-- Recovery: another admin removes an admin's passkeys and signs them out everywhere, so a lost
-- or stolen passkey opens nothing more. They set up a new one after the email and 2 step codes.
create or replace function public.admin_remove_passkeys(person uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  removed integer;
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  if person = (select auth.uid()) then raise exception 'Another admin removes your passkeys' using errcode = '42501'; end if;
  delete from public.admin_passkeys where user_id = person;
  get diagnostics removed = row_count;
  delete from auth.sessions where user_id = person;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'admin.passkeys_removed', 'admin', person, jsonb_build_object('removed', removed));
  return removed;
end;
$$;

revoke all on function public.admin_people(), public.admin_remove_passkeys(uuid) from public, anon;
grant execute on function public.admin_people(), public.admin_remove_passkeys(uuid) to authenticated;
