-- M4 step 5: files a person uploads, and files the owner removes (PLAN.md 5.3, 5.5.1, D18).
-- An upload has no email, so a document now keeps when it arrived itself.
alter table public.documents add column received_at timestamptz not null default now();
update public.documents d set received_at = e.received_at from public.email_events e where e.id = d.email_event_id;
grant select (received_at) on public.documents to authenticated;
create index documents_received on public.documents (firm_id, client_id, received_at desc);

-- A removed file waits 30 days in the drive's Deleted and old versions folder, then goes to
-- the drive's own bin; until then the owner can put it back.
alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check check (status in ('filed', 'to_check', 'deleted'));

-- Records a removal or a restore with the place the file had, in the same statement. The
-- server moves the file first and is the only caller.
create function public.remove_document(target uuid, actor uuid, new_status text, new_name text, new_file text)
returns void language sql security definer set search_path = '' as $$
  with old as (select * from public.documents where id = target),
  logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select firm_id, actor, case new_status when 'deleted' then 'document.removed' else 'document.restored' end, 'document', id,
      jsonb_build_object('from', jsonb_build_object('status', status, 'name', name, 'drive_file_id', drive_file_id))
    from old
  )
  update public.documents set status = new_status, name = new_name, drive_file_id = new_file where id = target;
$$;
revoke all on function public.remove_document(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.remove_document(uuid, uuid, text, text, text) to service_role;

-- Each night, one job for every firm with a file removed more than 30 days ago.
create function private.queue_drive_purges() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  select distinct d.firm_id, 'drive_purge', 'firm', d.firm_id, 'drive_purge:' || d.firm_id || ':' || current_date
  from public.documents d
  where d.status = 'deleted'
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_drive_purges() from public, anon, authenticated, service_role;
select cron.schedule('drive-purges', '45 20 * * *', 'select private.queue_drive_purges()');
