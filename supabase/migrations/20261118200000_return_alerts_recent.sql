-- A return is alerted when it slips past 3 days late, not when it reaches the calendar already
-- long late: an import or new services put every return due before today on it as late (the
-- import says so), and one email each flooded the owner and used the firm's emails for the day.
-- Ten days leaves a week for a sweep that did not run.
create or replace function private.queue_return_alerts() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key)
  select t.firm_id,'return_alert','task',t.id,'return_alert:' || t.id
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  where t.kind='compliance' and t.status<>'filed' and c.archived_at is null
    and t.due_on <= (now() at time zone 'Asia/Kolkata')::date-3
    and t.due_on > (now() at time zone 'Asia/Kolkata')::date-10
    and not coalesce((t.details->>'return_alerted')::boolean,false)
  on conflict(idempotency_key) do nothing
$$;
revoke all on function private.queue_return_alerts() from public,anon,authenticated,service_role;
