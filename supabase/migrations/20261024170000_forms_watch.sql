-- M6: the daily check of official forms (D42). Orelu-wide settings, read and written by the
-- server only; the watcher keeps what it last saw of each official source under 'watch', and
-- the changes and alerts it records wait there for Orelu's admin view (M11).
create table public.platform_settings (
  key text primary key check (key ~ '^[a-z_]{1,40}$'),
  value jsonb not null default '{}'
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;

-- One check a day, at 05:30 India time, for all of Orelu (no firm).
create function private.queue_forms_watch() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (kind, entity_type, idempotency_key)
  values ('forms_watch', 'platform', 'forms_watch:' || (now() at time zone 'Asia/Kolkata')::date)
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_forms_watch() from public, anon, authenticated, service_role;
select cron.schedule('forms-watch', '0 0 * * *', 'select private.queue_forms_watch()');
