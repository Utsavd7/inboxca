-- M7 step 3: an approved office PC is the second sign in proof for Office only staff.
alter table public.connected_accounts add column address_bidx text;
create index connected_accounts_mail_address on public.connected_accounts (firm_id, address_bidx)
  where kind = 'mail';
grant insert (address_bidx) on public.connected_accounts to authenticated;

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
    and coalesce(public.two_step_at() > now() - make_interval(
      hours => (public.access_setting(f.settings, m.role, m.access, 'session_hours'))::int), true)
    and public.office_allows(f.settings, m.role)
$$;
