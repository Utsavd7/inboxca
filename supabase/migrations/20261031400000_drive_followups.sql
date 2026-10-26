-- PLAN.md 5.5.1: two things the daily drive check asks of the database. Server only.

-- About a year of the firm's files, for the low space warning: the papers it added in the
-- last 12 months (its usage ledger; the first import's papers are entered at 0 bytes, as
-- they were in the drive already), at each file's size.
create or replace function public.drive_year_bytes(target_firm uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(d.size), 0)::bigint
  from public.usage_ledger t join public.documents d on d.id = t.ref and d.firm_id = t.firm_id
  where t.firm_id = target_firm and t.bytes > 0 and t.due_on > (now() at time zone 'Asia/Kolkata')::date - 365
$$;
revoke all on function public.drive_year_bytes(uuid) from public, anon, authenticated;
grant execute on function public.drive_year_bytes(uuid) to service_role;

-- A filing, reading or import job tries the drive every hour for 7 days, then fails. When
-- the check reaches a drive that was away (its drive_away alert still open), each of the
-- firm's jobs that failed so goes once more, as a new job under its own key and ":again":
-- never queued twice, and one that fails again stays failed. Returns how many, and logs it.
create or replace function public.requeue_drive_jobs(target_firm uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  queued int;
begin
  if not exists (select 1 from public.requests where firm_id = target_firm and kind = 'alert' and entity_type = 'drive_away' and entity_id = target_firm and status = 'pending') then
    return 0;
  end if;
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
    select j.firm_id, j.kind, j.entity_type, j.entity_id, j.idempotency_key || ':again' from public.jobs j
    where j.firm_id = target_firm and j.state = 'failed' and j.last_error_code = 'drive_unreachable'
      and j.kind in ('file_mail', 'read_document', 'import_files', 'undo_import') and j.idempotency_key not like '%:again'
  on conflict (idempotency_key) do nothing;
  get diagnostics queued = row_count;
  if queued > 0 then
    insert into public.activity_log (firm_id, action, entity_type, entity_id, details) values (target_firm, 'drive.back', 'firm', target_firm, jsonb_build_object('jobs', queued));
  end if;
  return queued;
end;
$$;
revoke all on function public.requeue_drive_jobs(uuid) from public, anon, authenticated;
grant execute on function public.requeue_drive_jobs(uuid) to service_role;
