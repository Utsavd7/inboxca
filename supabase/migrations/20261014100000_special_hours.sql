-- M0 step 13: special hours (PLAN.md 5.17: temporary extended hours and Season hours). One
-- idea covers both: a date range with its own opening and closing time, kept in
--   firms.settings -> 'special_hours'  [{"from": "2026-07-01", "to": "2026-09-30",
--                                        "open": "09:00", "close": "21:00"}, ...]
-- Within a range those times replace the weekly hours on every day; holidays still close.
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
  from today
$$;
