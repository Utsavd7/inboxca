-- M4: a rename shows on the client's Activity with its old and new name (PLAN.md 5.17.2),
-- so a manager or the owner can see it and undo it in one click. The log now keeps the new
-- name beside the old place; the activity names both, and the document, for renames only.
create or replace function public.rename_document(target uuid, actor uuid, new_work text, new_type text, new_period text, new_status text, new_name text, new_file text)
returns void language sql security definer set search_path = '' as $$
  with old as (select * from public.documents where id = target),
  logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select firm_id, actor, 'document.renamed', 'document', id, jsonb_build_object('from', jsonb_build_object(
      'work_type', work_type, 'document_type', document_type, 'period_key', period_key, 'status', status, 'name', name, 'drive_file_id', drive_file_id), 'to', new_name)
    from old
  )
  update public.documents set work_type = new_work, document_type = new_type, period_key = new_period, status = new_status, name = new_name, drive_file_id = new_file
  where id = target;
$$;

drop function if exists public.client_activity(uuid);
create function public.client_activity(target_client uuid)
returns table (at timestamptz, action text, actor_id uuid, document_id uuid, renamed_from text, renamed_to text)
language sql stable security definer set search_path = '' as $$
  with target as materialized (
    select c.id,c.firm_id from public.clients c where c.id=target_client
      and (c.firm_id in (select public.open_firms()) or c.id in (select public.assigned_clients()))
  ), entities as (
    select 'client' kind,id from target
    union all select 'task',t.id from public.tasks t join target c on c.id=t.client_id and c.firm_id=t.firm_id
    union all select 'document',d.id from public.documents d join target c on c.id=d.client_id and c.firm_id=d.firm_id
    union all select 'email',e.id from public.email_events e join target c on c.id=e.client_id and c.firm_id=e.firm_id
    union all select 'request',r.id from public.requests r join target c on c.id=r.client_id and c.firm_id=r.firm_id
    union all select 'share',s.id from public.shares s join public.documents d on d.id=s.document_id join target c on c.id=d.client_id and c.firm_id=s.firm_id
  )
  select l.at,l.action,l.actor_id,
    case when l.action='document.renamed' then l.entity_id end,
    case when l.action='document.renamed' then l.details->'from'->>'name' end,
    case when l.action='document.renamed' then l.details->>'to' end
  from public.activity_log l join target c on c.firm_id=l.firm_id
  where exists (select 1 from entities e where e.kind=l.entity_type and e.id=l.entity_id)
  order by l.at desc,l.action,l.entity_id limit 50
$$;
revoke all on function public.client_activity(uuid) from public,anon,authenticated,service_role;
grant execute on function public.client_activity(uuid) to authenticated;
