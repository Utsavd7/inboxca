-- Review of M7 step 3: an email code only session's limit counts from its latest sign in,
-- whatever its method, so a sign in recorded under another name than otp can never leave
-- the session without a limit.
create or replace function public.member_role(target_firm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active'
    and (
      (select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk'))
    )
    and public.open_to(f.settings, m.role, m.access)
    and coalesce((case when (select auth.jwt() ->> 'aal') = 'aal1' then
      (select to_timestamp(max((a ->> 'timestamp')::bigint))
       from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]')) a)
      else public.two_step_at() end) > now() - make_interval(
        hours => (public.access_setting(f.settings, m.role, m.access, 'session_hours'))::int), true)
    and public.office_allows(f.settings, m.role)
$$;
