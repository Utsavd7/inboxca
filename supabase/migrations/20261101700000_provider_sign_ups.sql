-- Continue with Google or Microsoft: Supabase Auth makes a login for a new address only through
-- those two (config.toml turns sign ups on for them). Its before user created hook refuses
-- every other way, a password or an email code, so people are otherwise still added only by
-- the server: by their firm's owner and by the sign up page.
create or replace function private.only_provider_sign_ups(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when event #>> '{user,app_metadata,provider}' in ('google', 'azure') then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign up with Google or Microsoft, or on the sign up page.'))
  end
$$;

revoke all on function private.only_provider_sign_ups(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.only_provider_sign_ups(jsonb) to supabase_auth_admin;
