-- M4 step 4: a person confirms or corrects a filed document's type, work or period, which
-- is a rename every member may make (PLAN.md 5.17.2). The server checks the person may see
-- the document, moves the file in the drive, then records its new place here; the old one
-- goes in the log in the same statement, so one click puts it back. Only the server calls
-- this, so nobody can point a document at another file in the drive.
create function public.rename_document(target uuid, actor uuid, new_work text, new_type text, new_period text, new_status text, new_name text, new_file text)
returns void language sql security definer set search_path = '' as $$
  with old as (select * from public.documents where id = target),
  logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select firm_id, actor, 'document.renamed', 'document', id, jsonb_build_object('from', jsonb_build_object(
      'work_type', work_type, 'document_type', document_type, 'period_key', period_key, 'status', status, 'name', name, 'drive_file_id', drive_file_id))
    from old
  )
  update public.documents set work_type = new_work, document_type = new_type, period_key = new_period, status = new_status, name = new_name, drive_file_id = new_file
  where id = target;
$$;
revoke all on function public.rename_document(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rename_document(uuid, uuid, text, text, text, text, text, text) to service_role;

-- Two copies of one file are told apart by checksum on the client's Files tab.
grant select (sha256) on public.documents to authenticated;
