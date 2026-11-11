-- A sign in session that has ended (signed out, ended by the one session rule, an idle or
-- session limit, a removed computer) reaches nothing of the firm at once, for everyone. Before,
-- only people the office switch binds and owners with approved computers were checked
-- (office_allows, device_allows); anyone else kept their token for up to an hour after signing
-- out (security audit). As in 20261103200000_owner_devices.sql, with the last line added.
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
    and not public.session_ended()
$$;
