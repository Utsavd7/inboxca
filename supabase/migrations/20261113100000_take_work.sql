-- Taking work (owner, 7 Nov 2026: "staff next to client name chooses and puts his name ... or
-- admin or manager can also appoint"). A client is not a ticket, so there are two levels:
-- 1. The desk: who does a client's GST or income tax work, for years, until changed. It is the
--    client's staff assignment for that work (client_assignments, role staff; work null covers
--    every desk). public.set_desk takes a desk nobody holds or hands one back for anyone who does
--    the work, and lets the owner, partners and managers give any desk to anyone.
-- 2. Cover: one return only (leave cover). tasks.doer, a column rather than a key in details, as
--    details is open to every member's update and doer must only change through
--    public.cover_return; its foreign key also clears it when the person leaves the firm. It clears
--    when the return is filed. A covered return is on its doer's list and off the desk's.
-- Each take, give and hand back is logged by the assignments' own trigger (who did it, for whom,
-- which work); each cover by public.cover_return.

alter table public.tasks add column if not exists doer uuid;
alter table public.tasks drop constraint if exists tasks_firm_id_doer_fkey;
alter table public.tasks add constraint tasks_firm_id_doer_fkey foreign key (firm_id, doer)
  references public.firm_members (firm_id, user_id) on delete set null (doer);
create index if not exists tasks_doer on public.tasks (firm_id, doer) where doer is not null;

create or replace function public.filed_clears_doer() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.doer := null;
  return new;
end;
$$;
drop trigger if exists tasks_filed_clears_doer on public.tasks;
create trigger tasks_filed_clears_doer before update of status on public.tasks
  for each row when (new.status = 'filed' and new.doer is not null) execute function public.filed_clears_doer();

