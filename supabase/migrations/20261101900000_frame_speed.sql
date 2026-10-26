-- The bell took 1 to 3 seconds in a firm of 1,200 clients, and every page's frame waited on it:
-- activity_feed asked public.can_access_client (two member_role checks) for every client and
-- every log line of the fortnight before keeping the newest 20. The same rules now read the
-- person once, so the newest lines are read first and the reading stops at 20. Who sees which
-- line is unchanged.
create or replace function public.activity_feed(target_firm uuid, since timestamptz, mine boolean default false)
returns table (at timestamptz, action text, client_id uuid, client_name text)
language sql stable security definer set search_path = '' as $$
  with me as materialized (
    select public.member_role(target_firm) as role,
      (select f.settings ->> 'client_visibility' from public.firms f where f.id = target_firm) as visibility,
      (select m.team_id from public.firm_members m where m.firm_id = target_firm and m.user_id = (select auth.uid())) as team
  ), lines as (
    select l.at, l.action,
      case l.entity_type
        when 'client' then l.entity_id
        when 'task' then (select t.client_id from public.tasks t where t.id = l.entity_id)
        when 'email' then (select e.client_id from public.email_events e where e.id = l.entity_id)
        when 'request' then (select r.client_id from public.requests r where r.id = l.entity_id)
        when 'document' then (select d.client_id from public.documents d where d.id = l.entity_id)
      end as client_id
    from public.activity_log l
    where l.firm_id = target_firm and l.at >= since and (select role from me) is not null
      and case when mine
        then l.actor_id is distinct from (select auth.uid()) and l.action in ('reminder.sent', 'email.acknowledged', 'email.replied', 'email.written',
          'request.created', 'task.changed', 'notice.added', 'assignment.added', 'document.uploaded', 'form.prepared', 'form.approved', 'form.rejected', 'form.filed')
        else l.actor_id is null and l.action in ('reminder.sent', 'email.acknowledged', 'form.prepared') end
  ), assigned as materialized (select public.assigned_clients() as id)
  select x.at, x.action, c.id, c.name
  from lines x join public.clients c on c.id = x.client_id and c.firm_id = target_firm
  -- public.can_access_client, with the person read once above.
  where ((select role from me) in ('owner', 'partner')
      or (select role from me) is not null
        and ((select visibility from me) is distinct from 'restricted'
          or exists (select 1 from public.client_assignments a
                     where a.client_id = c.id and (a.user_id = (select auth.uid()) or a.team_id = (select team from me)))))
    and (not mine or not exists (select 1 from assigned) or c.id in (select id from assigned))
  order by x.at desc
  limit 20
$$;

-- The activity log is the owner's to read. The owner check ran once for every line read, so a
-- read over a firm's month of lines (Settings, Orelu support's last steps) took seconds; it
-- now runs once a read, with the same rule.
alter policy activity_select on public.activity_log using (
  firm_id in (select m.firm_id from public.firm_members m where m.user_id = (select auth.uid()) and public.member_role(m.firm_id) = 'owner'));

-- Today's papers to chase: the clients a person looks after are read once, as public.late_clients
-- reads them, not checked again for every request.
create or replace function public.paper_items(target_firm uuid)
returns table (id uuid, kind text, client_id uuid, client_name text, details jsonb)
language sql stable set search_path = '' as $$
  select r.id, case when a.id is null then 'call' else 'papers_in' end, r.client_id, c.name, r.details
  from public.requests r
  join public.clients c on c.id = r.client_id and c.archived_at is null
  left join public.requests a on a.firm_id = r.firm_id and a.kind = 'alert' and a.entity_type = 'papers_in' and a.entity_id = r.id and a.status = 'pending'
  where r.firm_id = target_firm and r.kind = 'documents'
    and (r.status = 'done' and a.id is not null
      or r.status = 'pending' and r.expires_at > now() and jsonb_array_length(coalesce(r.details -> 'followups', '[]')) >= 2
        and coalesce(r.details ->> 'chased', '') < r.details -> 'followups' ->> -1)
    and ((select public.member_role(target_firm)) in ('owner', 'partner') or r.client_id in (select public.my_clients(target_firm)))
  limit 200
$$;
