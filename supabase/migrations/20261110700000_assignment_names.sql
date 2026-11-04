-- The bell said "Person or team assigned" without saying who. An assignment's log line now
-- keeps the person or team given the client, and the work (GST or income tax): ids and a code
-- only (src/lib/activity.ts). activity_feed returns each line's details for the bell to name them.
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
begin
  -- Deleting a whole firm removes everything in it; that is not a change to log.
  if current_setting('app.logged', true) = 'on' or not exists (select 1 from public.firms where id = (row ->> 'firm_id')::uuid) then
    return null;
  end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values ((row ->> 'firm_id')::uuid, (select auth.uid()),
    tg_argv[0] || case tg_op when 'INSERT' then '.added' when 'DELETE' then '.removed' else '.changed' end,
    coalesce(tg_argv[2], 'client'), (row ->> tg_argv[1])::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('changed',
      (select jsonb_agg(key) from jsonb_each(to_jsonb(new)) n where n.value is distinct from to_jsonb(old) -> n.key))
    when tg_argv[0] = 'assignment' then jsonb_strip_nulls(jsonb_build_object('person', row ->> 'user_id', 'team', row ->> 'team_id', 'work', row ->> 'work'))
    else jsonb_strip_nulls(jsonb_build_object('kind', row ->> 'kind')) end);
  return null;
end;
$$;

drop function if exists public.activity_feed(uuid, timestamptz, boolean);
create function public.activity_feed(target_firm uuid, since timestamptz, mine boolean default false)
returns table (at timestamptz, action text, client_id uuid, client_name text, details jsonb)
language sql stable security definer set search_path = '' as $$
  with me as materialized (
    select public.member_role(target_firm) as role,
      (select f.settings ->> 'client_visibility' from public.firms f where f.id = target_firm) as visibility,
      (select m.team_id from public.firm_members m where m.firm_id = target_firm and m.user_id = (select auth.uid())) as team
  ), lines as (
    select l.at, l.action, l.details,
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
        then l.actor_id is distinct from (select auth.uid()) and l.action in ('reminder.sent', 'email.acknowledged', 'email.answered', 'email.replied', 'email.written',
          'request.created', 'task.changed', 'notice.added', 'assignment.added', 'document.uploaded', 'form.prepared', 'form.approved', 'form.rejected', 'form.filed')
        else l.actor_id is null and l.action in ('reminder.sent', 'email.acknowledged', 'email.answered', 'form.prepared') end
  ), assigned as materialized (select public.assigned_clients() as id)
  select x.at, x.action, c.id, c.name, x.details
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
revoke all on function public.activity_feed(uuid, timestamptz, boolean) from public, anon, authenticated, service_role;
grant execute on function public.activity_feed(uuid, timestamptz, boolean) to authenticated;