-- Give a client's desk (gst, income_tax, or null for all its work) to a person or a team, or to
-- nobody. Without the right to assign, a person only takes a desk nobody holds for themselves, or
-- hands back their own. A holder of all the client's work who loses one desk keeps the other.
create or replace function public.set_desk(target_firm uuid, client uuid, desk text, person uuid default null, team uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  my_role text := public.member_role(target_firm);
  lead boolean := my_role in ('owner', 'partner', 'manager');
  other text := case desk when 'gst' then 'income_tax' when 'income_tax' then 'gst' end;
  gone record;
  kept public.client_assignments;
begin
  if my_role is null or my_role = 'front_desk' or (desk is not null and other is null) or (person is not null and team is not null)
     or not exists (select 1 from public.clients c where c.id = client and c.firm_id = target_firm and c.archived_at is null)
     or not public.can_access_client(target_firm, client)
     or person is not null and not exists (select 1 from public.firm_members m where m.firm_id = target_firm and m.user_id = person and m.status = 'active')
     or team is not null and not exists (select 1 from public.groups g where g.firm_id = target_firm and g.id = team and g.kind = 'team')
     or not lead and (team is not null or person <> me) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Already theirs: nothing to do.
  if (person is not null or team is not null) and exists (select 1 from public.client_assignments a where a.firm_id = target_firm and a.client_id = client
       and a.role = 'staff' and (desk is null or a.work is null or a.work = desk) and (a.user_id = person or a.team_id = team)) then
    return;
  end if;
  if not lead and person = me and exists (select 1 from public.client_assignments a where a.firm_id = target_firm and a.client_id = client
       and a.role = 'staff' and (desk is null or a.work is null or a.work = desk)) then
    raise exception 'held' using errcode = '42501';
  end if;
  if not lead and person is null and not exists (select 1 from public.client_assignments a where a.firm_id = target_firm and a.client_id = client
       and a.role = 'staff' and (desk is null or a.work is null or a.work = desk) and a.user_id = me) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- The desk's holders go (only their own, for someone handing back); a holder of all work keeps the other desk.
  for gone in delete from public.client_assignments a where a.firm_id = target_firm and a.client_id = client and a.role = 'staff'
      and (desk is null or a.work is null or a.work = desk) and (lead or a.user_id = me) returning a.* loop
    if gone.work is null and desk is not null then
      insert into public.client_assignments (firm_id, client_id, user_id, team_id, role, work) values (target_firm, client, gone.user_id, gone.team_id, 'staff', other);
    end if;
  end loop;
  if person is null and team is null then
    return;
  end if;
  -- One row a person or team: their other desk and this one become all work; someone who already
  -- looks after the client as partner in charge or manager keeps that.
  select * into kept from public.client_assignments a where a.firm_id = target_firm and a.client_id = client and (a.user_id = person or a.team_id = team);
  if kept.role is not null and kept.role <> 'staff' then
    raise exception 'already' using errcode = '23505';
  end if;
  if kept.role is not null then
    delete from public.client_assignments a where a.firm_id = target_firm and a.client_id = client and (a.user_id = person or a.team_id = team);
  end if;
  insert into public.client_assignments (firm_id, client_id, user_id, team_id, role, work)
  values (target_firm, client, person, team, 'staff', case when kept.role is null then desk end);
end;
$$;
revoke all on function public.set_desk(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.set_desk(uuid, uuid, text, uuid, uuid) to authenticated;

-- One return for one person (null: back to the desk). Anyone who does the work covers a return
-- nobody covers, or gives back their own; the owner, partners and managers give it to anyone who
-- sees the client.
create or replace function public.cover_return(target_firm uuid, task uuid, person uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  my_role text := public.member_role(target_firm);
  lead boolean := my_role in ('owner', 'partner', 'manager');
  t record;
  logged text := current_setting('app.logged', true);
begin
  select x.id, x.client_id, x.doer, x.status into t from public.tasks x where x.id = task and x.firm_id = target_firm and x.kind = 'compliance' for update;
  if t.id is null or t.status = 'filed' or my_role is null or my_role = 'front_desk' or not public.can_access_client(target_firm, t.client_id)
     or not lead and not (person = me and t.doer is null or person is null and t.doer = me)
     or person is not null and not exists (select 1 from public.firm_members m where m.firm_id = target_firm and m.user_id = person and m.status = 'active' and m.role <> 'front_desk'
       and (m.role in ('owner', 'partner') or (select f.settings ->> 'client_visibility' from public.firms f where f.id = target_firm) is distinct from 'restricted'
         or exists (select 1 from public.client_assignments a where a.firm_id = target_firm and a.client_id = t.client_id and (a.user_id = m.user_id or a.team_id = m.team_id)))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if t.doer is not distinct from person then
    return;
  end if;
  -- One line of its own instead of the plain "task changed".
  perform set_config('app.logged', 'on', true);
  update public.tasks set doer = person where id = task;
  perform set_config('app.logged', coalesce(logged, ''), true);
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values (target_firm, me, case when person is null then 'task.uncovered' else 'task.covered' end, 'task', task, jsonb_build_object('person', coalesce(person, t.doer)));
end;
$$;
revoke all on function public.cover_return(uuid, uuid, uuid) from public, anon;
grant execute on function public.cover_return(uuid, uuid, uuid) to authenticated;

-- Mine, as the Clients list's "Assigned to me" and the Calendar's "Mine" filter read it (computed
-- fields): a client given to the person or their team, or with a return they cover; a return of
-- the work their or their team's desk covers, unless someone covers it, or one they cover.
create or replace function public.is_mine(public.clients) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.client_assignments a join public.firm_members m on m.firm_id = a.firm_id and m.user_id = (select auth.uid())
      where a.firm_id = $1.firm_id and a.client_id = $1.id and (a.user_id = m.user_id or a.team_id = m.team_id))
    or exists (select 1 from public.tasks t where t.firm_id = $1.firm_id and t.client_id = $1.id and t.doer = (select auth.uid()) and t.status <> 'filed')
$$;
create or replace function public.is_mine(public.tasks) returns boolean
language sql stable set search_path = '' as $$
  select coalesce($1.doer = (select auth.uid()), false)
    or $1.doer is null and exists (select 1 from public.client_assignments a join public.firm_members m on m.firm_id = a.firm_id and m.user_id = (select auth.uid())
      where a.firm_id = $1.firm_id and a.client_id = $1.client_id and (a.user_id = m.user_id or a.team_id = m.team_id) and (a.work is null or a.work = public.work_of($1.code)))
$$;
revoke all on function public.is_mine(public.clients), public.is_mine(public.tasks) from public, anon;
grant execute on function public.is_mine(public.clients), public.is_mine(public.tasks) to authenticated;

-- Today's clients of a person also take in those with a return they cover.
create or replace function public.looked_after(target_firm uuid, clients uuid[]) returns setof uuid
language sql stable set search_path = '' as $$
  select u.id from unnest(clients) u(id)
  where (select public.member_role(target_firm)) in ('owner','partner') or u.id in (select public.my_clients(target_firm))
    or u.id in (select t.client_id from public.tasks t where t.firm_id = target_firm and t.doer = (select auth.uid()) and t.status <> 'filed')
$$;

-- As 20261109300000_assignment_by_work.sql and 20261112500000_tds_return_stage.sql, with cover: a
-- return someone covers is theirs alone (late clients also name the oldest late return and its doer).
drop function if exists public.late_clients(uuid, boolean);
create or replace function public.late_clients(target_firm uuid, mine boolean default false)
returns table(client_id uuid, client_name text, returns int, code text, period_key text, due_on date, task uuid, doer uuid)
language sql stable set search_path = '' as $$
  with theirs as (
    select not mine or (select public.member_role(target_firm)) in ('owner','partner') whole
  ), looked as (
    select w.client_id, w.work from public.my_work(target_firm) w where mine
  )
  select c.id,c.name,count(*)::int,(array_agg(t.code order by t.due_on,t.id))[1],
    (array_agg(t.period_key order by t.due_on,t.id))[1],min(t.due_on),
    (array_agg(t.id order by t.due_on,t.id))[1],(array_agg(t.doer order by t.due_on,t.id))[1]
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id cross join theirs
  where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and c.archived_at is null
    and t.due_on < (now() at time zone 'Asia/Kolkata')::date
    and (theirs.whole or t.doer=(select auth.uid()) or t.doer is null and exists(select 1 from looked w where w.client_id=c.id and (w.work is null or w.work=public.work_of(t.code))))
  group by c.id,c.name
  order by min(t.due_on),c.name
$$;

revoke all on function public.late_clients(uuid, boolean) from public, anon;
grant execute on function public.late_clients(uuid, boolean) to authenticated;

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
      and (theirs.whole or t.doer=(select auth.uid()) or t.doer is null and exists(select 1 from looked w where w.client_id=t.client_id and (w.work is null or w.work=public.work_of(t.code))))
  )
  select (select count(*)::int from due),(select count(*)::int from due where status='filed'),
    (select count(distinct r.client_id)::int from theirs, public.requests r join public.clients c on c.id=r.client_id and c.firm_id=r.firm_id and c.archived_at is null
      where r.firm_id=target_firm and r.kind='documents' and r.status='pending' and r.expires_at>now() and (theirs.whole or r.client_id in (select client_id from looked)))
$$;

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
      and (me.role in ('owner','partner') or (t.doer=(select auth.uid()) or t.doer is null and exists(select 1 from public.my_work(target_firm) x where x.client_id=t.client_id and (x.work is null or x.work=public.work_of(t.code))))
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
    where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and t.code ~ '^((GSTR1|GSTR3B|ITR)_|(TDS|TCS)_RET$)'
      and (me.role in ('owner','partner') or t.doer=me.id or t.doer is null and exists(select 1 from public.my_work(target_firm) x where x.client_id=t.client_id and (x.work is null or x.work=public.work_of(t.code))))
      and (t.due_on between w.today and w.today+w.days or exists(select 1 from public.documents d where d.firm_id=t.firm_id and d.client_id=t.client_id
        and d.prepared->>'status' in ('draft','approved') and d.prepared->>'registration'=t.registration_id::text
        and d.period_key=case when t.code ~ '^ITR_' then left(t.period_key,4) else t.period_key end))
  )
  select case when s.stage='draft' and c.checked then 'waiting' when s.stage='draft' then 'approve' when s.stage='approved' then 'approved'
      when s.stage in ('none','asked','in') or s.missing is not null then 'missing'
      when s.stage in ('figures','checked') then 'fill' else 'check' end,
    s.stage,w.id,s.form,w.client_id,w.name,w.code,w.period_key,w.due_on,s.open,s.missing
  from work w join public.return_stages(target_firm,array(select id from work)) s on s.task=w.id cross join me
  cross join lateral (
    select exists(select 1 from public.documents x cross join jsonb_array_elements(x.prepared->'sources') src
      join public.datasets d on d.id=(src->>'id')::uuid cross join jsonb_array_elements(d.data->'lines') l where x.id=s.form and l->>'by'=me.id::text) checked
  ) c
  where case
    when w.code ~ '_RET$' and s.stage not in ('draft','approved') then false
    when s.stage='draft' then me.role in ('owner','partner') or me.role='manager' and exists(select 1 from public.client_assignments a
        where a.firm_id=target_firm and a.client_id=w.client_id and (a.user_id=me.id and a.role='manager' or a.team_id=me.team_id) and (a.work is null or a.work=public.work_of(w.code)))
    when s.stage='filed' or s.stage<>'approved' and not w.soon then false
    else true
  end
  order by w.due_on,w.name
$$;

-- As 20261110700000_assignment_names.sql: a return given to someone for once rings their bell.
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
          'request.created', 'task.changed', 'notice.added', 'assignment.added', 'document.uploaded', 'form.prepared', 'form.approved', 'form.rejected', 'form.filed', 'task.covered')
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
    and (not mine or not exists (select 1 from assigned) or c.id in (select id from assigned) or x.details ->> 'person' = (select auth.uid())::text)
  order by x.at desc
  limit 20
$$;
revoke all on function public.activity_feed(uuid, timestamptz, boolean) from public, anon, authenticated, service_role;
grant execute on function public.activity_feed(uuid, timestamptz, boolean) to authenticated;
