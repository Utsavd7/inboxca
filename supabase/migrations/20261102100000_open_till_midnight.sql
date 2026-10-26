-- Office hours that close at 23:59, the latest time Settings offers, mean open to the end of
-- the day: before, the last minute of the day counted as closed, so a firm open all day refused
-- its staff from 23:59 to midnight. Otherwise as in 20261019170000_one_session_extra_time.sql.
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
        and coalesce(now_at >= times ->> 0 and (now_at < times ->> 1 or times ->> 1 = '23:59'), false))
    or coalesce(person -> 'extra_time' ->> 'day' = day and now_at >= coalesce(times ->> 0, '00:00')
        and (now_at < person -> 'extra_time' ->> 'until' or person -> 'extra_time' ->> 'until' = '23:59'), false)
  from today
$$;
