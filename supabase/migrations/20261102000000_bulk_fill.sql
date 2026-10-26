-- Fill all (PLAN.md "Less work for the firm": prepare every return for a big client list in one
-- press; the user, 26 Oct 2026: "the team can manually press fill for one person or ai fills much
-- before due date ... make sure no double filling ... a person checks"). From the full list
-- (/app/work), the GSTR-1 and GSTR-3B returns late or due in the next 7 days go to InboxCA's own fill
-- (src/jobs/fill-return.ts), the job that fills them by itself from the firm's days before the
-- due date: one job a return, and fill_form keeps one draft a return however many run. A fill
-- approves, downloads and files nothing: those still wait until every figure is checked.

-- The returns this person may have filled now and where each stands. The owner and partners:
-- the whole firm; a manager: their own team's clients (public.my_clients); anyone else: the
-- clients they look after and may edit figures for (Settings, Permissions, or an approved
-- permission request for that client), as Fill checks. ready: Fill would make its draft now
-- (src/lib/fill.ts: papers and figures in, none marked wrong, no corrected file to check first).
-- filling: a fill is waiting or under way.
create or replace function public.due_fills(target_firm uuid)
returns table(task uuid, client uuid, client_name text, code text, period_key text, due_on date, stage text, open int, missing text, wrong int, ready boolean, filling boolean)
language sql stable security definer set search_path='' as $$
  with me as materialized (
    select public.member_role(target_firm) role,(now() at time zone 'Asia/Kolkata')::date today
    from public.firms f where f.id=target_firm and f.status in ('active','grace')
  ), work as (
    select t.id,t.client_id,c.name,t.code,t.period_key,t.due_on
    from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null cross join me
    where me.role is not null and t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and t.code ~ '^GSTR(1|3B)_'
      and t.due_on<=me.today+7
      and (me.role in ('owner','partner') or t.client_id in (select public.my_clients(target_firm))
        -- As the clients table shows them to this person (its row level security).
        and (target_firm in (select public.open_firms()) or t.client_id in (select public.assigned_clients()))
        and (me.role='manager' or t.client_id in (select public.clients_with_right('edit_figures'))
          or exists(select 1 from public.requests q where q.firm_id=target_firm and q.client_id=t.client_id and q.kind='permission'
            and q.reason_code='edit_figures' and q.status='approved' and q.expires_at>now() and q.details->>'by'=(select auth.uid())::text)))
  ), busy as (
    select j.entity_id from public.jobs j where j.state in ('claimed','sending') and j.firm_id=target_firm and j.kind='fill_return'
  )
  select w.id,w.client_id,w.name,w.code,w.period_key,w.due_on,s.stage,s.open,s.missing,x.wrong,
    s.stage in ('figures','checked') and s.missing is null and x.wrong=0 and not (s.stage='figures' and x.corrected),
    exists(select 1 from public.jobs j where j.entity_type='task' and j.entity_id=w.id and j.state='pending' and j.kind='fill_return')
      or exists(select 1 from busy b where b.entity_id=w.id)
  from work w join public.return_stages(target_firm,array(select id from work)) s on s.task=w.id
  cross join lateral (
    select coalesce((select sum(r.wrong) from public.return_drafts(w.id) r),0)::int wrong,
      exists(select 1 from public.documents d where d.id=s.form and coalesce((d.prepared->>'external')::boolean,false)) corrected
  ) x
  order by w.due_on,w.name,w.code
$$;

-- Fill all, after its preview: one fill a return that is ready and not filled or being filled
-- already, 20 seconds from now so Undo can stop them, and one line in the log for the batch.
-- Two presses at once wait for each other here, so the second finds the first's fills.
create or replace function public.queue_fills(target_firm uuid, batch uuid)
returns table(queued int, clients int, first_job bigint)
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('queue_fills'||target_firm::text,0));
  with picked as (
    select d.task,d.client from public.due_fills(target_firm) d where d.ready and not d.filling
  ), added as (
    insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key,run_at)
    select target_firm,'fill_return','task',p.task,'fill_return:'||p.task||':'||batch,now()+interval '20 seconds' from picked p
    on conflict(idempotency_key) do nothing returning id,entity_id
  )
  select count(*)::int,count(distinct p.client)::int,min(a.id) into queued,clients,first_job from added a join picked p on p.task=a.entity_id;
  if queued>0 then
    insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
      values(target_firm,(select auth.uid()),'fills.asked','firm',target_firm,jsonb_build_object('returns',queued,'clients',clients,'batch',batch));
  end if;
  return next;
end;
$$;

-- Undo on the toast: the person who asked stops the whole batch, only while none of it has
-- started. Returns how many fills were stopped.
create or replace function public.stop_fills(target_firm uuid, batch uuid, first_job bigint)
returns int language plpgsql security definer set search_path='' as $$
declare stopped int;
begin
  if public.member_role(target_firm) is null or not exists(select 1 from public.activity_log l where l.firm_id=target_firm and l.at>now()-interval '1 day'
      and l.action='fills.asked' and l.actor_id=(select auth.uid()) and l.details->>'batch'=batch::text) then return 0; end if;
  perform 1 from public.jobs j where j.id>=first_job and j.firm_id=target_firm and j.kind='fill_return' and j.idempotency_key like '%:'||batch::text order by j.id for update;
  if exists(select 1 from public.jobs j where j.id>=first_job and j.firm_id=target_firm and j.kind='fill_return' and j.idempotency_key like '%:'||batch::text and j.state<>'pending') then return 0; end if;
  update public.jobs j set state='cancelled' where j.id>=first_job and j.firm_id=target_firm and j.kind='fill_return' and j.idempotency_key like '%:'||batch::text;
  get diagnostics stopped=row_count;
  if stopped>0 then
    insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
      values(target_firm,(select auth.uid()),'fills.stopped','firm',target_firm,jsonb_build_object('returns',stopped,'batch',batch));
  end if;
  return stopped;
end;
$$;

revoke all on function public.due_fills(uuid) from public,anon;
revoke all on function public.queue_fills(uuid,uuid) from public,anon;
revoke all on function public.stop_fills(uuid,uuid,bigint) from public,anon;
grant execute on function public.due_fills(uuid) to authenticated;
grant execute on function public.queue_fills(uuid,uuid) to authenticated;
grant execute on function public.stop_fills(uuid,uuid,bigint) to authenticated;
