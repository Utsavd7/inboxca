-- M0 step 4: firm data needs a 2 step sign in (PLAN.md 4.4: valid session and 2FA first).
-- Every policy reads member_role(), so requiring the second step here closes every table
-- at once: a session that has only passed the email code (aal1) sees nothing of any firm.

create or replace function public.member_role(target_firm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.firm_members m
  where m.firm_id = target_firm
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and (select auth.jwt() ->> 'aal') = 'aal2'
$$;
