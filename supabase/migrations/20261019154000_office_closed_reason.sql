-- Email-only office staff also see why their firm is closed, without widening access.
create or replace function public.closed_firms()
returns table (firm_name text, hours jsonb, reason text)
language sql stable security definer set search_path = '' as $$
  select f.name, f.settings -> 'hours',
    case when not public.open_to(f.settings, m.role, m.access) then 'hours'
         when not public.office_allows(f.settings, m.role) then 'office'
         else 'session' end
  from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and ((select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk') and public.office_allows(f.settings, m.role)))
    and public.member_role(f.id) is null
$$;
