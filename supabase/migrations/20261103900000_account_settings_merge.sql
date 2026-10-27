-- A connected account's settings change only in the keys given, in one statement: the owner's
-- folder order and a drive reconnect each write their own keys, so neither undoes the other's.
-- Server only.
create or replace function public.merge_account_settings(account_id uuid, patch jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.connected_accounts set settings = settings || patch where id = account_id;
$$;
revoke all on function public.merge_account_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_account_settings(uuid, jsonb) to service_role;
