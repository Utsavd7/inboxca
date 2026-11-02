-- A notice has an owner (details.assigned_to) and closes only with its reply recorded (details.reply:
-- the date, what was sent, the acknowledgement and a paper from the client's folder). The owner sees
-- the notice on Today with the firm's owner, partners and the client's team, by the same dates.
alter table public.tasks drop constraint if exists tasks_notice_closed_with_reply;
alter table public.tasks add constraint tasks_notice_closed_with_reply
  check (kind <> 'notice' or status <> 'closed' or details ? 'reply') not valid;

drop function if exists public.notice_alerts(uuid);
create function public.notice_alerts(target_firm uuid) returns table(id uuid,client_id uuid,client_name text,due_on date,action_date text,assigned_to text)
language sql stable set search_path = '' as $$
  select t.id,t.client_id,c.name,t.due_on,t.details->>'action_date',t.details->>'assigned_to'
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  join public.firm_members m on m.firm_id=t.firm_id and m.user_id=(select auth.uid())
  where t.firm_id=target_firm and t.kind='notice' and t.status in ('upcoming','in_progress') and c.archived_at is null
    and t.due_on <= (now() at time zone 'Asia/Kolkata')::date + 3
    and (m.role in ('owner','partner') or t.details->>'assigned_to'=m.user_id::text or exists(select 1 from public.client_assignments a where a.client_id=t.client_id and a.firm_id=t.firm_id and (a.user_id=m.user_id or a.team_id=m.team_id)))
  order by t.due_on,t.id
$$;
revoke all on function public.notice_alerts(uuid) from public,anon;
grant execute on function public.notice_alerts(uuid) to authenticated;
