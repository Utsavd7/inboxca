-- A recovery code is spent in one statement (security S7): the row lock makes a second request
-- at the same moment find the code gone. The codes left, or null when none of the digests (one
-- per app key, current and old) is saved. Server only.
create or replace function public.spend_recovery_code(person uuid, digests text[]) returns integer
language sql volatile security definer set search_path = '' as $$
  update auth.users set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{recovery}',
    coalesce((select jsonb_agg(kept) from jsonb_array_elements_text(raw_app_meta_data -> 'recovery') kept where kept <> all (digests)), '[]'::jsonb))
  where id = person and raw_app_meta_data -> 'recovery' ?| digests
  returning jsonb_array_length(raw_app_meta_data -> 'recovery');
$$;
revoke all on function public.spend_recovery_code(uuid, text[]) from public, anon, authenticated;
grant execute on function public.spend_recovery_code(uuid, text[]) to service_role;
