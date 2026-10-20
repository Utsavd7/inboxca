-- A client's recent activity, without private log details or other clients' entries.
create function public.client_activity(target_client uuid)
returns table (at timestamptz, action text, actor_id uuid)
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
  select l.at,l.action,l.actor_id from public.activity_log l join target c on c.firm_id=l.firm_id
  where exists (select 1 from entities e where e.kind=l.entity_type and e.id=l.entity_id)
  order by l.at desc,l.action,l.entity_id limit 50
$$;
revoke all on function public.client_activity(uuid) from public,anon,authenticated,service_role;
grant execute on function public.client_activity(uuid) to authenticated;
