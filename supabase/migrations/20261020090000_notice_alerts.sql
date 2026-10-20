-- M5: one phone notification per notice stage, with the same live dates on Home.
create function private.notice_stage(due date, details jsonb, today date default (now() at time zone 'Asia/Kolkata')::date)
returns text language sql immutable set search_path = '' as $$
  select case when due <= today + 3 then
    case when nullif(details ->> 'action_date', '') is null then 'review_' else 'action_' end ||
    case when due < today then 'late' when due = today then 'due' else 'near' end end
$$;
revoke all on function private.notice_stage(date,jsonb,date) from public, anon, authenticated, service_role;

-- A person confirming a date must not replace stages already delivered by a job.
create function private.keep_notice_alerts() returns trigger language plpgsql set search_path = '' as $$
begin
  new.details := jsonb_set(new.details, '{notice_alerts}', coalesce(old.details -> 'notice_alerts', '{}') || coalesce(new.details -> 'notice_alerts', '{}'));
  return new;
end;
$$;
create trigger notice_alerts_kept before update of details on public.tasks for each row
  when (old.kind = 'notice') execute function private.keep_notice_alerts();

create function private.queue_notice_alerts() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id,kind,entity_type,entity_id,idempotency_key)
  select t.firm_id,'notice_alert','task',t.id,'notice_alert:' || t.id || ':' || private.notice_stage(t.due_on,t.details)
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  where t.kind='notice' and t.status in ('upcoming','in_progress') and c.archived_at is null
    and t.due_on <= (now() at time zone 'Asia/Kolkata')::date + 3
    and not coalesce(t.details -> 'notice_alerts', '{}') ? private.notice_stage(t.due_on,t.details)
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_notice_alerts() from public, anon, authenticated, service_role;
select cron.schedule('notice-alerts','*/5 * * * *','select private.queue_notice_alerts()');

-- Claim before calling the phone service: a retry never repeats a stage after a crash.
create function public.claim_notice_alert(task_id uuid, stage text) returns jsonb
language sql security definer set search_path = '' as $$
  update public.tasks t set details=jsonb_set(t.details,'{notice_alerts}',coalesce(t.details->'notice_alerts','{}') || jsonb_build_object(stage,true))
  from public.clients c where t.id=task_id and c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null
    and t.kind='notice' and t.status in ('upcoming','in_progress') and private.notice_stage(t.due_on,t.details)=stage
    and not coalesce(t.details->'notice_alerts','{}') ? stage
  returning jsonb_build_object('firm_id',t.firm_id,'client_id',t.client_id,'stage',stage)
$$;
revoke all on function public.claim_notice_alert(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_notice_alert(uuid,text) to service_role;

create function public.notice_alerts() returns table(id uuid,client_id uuid,client_name text,due_on date,action_date text)
language sql stable set search_path = '' as $$
  select t.id,t.client_id,c.name,t.due_on,t.details->>'action_date'
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  join public.firm_members m on m.firm_id=t.firm_id and m.user_id=(select auth.uid())
  where t.kind='notice' and t.status in ('upcoming','in_progress') and c.archived_at is null
    and t.due_on <= (now() at time zone 'Asia/Kolkata')::date + 3
    and (m.role in ('owner','partner') or exists(select 1 from public.client_assignments a where a.client_id=t.client_id and a.firm_id=t.firm_id and (a.user_id=m.user_id or a.team_id=m.team_id)))
  order by t.due_on,t.id
$$;
revoke all on function public.notice_alerts() from public,anon;
grant execute on function public.notice_alerts() to authenticated;
