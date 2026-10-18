-- M4 step 10: the daily drive check (PLAN.md 5.5.1). Each night every connected drive is
-- read once: a file InboxCA filed that is no longer there is marked missing, and the owner
-- is told when InboxCA's folder is shared or has a link, when the drive is nearly full, and
-- when files are missing. An alert is a request of kind alert, one per firm and reason,
-- cleared by the next check that finds all well.
alter table public.requests drop constraint requests_kind_check;
alter table public.requests add constraint requests_kind_check check (kind in ('team_reply', 'documents', 'alert'));
alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check check (status in ('filed', 'to_check', 'deleted', 'missing'));

create function private.queue_drive_checks() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  select a.firm_id, 'drive_check', 'account', a.id, 'drive_check:' || a.id || ':' || current_date
  from public.connected_accounts a
  where a.kind = 'drive'
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_drive_checks() from public, anon, authenticated, service_role;
select cron.schedule('drive-checks', '0 21 * * *', 'select private.queue_drive_checks()');
