-- A month's partition cannot be made while the default partition holds a row of that month, and
-- maintain_activity_log stopped there for good, purge included. That happens if the job misses a
-- whole month. Now such rows are moved into the new partition, keeping every column.
create or replace function public.maintain_activity_log(as_of timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare
  this_month timestamptz := date_trunc('month', as_of);
  starts timestamptz;
  part text;
begin
  perform set_config('app.log_purge', 'on', true);
  foreach starts in array array[this_month, this_month + interval '1 month'] loop
    part := 'activity_log_' || to_char(starts, '"y"YYYY"m"MM');
    if to_regclass('private.' || part) is null then
      create temp table stranded (like public.activity_log) on commit drop;
      with moved as (
        delete from private.activity_log_default l
        where l.at >= starts and l.at < starts + interval '1 month' returning l.*
      ) insert into pg_temp.stranded select * from moved;
      execute format(
        'create table private.%I partition of public.activity_log for values from (%L) to (%L)',
        part, starts, starts + interval '1 month');
      execute format('insert into private.%I select * from pg_temp.stranded', part);
      drop table pg_temp.stranded;
    end if;
  end loop;

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
