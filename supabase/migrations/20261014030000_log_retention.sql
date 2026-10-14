-- M0 step 5: the activity log keeps each firm's chosen months and no more (D18: 12, 24 or
-- 36 months, default 36, in firms.settings ->> 'activity_log_months'; PLAN.md section 8).
--
-- Month partitions live in a schema the API never exposes, so nobody reaches a partition
-- around the log's row level security, and the generated types do not change each month.
create schema private;
revoke all on schema private from public, anon, authenticated, service_role;
alter table public.activity_log_default set schema private;

-- Run once a day by pg_cron, and once below. It
--   1. makes this month's and next month's partitions, so rows never pile up in the default;
--   2. removes a firm's rows older than its setting (firms on 12 or 24 months);
--   3. drops whole months older than 36 months, the longest setting, with no work per row.
-- as_of is for tests; the schedule uses today.
create function public.maintain_activity_log(as_of timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare
  this_month timestamptz := date_trunc('month', as_of);
  starts timestamptz;
  part text;
begin
  foreach starts in array array[this_month, this_month + interval '1 month'] loop
    part := 'activity_log_' || to_char(starts, '"y"YYYY"m"MM');
    if to_regclass('private.' || part) is null then
      execute format(
        'create table private.%I partition of public.activity_log for values from (%L) to (%L)',
        part, starts, starts + interval '1 month');
    end if;
  end loop;

  perform set_config('app.log_purge', 'on', true);
  -- The first bound is the same for every firm, so recent months are never read.
  delete from public.activity_log l using public.firms f
  where l.firm_id = f.id
    and l.at < this_month - interval '12 months'
    and l.at < this_month - make_interval(months =>
      case f.settings ->> 'activity_log_months' when '12' then 12 when '24' then 24 else 36 end);

  for part in
    select c.relname from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.activity_log'::regclass
      and c.relname ~ '^activity_log_y[0-9]{4}m[0-9]{2}$'
      and to_date(substr(c.relname, 14), '"y"YYYY"m"MM') < this_month - interval '36 months'
  loop
    execute format('drop table private.%I', part);
  end loop;
  perform set_config('app.log_purge', 'off', true);
end;
$$;
revoke all on function public.maintain_activity_log(timestamptz) from public, anon, authenticated, service_role;

select public.maintain_activity_log();

-- 02:00 in India (20:30 UTC), when nobody is working.
create extension if not exists pg_cron;
select cron.schedule('activity-log-retention', '30 20 * * *', 'select public.maintain_activity_log()');
