-- The bell said "Return, notice or to-do updated" without saying which. As
-- 20261113100000_take_work.sql, and each of the newest 20 lines also gives who did it and the
-- return, notice or to-do it is about: the line's own task, or for a prepared form the one return
-- it is for (as file_prepared_form and return-back.ts's returnPage find it): its kind, code, period,
-- status now, and its calendar name and frequency. Ids and codes only; nothing is decrypted.
drop function if exists public.activity_feed(uuid, timestamptz, boolean);
create function public.activity_feed(target_firm uuid, since timestamptz, mine boolean default false)
returns table (at timestamptz, action text, client_id uuid, client_name text, details jsonb, actor_id uuid, task jsonb)
language sql stable security definer set search_path = '' as $$
  with me as materialized (
    select public.member_role(target_firm) as role,
      (select f.settings ->> 'client_visibility' from public.firms f where f.id = target_firm) as visibility,
      (select m.team_id from public.firm_members m where m.firm_id = target_firm and m.user_id = (select auth.uid())) as team
  ), lines as (
    select l.at, l.action, l.details, l.actor_id, l.entity_type, l.entity_id,
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
          'request.created', 'task.changed', 'notice.added', 'assignment.added', 'document.uploaded', 'form.prepared', 'form.approved', 'form.rejected', 'form.filed', 'task.covered')
        else l.actor_id is null and l.action in ('reminder.sent', 'email.acknowledged', 'email.answered', 'form.prepared') end
  ), assigned as materialized (select public.assigned_clients() as id
  ), newest as (
    select x.at, x.action, c.id as client_id, c.name as client_name, x.details, x.actor_id, x.entity_type, x.entity_id
    from lines x join public.clients c on c.id = x.client_id and c.firm_id = target_firm
    -- public.can_access_client, with the person read once above.
    where ((select role from me) in ('owner', 'partner')
        or (select role from me) is not null
          and ((select visibility from me) is distinct from 'restricted'
            or exists (select 1 from public.client_assignments a
                       where a.client_id = c.id and (a.user_id = (select auth.uid()) or a.team_id = (select team from me)))))
      and (not mine or not exists (select 1 from assigned) or c.id in (select id from assigned) or x.details ->> 'person' = (select auth.uid())::text)
    order by x.at desc
    limit 20
  )
  select y.at, y.action, y.client_id, y.client_name, y.details, y.actor_id,
    case when t.id is not null then jsonb_build_object('id', t.id, 'kind', t.kind, 'code', t.code, 'period', t.period_key, 'status', t.status, 'name', ct.name, 'frequency', ct.frequency) end
  from newest y
  left join lateral (
    select case when y.entity_type = 'task' then y.entity_id
      when y.entity_type = 'document' and y.action like 'form.%' then (
        select case when count(*) = 1 then (array_agg(r.id))[1] end
        from public.documents d join public.tasks r on r.firm_id = d.firm_id and r.client_id = d.client_id and r.kind = 'compliance'
          and r.registration_id is not distinct from coalesce((d.prepared ->> 'registration')::uuid, r.registration_id)
          and r.period_key = case when d.prepared ->> 'form' ~ '^ITR' then d.period_key || '-03' else d.period_key end
          and (r.code in ((d.prepared ->> 'form') || '_M', (d.prepared ->> 'form') || '_Q') or d.prepared ->> 'form' ~ '^ITR' and r.code like 'ITR%'
            or d.prepared ->> 'form' in ('TDS138', 'TDS140', 'TDS144') and r.code = 'TDS_RET' or d.prepared ->> 'form' = 'TDS143' and r.code = 'TCS_RET')
        where d.id = y.entity_id and d.firm_id = target_firm and d.prepared is not null)
    end as id
  ) f on true
  left join public.tasks t on t.id = f.id and t.firm_id = target_firm and t.client_id = y.client_id
  left join public.compliance_types ct on ct.code = t.code and ct.period_key = ''
  order by y.at desc
$$;
revoke all on function public.activity_feed(uuid, timestamptz, boolean) from public, anon, authenticated, service_role;
grant execute on function public.activity_feed(uuid, timestamptz, boolean) to authenticated;
