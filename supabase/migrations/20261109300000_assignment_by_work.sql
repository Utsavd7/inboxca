-- Assignment by kind of work: a firm has a GST desk and an income tax desk, so one client's GST
-- returns and income tax returns may be looked after by different people. client_assignments.work
-- is null for everything the client has (as every assignment was until now), 'gst' for the GST
-- returns only, 'income_tax' for the income tax returns only. Today, Your list, the pins, Fill all
-- and a manager's team load show a person only the returns of their kind; a client's papers,
-- notices and emails are not of one kind and stay with everyone assigned, and who may see the
-- client (row level security, public.assigned_clients) is unchanged.
alter table public.client_assignments add column if not exists work text check (work in ('gst', 'income_tax'));

-- The kind of work a return code is, as src/lib/checklists.ts workOfService reads it: GSTR, CMP
-- and PMT are GST; ITR and ADV income tax. Anything else is neither, so only an assignment for
-- everything shows it.
create or replace function public.work_of(code text) returns text
language sql immutable as $$
  select case when code ~ '^(GSTR|CMP|PMT)' then 'gst' when code ~ '^(ITR|ADV)' then 'income_tax' end
$$;

-- The clients this person looks after, each with the kind of work (null: everything), as
-- public.my_clients read them: their own, their team's, and a manager's team's people's. No set
-- search_path, so it is read into the query that uses it; every name is schema qualified.
create or replace function public.my_work(target_firm uuid) returns table(client_id uuid, work text)
language sql stable as $$
  select a.client_id, a.work from public.client_assignments a
  join public.firm_members m on m.firm_id = a.firm_id and m.user_id = (select auth.uid())
  where a.firm_id = target_firm and (select public.member_role(target_firm)) is not null
    and (a.user_id = m.user_id or a.team_id = m.team_id
         or m.role = 'manager' and a.user_id in (select t.user_id from public.firm_members t where t.firm_id = target_firm and t.team_id = m.team_id))
$$;
revoke all on function public.my_work(uuid) from public, anon;
grant execute on function public.my_work(uuid) to authenticated;

create or replace function public.my_clients(target_firm uuid) returns setof uuid
language sql stable set search_path = '' as $$
  select distinct w.client_id from public.my_work(target_firm) w
$$;

-- Late clients, only the person's own when mine is set: the late returns of their kind.
create or replace function public.late_clients(target_firm uuid, mine boolean default false)
returns table(client_id uuid, client_name text, returns int, code text, period_key text, due_on date)
language sql stable set search_path = '' as $$
  with theirs as (
    select not mine or (select public.member_role(target_firm)) in ('owner','partner') whole
  ), looked as (
    select w.client_id, w.work from public.my_work(target_firm) w where mine
  )
  select c.id,c.name,count(*)::int,(array_agg(t.code order by t.due_on,t.id))[1],
    (array_agg(t.period_key order by t.due_on,t.id))[1],min(t.due_on)
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id cross join theirs
  where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and c.archived_at is null
    and t.due_on < (now() at time zone 'Asia/Kolkata')::date
    and (theirs.whole or exists(select 1 from looked w where w.client_id=c.id and (w.work is null or w.work=public.work_of(t.code))))
  group by c.id,c.name
  order by min(t.due_on),c.name
$$;

-- This week's numbers: the returns of the person's kind; papers asked are the client's.
create or replace function public.work_numbers(target_firm uuid, since date, until date, mine boolean default false)
returns table(due int, filed int, waiting int)
language sql stable set search_path = '' as $$
  with theirs as (
    select not mine or (select public.member_role(target_firm)) in ('owner','partner') whole
  ), looked as (
    select w.client_id, w.work from public.my_work(target_firm) w where mine
  ), due as (
    select t.status from theirs, public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null
    where t.firm_id=target_firm and t.kind='compliance' and t.due_on between since and until
      and (theirs.whole or exists(select 1 from looked w where w.client_id=t.client_id and (w.work is null or w.work=public.work_of(t.code))))
  )
  select (select count(*)::int from due),(select count(*)::int from due where status='filed'),
    (select count(distinct r.client_id)::int from theirs, public.requests r join public.clients c on c.id=r.client_id and c.firm_id=r.firm_id and c.archived_at is null
      where r.firm_id=target_firm and r.kind='documents' and r.status='pending' and r.expires_at>now() and (theirs.whole or r.client_id in (select client_id from looked)))
$$;

