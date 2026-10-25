-- The 2026 look: Today's quiet "What InboxCA did today" and the bell in the menu. The log
-- stays the owner's to read; this hands any member the few lines about clients they can
-- open, newest first, at most 20. mine = false: work InboxCA did by itself (no person acted)
-- since `since`. mine = true: what others did on the clients assigned to this person or their
-- team (every client they can open when none is assigned to them).
create or replace function public.activity_feed(target_firm uuid, since timestamptz, mine boolean default false)
returns table (at timestamptz, action text, client_id uuid, client_name text)
language sql stable security definer set search_path = '' as $$
  with lines as (
    select l.at, l.action,
      case l.entity_type
        when 'client' then l.entity_id
        when 'task' then (select t.client_id from public.tasks t where t.id = l.entity_id)
        when 'email' then (select e.client_id from public.email_events e where e.id = l.entity_id)
        when 'request' then (select r.client_id from public.requests r where r.id = l.entity_id)
        when 'document' then (select d.client_id from public.documents d where d.id = l.entity_id)
      end as client_id
    from public.activity_log l
    where l.firm_id = target_firm and l.at >= since and public.member_role(target_firm) is not null
      and case when mine
        then l.actor_id is distinct from (select auth.uid()) and l.action in ('reminder.sent', 'email.acknowledged', 'email.replied', 'email.written',
          'request.created', 'task.changed', 'notice.added', 'assignment.added', 'document.uploaded', 'form.prepared', 'form.approved', 'form.rejected', 'form.filed')
        else l.actor_id is null and l.action in ('reminder.sent', 'email.acknowledged', 'form.prepared') end
  ), assigned as materialized (select public.assigned_clients() as id)
  select x.at, x.action, c.id, c.name
  from lines x join public.clients c on c.id = x.client_id and c.firm_id = target_firm
  where public.can_access_client(target_firm, c.id)
    and (not mine or not exists (select 1 from assigned) or c.id in (select id from assigned))
  order by x.at desc
  limit 20
$$;
revoke all on function public.activity_feed(uuid, timestamptz, boolean) from public, anon, authenticated, service_role;
grant execute on function public.activity_feed(uuid, timestamptz, boolean) to authenticated;
