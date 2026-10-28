-- A private paper's one-time code (app/s/[token]/actions.ts): each try is counted and checked in
-- one statement, so many guesses sent at once still get only `tries` between them. A right code
-- is used up. Answers 'right', 'wrong' while tries are left, or 'again' once a new code is needed
-- (out of tries, expired or none). Server only.
create or replace function public.try_share_code(share uuid, hash text, tries int)
returns text
language sql
security definer
set search_path = ''
as $$
  with tried as (
    update public.shares s set code_attempts = s.code_attempts + 1,
      code_hash = case when s.code_hash = hash then null else s.code_hash end,
      code_expires_at = case when s.code_hash = hash then null else s.code_expires_at end
    where s.id = share and s.code_hash is not null and s.code_expires_at > now() and s.code_attempts < tries
    returning case when s.code_hash is null then 'right' when s.code_attempts < tries then 'wrong' else 'again' end as answer
  )
  select coalesce((select answer from tried), 'again')
$$;
revoke all on function public.try_share_code(uuid, text, int) from public, anon, authenticated;
grant execute on function public.try_share_code(uuid, text, int) to service_role;
