-- A person in two firms works in one at a time: the app names the firm it chose in the
-- x-inboxca-firm request header (src/lib/member.ts), and every access check, all through
-- member_role, then sees that firm only, so one firm's lists and counts never show the
-- other's. The header only narrows what the person may see, never widens it; without it
-- (the server's own calls) nothing changes.
create or replace function private.request_firm() returns uuid
language sql stable set search_path = '' as $$
  select case when firm ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then firm::uuid end
  from (select current_setting('request.headers', true)::json ->> 'x-inboxca-firm' as firm) request
$$;
revoke all on function private.request_firm() from public, anon, authenticated;

-- As in 20261028600000_branch_office.sql, with the request's firm.
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
