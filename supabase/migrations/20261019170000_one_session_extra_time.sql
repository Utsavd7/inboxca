-- M7 step 8 (PLAN.md 5.17.1, 5.17.4 #3, #14, #15, #39, #56): under Office only a person bound
-- by it has one session at a time, and staying past closing is one person's extra time today.

-- A sign in ends the person's other sessions, so a login shared with a colleague or left open
-- on another PC stops working. Only for staff, managers and front desk under Office only; the
-- owner and partners keep their phone and laptop. Returns how many sessions ended.
create function public.end_other_sessions() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  ended integer;
begin
  if not exists (
    select 1 from public.firm_members m join public.firms f on f.id = m.firm_id
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role in ('staff', 'manager', 'front_desk')
      and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
  ) then
    return 0;
  end if;
  delete from auth.sessions
  where user_id = (select auth.uid()) and id <> nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
  get diagnostics ended = row_count;
  return ended;
end;
$$;
revoke all on function public.end_other_sessions() from public, anon;
grant execute on function public.end_other_sessions() to authenticated;

-- Whether this request's sign in session still exists; an ended one is deleted at once.
create function public.session_live() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions s where s.id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid)
$$;
revoke all on function public.session_live() from public, anon;
grant execute on function public.session_live() to authenticated;

-- A session that had an id and was ended since.
create function public.session_ended() returns boolean
language sql stable set search_path = '' as $$
  select (select auth.jwt() ->> 'session_id') is not null and not public.session_live()
$$;

-- The office proof now also needs the session to still exist, so an ended session reaches
-- nothing at once, without waiting for its token to run out.
create or replace function public.office_allows(settings jsonb, member_role text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  proof text := current_setting('request.headers', true)::json ->> 'x-inboxca-office';
  session text := coalesce((select auth.jwt() ->> 'session_id'), '');
  until bigint;
begin
  if coalesce((settings -> 'office' ->> 'on')::boolean, false) is false or member_role not in ('staff', 'manager', 'front_desk') then
    return true;
  end if;
  if proof is null or proof !~ '^[0-9]+\.[0-9a-f]{64}$' or session = '' then
    return false;
  end if;
  until := split_part(proof, '.', 1)::bigint;
  return until >= extract(epoch from now())
    and public.session_live()
    and split_part(proof, '.', 2) = encode(extensions.hmac(
      (select auth.uid())::text || ':' || session || ':' || until,
      public.office_proof_key(), 'sha256'), 'hex');
end;
$$;

-- Extra time today: firm_members.access.extra_time {day, until}, written by the server when
-- the person stays one more hour or the owner allows more time. It reopens the firm for that
-- person until then, that day only.
create or replace function public.open_to(settings jsonb, role text, person jsonb, at timestamptz default now())
returns boolean
language sql stable set search_path = '' as $$
  with here as (select at at time zone 'Asia/Kolkata' as t),
  today as (
    select t, to_char(t, 'YYYY-MM-DD') as day, to_char(t, 'HH24:MI') as now_at,
      coalesce(
        (select jsonb_build_array(s ->> 'open', s ->> 'close')
         from jsonb_array_elements(coalesce(settings -> 'special_hours', '[]')) s
         where to_char(t, 'YYYY-MM-DD') between s ->> 'from' and s ->> 'to'
         limit 1),
        settings -> 'hours' -> extract(dow from t)::text) as times
    from here
  )
  select role = 'owner'
    or not coalesce((public.access_setting(settings, role, person, 'hours_only'))::boolean, false)
    or (not coalesce(settings -> 'holidays' ? day, false)
        and coalesce(now_at >= times ->> 0 and now_at < times ->> 1, false))
    or coalesce(person -> 'extra_time' ->> 'day' = day and now_at >= coalesce(times ->> 0, '00:00')
        and now_at < person -> 'extra_time' ->> 'until', false)
  from today
$$;

-- An ended session is told so and signed out, rather than told to come to the office.
create or replace function public.closed_firms()
returns table (firm_name text, hours jsonb, reason text)
language sql stable security definer set search_path = '' as $$
  select f.name, f.settings -> 'hours',
    case when public.session_ended() and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
           and m.role in ('staff', 'manager', 'front_desk') then 'session'
         when not public.open_to(f.settings, m.role, m.access) then 'hours'
         when not public.office_allows(f.settings, m.role) then 'office'
         else 'session' end
  from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
    and ((select auth.jwt() ->> 'aal') = 'aal2'
      or ((select auth.jwt() ->> 'aal') = 'aal1'
        and coalesce((f.settings -> 'office' ->> 'on')::boolean, false)
        and m.role in ('staff', 'manager', 'front_desk')
        and (public.office_allows(f.settings, m.role) or public.session_ended())))
    and public.member_role(f.id) is null
$$;
