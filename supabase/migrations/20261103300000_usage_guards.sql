-- M11 usage limits (PLAN.md D26, D38 (6), 5.14): fair use of downloads and of Orelu's own
-- emails, and the nightly check for one firm signing up as several.

-- Fair use, in the admin's plan_formula: downloads through InboxCA a month, per return a year
-- of the firm's plan (Solo's 800 returns give 800 downloads a month), and Orelu's own emails a
-- day for one firm. Added once; later values are the admin's.
update public.platform_settings set value = value || '{"fairUse": {"downloadsAMonthPerReturn": 1, "systemMailsADay": 300}}'
where key = 'plan_formula' and not value ? 'fairUse';

-- Orelu's own emails for one firm today, India time, counted in the sign in limits' table under
-- the firm and the day (no address, no person). With send, counts this one first; the caller
-- holds it when used is above most. Server only.
create or replace function public.system_mail_use(target_firm uuid, send boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  bucket text := 'mail:' || target_firm || ':' || (now() at time zone 'Asia/Kolkata')::date;
  used int;
begin
  if send then
    delete from private.rate_limits where since < now() - interval '1 day';
    insert into private.rate_limits as r (key) values (bucket)
    on conflict (key) do update set hits = r.hits + 1
    returning hits into used;
  else
    select hits into used from private.rate_limits where key = bucket;
  end if;
  return jsonb_build_object('used', coalesce(used, 0),
    'most', coalesce((select (value #>> '{fairUse,systemMailsADay}')::int from public.platform_settings where key = 'plan_formula'), 300));
end;
$$;
revoke all on function public.system_mail_use(uuid, boolean) from public, anon, authenticated;
grant execute on function public.system_mail_use(uuid, boolean) to service_role;

-- Firms that may be one firm (D38 (6)): the nightly check (src/jobs/split-firms.ts) keeps each
-- pair and what matched, as kinds and counts only, under platform_settings 'split_firms', which
-- no firm can read. Only an Orelu admin sees them, with the two firms' names, and records a
-- verdict; nothing is ever shown to the firms or blocked.
create or replace function public.admin_split_firms() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(flag || jsonb_build_object('names', (
      select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'status', f.status) order by f.created_at), '[]')
      from public.firms f where f.id::text in (select jsonb_array_elements_text(flag -> 'firms'))))
    order by flag ? 'checked', flag ->> 'since' desc), '[]')
    from jsonb_array_elements(coalesce((select value -> 'flags' from public.platform_settings where key = 'split_firms'), '[]')) flag);
end;
$$;

-- The admin's verdict on a pair: separate firms, or one firm (the admin then acts under the
-- terms). It stands until the check finds a new kind of match. Logged as Orelu's own event.
create or replace function public.admin_check_split(first uuid, second uuid, verdict text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  pair jsonb := jsonb_build_array(least(first, second)::text, greatest(first, second)::text);
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  if verdict not in ('separate', 'one') then raise exception 'Unknown verdict' using errcode = '22023'; end if;
  update public.platform_settings s set value = jsonb_set(s.value, '{flags}', (
    select jsonb_agg(case when flag -> 'firms' = pair
      then flag || jsonb_build_object('checked', jsonb_build_object('verdict', verdict, 'by', (select auth.uid()), 'at', now(), 'evidence', flag -> 'evidence'))
      else flag end)
    from jsonb_array_elements(s.value -> 'flags') flag))
  where s.key = 'split_firms' and exists (select 1 from jsonb_array_elements(s.value -> 'flags') flag where flag -> 'firms' = pair);
  if not found then return false; end if;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.split_checked', 'platform', jsonb_build_object('firms', pair, 'verdict', verdict));
  return true;
end;
$$;
revoke all on function public.admin_split_firms(), public.admin_check_split(uuid, uuid, text) from public, anon;
grant execute on function public.admin_split_firms(), public.admin_check_split(uuid, uuid, text) to authenticated;

-- The check runs once a night, at 03:00 India time, for all of Orelu (no firm).
create or replace function private.queue_split_firms() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (kind, entity_type, idempotency_key)
  values ('split_firms', 'platform', 'split_firms:' || (now() at time zone 'Asia/Kolkata')::date)
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_split_firms() from public, anon, authenticated, service_role;
select cron.schedule('split-firms', '30 21 * * *', 'select private.queue_split_firms()');