-- As 20261101800000_return_pins_speed.sql: the pins of the returns of the person's kind, and a
-- manager approves a draft only of their kind.
create or replace function public.return_pins(target_firm uuid)
returns table(kind text, stage text, task uuid, form uuid, client uuid, client_name text, code text, period_key text, due_on date, open int, missing text)
language sql stable set search_path='' as $$
  with me as (
    select m.user_id id,m.role,m.team_id from public.firm_members m where m.firm_id=target_firm and m.user_id=(select auth.uid()) and m.status='active'
  ), window_days as (
    select (now() at time zone 'Asia/Kolkata')::date today,coalesce((select (f.settings->>'pin_days')::int from public.firms f where f.id=target_firm),5) days
  ), work as (
    select t.id,t.client_id,c.name,t.code,t.period_key,t.due_on,t.due_on between w.today and w.today+w.days soon
    from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null cross join window_days w cross join me
    where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and t.code ~ '^(GSTR1|GSTR3B|ITR)_'
      and (me.role in ('owner','partner') or exists(select 1 from public.my_work(target_firm) x where x.client_id=t.client_id and (x.work is null or x.work=public.work_of(t.code))))
      and (t.due_on between w.today and w.today+w.days or exists(select 1 from public.documents d where d.firm_id=t.firm_id and d.client_id=t.client_id
        and d.prepared->>'status' in ('draft','approved') and d.prepared->>'registration'=t.registration_id::text
        and d.period_key=case when t.code ~ '^ITR_' then left(t.period_key,4) else t.period_key end))
  )
  select case when s.stage='draft' then 'approve' when s.stage='approved' then 'approved'
      when s.stage in ('none','asked','in') or s.missing is not null then 'missing'
      when s.stage in ('figures','checked') then 'fill' else 'check' end,
    s.stage,w.id,s.form,w.client_id,w.name,w.code,w.period_key,w.due_on,s.open,s.missing
  from work w join public.return_stages(target_firm,array(select id from work)) s on s.task=w.id cross join me
  where case
    when s.stage='draft' then (me.role in ('owner','partner') or me.role='manager' and exists(select 1 from public.client_assignments a
        where a.firm_id=target_firm and a.client_id=w.client_id and (a.user_id=me.id and a.role='manager' or a.team_id=me.team_id) and (a.work is null or a.work=public.work_of(w.code))))
      and not exists(select 1 from public.documents x cross join jsonb_array_elements(x.prepared->'sources') src
        join public.datasets d on d.id=(src->>'id')::uuid cross join jsonb_array_elements(d.data->'lines') l where x.id=s.form and l->>'by'=me.id::text)
    when s.stage='filed' or s.stage<>'approved' and not w.soon then false
    else true
  end
  order by w.due_on,w.name
$$;

-- As 20261102900000_fill_all_itr.sql: Fill all picks the returns of the person's kind.
create or replace function public.due_fills(target_firm uuid)
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
      and (me.role in ('owner','partner') or exists(select 1 from public.my_work(target_firm) x where x.client_id=t.client_id and (x.work is null or x.work=public.work_of(t.code)))
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

-- As 20261105210000_team_load_once.sql: a person's load counts the returns of their kind.
create or replace function public.team_load(target_firm uuid, until date)
returns table(user_id uuid, returns int)
language sql stable security definer set search_path = '' as $$
  select a.user_id,count(distinct t.id)::int
  from public.firm_members me
  join public.firm_members m on m.firm_id=me.firm_id and m.team_id=me.team_id and m.status='active'
  join public.client_assignments a on a.firm_id=m.firm_id and a.user_id=m.user_id
  join public.clients c on c.id=a.client_id and c.firm_id=a.firm_id and c.archived_at is null
  join public.tasks t on t.firm_id=a.firm_id and t.client_id=a.client_id and t.kind='compliance' and t.status<>'filed' and t.due_on<=until
    and (a.work is null or a.work=public.work_of(t.code))
  where me.firm_id=target_firm and me.user_id=(select auth.uid())
    and (select public.member_role(target_firm)) is not null
    and (target_firm in (select public.open_firms()) or a.client_id in (select public.assigned_clients()))
  group by a.user_id
  order by 2 desc,1
  limit 5
$$;

-- As 20261102800000_gst_match_changed.sql: GSTR-2B items are GST work.
create or replace function public.gst_match_items(target_firm uuid)
returns table (register_id uuid, client_id uuid, client_name text, period_key text, due_on date, counts jsonb)
language sql stable set search_path = '' as $$
  select m.register_id, d.client_id, c.name, d.period_key, t.due_on, m.counts
  from public.gst_matches m
  join public.documents d on d.firm_id = m.firm_id and d.id = m.register_id and d.status = 'filed'
  join public.documents s on s.firm_id = m.firm_id and s.id = m.statement_id and s.status = 'filed'
  join public.clients c on c.firm_id = d.firm_id and c.id = d.client_id and c.archived_at is null
  cross join lateral (
    select min(t.due_on) due_on from public.tasks t
    where t.firm_id = d.firm_id and t.client_id = d.client_id and t.kind = 'compliance' and t.status <> 'filed'
      and (d.registration_id is null or t.registration_id = d.registration_id)
      and (t.code = 'GSTR3B_M' and t.period_key = d.period_key
        or t.code = 'GSTR3B_Q' and t.period_key = to_char(date_trunc('quarter', to_date(d.period_key, 'YYYY-MM')) + interval '2 months', 'YYYY-MM'))
  ) t
  where m.firm_id = target_firm and t.due_on is not null and d.period_key ~ '^\d{4}-\d{2}$'
    and (m.counts ->> 'missing')::int + (m.counts ->> 'extra')::int + (m.counts ->> 'differ')::int + coalesce((m.counts ->> 'changed')::int, 0) > 0
    and ((select public.member_role(target_firm)) in ('owner', 'partner') or exists(select 1 from public.my_work(target_firm) w where w.client_id = d.client_id and (w.work is null or w.work = 'gst')))
  order by t.due_on
  limit 200
$$;
