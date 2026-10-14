-- M0 step 11: office hours, the "When" of access policies (PLAN.md 5.17, D17). A firm can
-- let its people use InboxCA only during office hours. The database enforces it in
-- member_role, so outside hours nothing of the firm is shown or changed, whatever the app
-- does. The owner is never locked out. No new columns:
--   firms.settings -> 'hours'    {"1": ["09:00", "18:00"], ...}  weekday (0 is Sunday) to
--                                 opening and closing time, India time; a missing day is closed
--   firms.settings -> 'holidays' ["2026-11-01", ...]
--   firms.settings -> 'access'   {"hours_only": true, "roles": {"partner": {"hours_only": false}}}
--   firm_members.access          {"hours_only": false}, one person's exception
-- The most specific setting wins: person, then role, then the firm.

-- Whether a person with this role and these exceptions may use the firm at this moment.
create function public.open_to(settings jsonb, role text, person jsonb, at timestamptz default now())
returns boolean
language sql stable set search_path = '' as $$
  with here as (select at at time zone 'Asia/Kolkata' as t)
  select role = 'owner'
    or not coalesce((person ->> 'hours_only')::boolean,
                    (settings -> 'access' -> 'roles' -> role ->> 'hours_only')::boolean,
                    (settings -> 'access' ->> 'hours_only')::boolean, false)
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
$$;

-- For the message a person sees outside hours: the firms that are closed to them now,
-- with their hours.
create function public.closed_firms()
returns table (firm_name text, hours jsonb)
language sql stable security definer set search_path = '' as $$
  select f.name, f.settings -> 'hours'
  from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and not public.open_to(f.settings, m.role, m.access)
$$;
revoke all on function public.closed_firms() from public, anon, authenticated, service_role;
grant execute on function public.closed_firms() to authenticated;

-- Every change to a firm's name or settings is logged, with the settings it touched, so
-- policy changes are on record whichever way they are made.
create function public.firms_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values (new.id, (select auth.uid()), 'firm.changed', 'firm', new.id, jsonb_build_object(
    'name', new.name is distinct from old.name,
    'settings', (select coalesce(jsonb_agg(key), '[]') from jsonb_object_keys(new.settings || old.settings) key
                 where new.settings -> key is distinct from old.settings -> key)));
  return new;
end;
$$;
create trigger firms_changed after update of name, settings on public.firms
  for each row when (new.name is distinct from old.name or new.settings is distinct from old.settings)
  execute function public.firms_changed();
