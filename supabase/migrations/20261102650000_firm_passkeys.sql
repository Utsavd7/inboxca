-- Passkeys for firm people (PLAN.md 5.17, 8.5): anyone in a firm may add one in Settings and use
-- it at sign in in place of the 6 digit code, after the email code as before. Each passkey has
-- its own 2 step factor in Supabase Auth, whose secret only the server holds, sealed by the
-- outer key (src/lib/crypto.ts), and answers only after checking the passkey (src/lib/pc-key.ts).
-- So a passkey sign in is a 2 step sign in to every check (aal2, two_step_at(), the session
-- limits, the office rules), with none of them changed. As for Orelu admins' passkeys, only each
-- passkey's public key and signature counter are kept; the server alone reads this table.
create table if not exists public.passkeys (
  id text primary key check (length(id) <= 400),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The factor removed (a recovery code removes them all) takes its passkey with it.
  factor_id uuid not null unique references auth.mfa_factors (id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  public_key text not null check (length(public_key) <= 400),
  counter bigint not null default 0,
  secret text not null check (length(secret) <= 1000),
  unique (user_id, name)
);
alter table public.passkeys enable row level security;
revoke all on public.passkeys from anon, authenticated;

-- A passkey removed, by its person or by the owner: its factor goes too, and every sign in made
-- with it ends at once, so a lost device opens nothing more. A person removing their own keeps
-- the session they remove it from (x-inboxca-keep-session, which only the server can send, as
-- nobody else may remove a passkey).
create or replace function private.passkey_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.sessions where factor_id = old.factor_id
    and id::text is distinct from nullif(current_setting('request.headers', true), '')::json ->> 'x-inboxca-keep-session';
  delete from auth.mfa_factors where id = old.factor_id;
  return null;
end;
$$;
revoke all on function private.passkey_removed() from public, anon, authenticated;
drop trigger if exists passkey_removed on public.passkeys;
create trigger passkey_removed after delete on public.passkeys
  for each row execute function private.passkey_removed();
