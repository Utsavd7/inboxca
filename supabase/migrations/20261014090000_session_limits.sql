-- M0 step 12: session limits (PLAN.md 5.17, extra controls per policy). A firm can ask for
-- the 2 step code again after some hours (session_hours) and sign people out after some
-- minutes without activity (idle_minutes). The database enforces session_hours from the
-- time of the 2 step code in the sign in token; idle_minutes is the app's, since only the
-- app sees activity. Like office hours, the most specific setting wins: person, role, firm.

create function public.access_setting(settings jsonb, role text, person jsonb, key text) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(person -> key, settings -> 'access' -> 'roles' -> role -> key, settings -> 'access' -> key)
$$;

-- When this sign in passed its 2 step code, from the token's list of sign in methods.
create function public.two_step_at() returns timestamptz
language sql stable set search_path = '' as $$
  select to_timestamp(max((a ->> 'timestamp')::bigint))
  from jsonb_array_elements((select auth.jwt()) -> 'amr') a
  where a ->> 'method' = 'totp'
$$;

create or replace function public.open_to(settings jsonb, role text, person jsonb, at timestamptz default now())
returns boolean
language sql stable set search_path = '' as $$
  with here as (select at at time zone 'Asia/Kolkata' as t)
  select role = 'owner'
    or not coalesce((public.access_setting(settings, role, person, 'hours_only'))::boolean, false)
    or (not coalesce(settings -> 'holidays' ? to_char(t, 'YYYY-MM-DD'), false)
        and coalesce(to_char(t, 'HH24:MI') >= settings -> 'hours' -> extract(dow from t)::text ->> 0
                     and to_char(t, 'HH24:MI') < settings -> 'hours' -> extract(dow from t)::text ->> 1, false))
  from here
$$;

create or replace function public.member_role(target_firm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and public.open_to(f.settings, m.role, m.access)
    and coalesce(public.two_step_at() > now() - make_interval(
      hours => (public.access_setting(f.settings, m.role, m.access, 'session_hours'))::int), true)
$$;

-- Why a member sees nothing of their firm now: 'hours' (closed) or 'session' (the 2 step
-- code is due again).
drop function public.closed_firms();
create function public.closed_firms()
returns table (firm_name text, hours jsonb, reason text)
language sql stable security definer set search_path = '' as $$
  select f.name, f.settings -> 'hours',
    case when public.open_to(f.settings, m.role, m.access) then 'session' else 'hours' end
  from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and public.member_role(f.id) is null
$$;
revoke all on function public.closed_firms() from public, anon, authenticated, service_role;
grant execute on function public.closed_firms() to authenticated;
