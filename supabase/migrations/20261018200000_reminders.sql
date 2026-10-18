-- M5 step 1: smart reminders by email (PLAN.md 5.2, 5.2.1). Each morning one job for every
-- firm with reminders on and a connected mailbox sends at most one email to each client,
-- about every return due in 7, 3 or 1 days, today, or 1 or 3 days ago. A firm can pause
-- reminders for a client. What was sent or skipped, and why, is kept on each task.
alter table public.clients add column reminders_paused boolean not null default false;
grant update (reminders_paused) on public.clients to authenticated;

create function private.queue_reminders() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  select f.id, 'reminders', 'firm', f.id, 'reminders:' || f.id || ':' || (now() at time zone 'Asia/Kolkata')::date
  from public.firms f
  where f.settings ->> 'reminders' = 'true'
    and exists (select 1 from public.connected_accounts a where a.firm_id = f.id and a.kind = 'mail' and a.status = 'connected')
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_reminders() from public, anon, authenticated, service_role;
-- 10:00 India time, inside the hours reminders may go (09:00 to 20:00).
select cron.schedule('reminders', '30 4 * * *', 'select private.queue_reminders()');
