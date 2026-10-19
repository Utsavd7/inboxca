-- M7 step 10 (PLAN.md 5.17.2, 5.17.3, 5.17.4 #20, #45, #51): approvers get a phone notification
-- from the website. Each browser that turned notifications on keeps one subscription; only the
-- server reads them.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https?://' and length(endpoint) <= 1000),
  keys jsonb not null
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

-- A question or a connection request waiting for an answer is told to its approvers at once:
-- a job, which the app also starts straight away. A request asked again with new details is
-- told again; the same one is not.
create function private.queue_request_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  values (new.firm_id, 'notify_request', 'request', new.id, 'notify_request:' || new.id || ':' || md5(new.details::text))
  on conflict (idempotency_key) do nothing;
  return null;
end;
$$;
create trigger requests_notice after insert or update of status, details on public.requests
  for each row when (new.status = 'pending' and (new.kind = 'permission' or new.entity_type = 'office_connection'))
  execute function private.queue_request_notice();

-- New PCs are told together: one message an hour at most, counting all that wait.
create function private.queue_device_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key, run_at)
  values (new.firm_id, 'notify_devices', 'firm', new.firm_id,
    'notify_devices:' || new.firm_id || ':' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24'), now() + interval '1 minute')
  on conflict (idempotency_key) do nothing;
  return null;
end;
$$;
create trigger devices_notice after insert on public.devices
  for each row execute function private.queue_device_notice();

-- A question routed to a team's manager and unanswered after 30 minutes is told to the owner
-- and deputies too (5.17.4 #45). Questions last 4 hours, so 30 minutes old is 3.5 hours left.
create function private.queue_approval_nudges() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
    select firm_id, 'approval_nudge', 'request', id, 'approval_nudge:' || id from public.requests
    where kind = 'permission' and status = 'pending' and details ->> 'route' = 'manager'
      and expires_at > now() and expires_at <= now() + interval '210 minutes'
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_approval_nudges() from public, anon, authenticated, service_role;
select cron.schedule('approval-nudges', '*/5 * * * *', 'select private.queue_approval_nudges()');

-- Every Monday morning the owner of a firm where anything was approved in the last week gets
-- a summary (5.17.3, 5.17.4 #51).
create function private.queue_approval_summaries() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
    select distinct firm_id, 'approval_summary', 'firm', firm_id,
      'approval_summary:' || firm_id || ':' || (now() at time zone 'Asia/Kolkata')::date
    from public.activity_log
    where at > now() - interval '7 days'
      and action in ('permission.allowed', 'permission.always', 'device.approved', 'office.confirm', 'office.today')
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_approval_summaries() from public, anon, authenticated, service_role;
select cron.schedule('approval-summaries', '30 3 * * 1', 'select private.queue_approval_summaries()');
