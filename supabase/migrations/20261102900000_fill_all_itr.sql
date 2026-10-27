-- Fill all takes ITRs too (the user, 27 Oct 2026), on the GST rules of 20261102000000_bulk_fill.sql:
-- every ITR late or due in the next 7 days that is ready goes to InboxCA's own fill. Only the file
-- worker knows whether an ITR has every detail its official form needs, so the preview counts an
-- ITR as filled where every detail is there, and an ITR the fill left for a person says why on its
-- row: the reason code src/jobs/fill-return.ts finishes its job with.

-- As in 20261014010000_jobs.sql, with a done job keeping the reason code it was given (a fill
-- left for a person). A job done without one keeps none, as before.
create or replace function public.finish_job(
  job_id bigint,
  outcome text,
  error_code text default null,
  retry_at timestamptz default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if outcome not in ('done', 'retry', 'failed') then
    raise exception 'unknown outcome %', outcome using errcode = '22023';
  end if;
  update public.jobs
  set state = case outcome when 'retry' then 'pending' else outcome end,
      run_at = case when outcome = 'retry' then coalesce(retry_at, now()) else run_at end,
      claimed_until = null,
      last_error_code = error_code
  where id = job_id and state in ('claimed', 'sending');
  return found;
end;
$$;

-- A return's last finished fill, for its reason.
create index if not exists jobs_fills_done on public.jobs(entity_id,id) where kind='fill_return' and state='done';

-- As in 20261102000000_bulk_fill.sql, with ITRs. reason: why the return's last finished fill made
-- no draft, as its job's code (null when it made one or had nothing to fill).
drop function if exists public.due_fills(uuid);
create function public.due_fills(target_firm uuid)
returns table(task uuid, client uuid, client_name text, code text, period_key text, due_on date, stage text, open int, missing text, wrong int, ready boolean, filling boolean, reason text)
language sql stable security definer set search_path='' as $$
  with me as materialized (
    select public.member_role(target_firm) role,(now() at time zone 'Asia/Kolkata')::date today
    from public.firms f where f.id=target_firm and f.status in ('active','grace')
  ), work as (
    select t.id,t.client_id,c.name,t.code,t.period_key,t.due_on
    from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null cross join me
    where me.role is not null and t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and t.code ~ '^(GSTR1|GSTR3B|ITR)_'
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
      or exists(select 1 from busy b where b.entity_id=w.id),
    (select j.last_error_code from public.jobs j where j.entity_id=w.id and j.kind='fill_return' and j.state='done' and j.entity_type='task' order by j.id desc limit 1)
  from work w join public.return_stages(target_firm,array(select id from work)) s on s.task=w.id
  cross join lateral (
    select coalesce((select sum(r.wrong) from public.return_drafts(w.id) r),0)::int wrong,
      exists(select 1 from public.documents d where d.id=s.form and coalesce((d.prepared->>'external')::boolean,false)) corrected
  ) x
  order by w.due_on,w.name,w.code
$$;

-- As in 20261102000000_bulk_fill.sql, with the ITRs when the app can make their files
-- (with_itrs: its software ID from the Income Tax Department is set), and how many are ITRs.
drop function if exists public.queue_fills(uuid,uuid);
create function public.queue_fills(target_firm uuid, batch uuid, with_itrs boolean)
returns table(queued int, clients int, first_job bigint, itrs int)
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('queue_fills'||target_firm::text,0));
  with picked as (
    select d.task,d.client,d.code ~ '^ITR_' itr from public.due_fills(target_firm) d where d.ready and not d.filling and (with_itrs or d.code !~ '^ITR_')
  ), added as (
    insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key,run_at)
    select target_firm,'fill_return','task',p.task,'fill_return:'||p.task||':'||batch,now()+interval '20 seconds' from picked p
    on conflict(idempotency_key) do nothing returning id,entity_id
  )
  select count(*)::int,count(distinct p.client)::int,min(a.id),(count(*) filter (where p.itr))::int into queued,clients,first_job,itrs from added a join picked p on p.task=a.entity_id;
  if queued>0 then
    insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
      values(target_firm,(select auth.uid()),'fills.asked','firm',target_firm,jsonb_build_object('returns',queued,'clients',clients,'batch',batch));
  end if;
  return next;
end;
$$;

revoke all on function public.due_fills(uuid) from public,anon;
revoke all on function public.queue_fills(uuid,uuid,boolean) from public,anon;
grant execute on function public.due_fills(uuid) to authenticated;
grant execute on function public.queue_fills(uuid,uuid,boolean) to authenticated;
