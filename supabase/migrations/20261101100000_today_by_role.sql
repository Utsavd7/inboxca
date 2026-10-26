-- Today by role (user, 26 Oct 2026: "simple minimal dash for each manager, staff and admin"):
-- what Today reads for one person, kept to the clients they look after whenever their own list
-- is asked for. Row level security still applies (security invoker).

-- The clients this person looks after by assignment, as public.looks_after reads them: their own,
-- their team's, and a manager's team's people's. Read once per query, as a set, so a firm of any
-- size is not checked client by client; the owner and partners look after every client.
create or replace function public.my_clients(target_firm uuid) returns setof uuid
language sql stable set search_path = '' as $$
  select a.client_id from public.client_assignments a
  join public.firm_members m on m.firm_id = a.firm_id and m.user_id = (select auth.uid())
  where a.firm_id = target_firm and (select public.member_role(target_firm)) is not null
    and (a.user_id = m.user_id or a.team_id = m.team_id
         or m.role = 'manager' and a.user_id in (select t.user_id from public.firm_members t where t.firm_id = target_firm and t.team_id = m.team_id))
$$;
revoke all on function public.my_clients(uuid) from public, anon;
grant execute on function public.my_clients(uuid) to authenticated;

-- Late clients, only the person's own when mine is set.
drop function if exists public.late_clients(uuid);
create or replace function public.late_clients(target_firm uuid, mine boolean default false)
returns table(client_id uuid, client_name text, returns int, code text, period_key text, due_on date)
language sql stable set search_path = '' as $$
  select c.id,c.name,count(*)::int,(array_agg(t.code order by t.due_on,t.id))[1],
    (array_agg(t.period_key order by t.due_on,t.id))[1],min(t.due_on)
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and c.archived_at is null
    and t.due_on < (now() at time zone 'Asia/Kolkata')::date
    and (not mine or (select public.member_role(target_firm)) in ('owner','partner') or c.id in (select public.my_clients(target_firm)))
  group by c.id,c.name
  order by min(t.due_on),c.name
$$;
revoke all on function public.late_clients(uuid, boolean) from public, anon;
grant execute on function public.late_clients(uuid, boolean) to authenticated;

-- Of these clients, the ones this person looks after.
create or replace function public.looked_after(target_firm uuid, clients uuid[]) returns setof uuid
language sql stable set search_path = '' as $$
  select u.id from unnest(clients) u(id)
  where (select public.member_role(target_firm)) in ('owner','partner') or u.id in (select public.my_clients(target_firm))
$$;
revoke all on function public.looked_after(uuid, uuid[]) from public, anon;
grant execute on function public.looked_after(uuid, uuid[]) to authenticated;

-- Today's This week: the returns due from since to until and how many of them are filed, and
-- the clients asked for papers that are not all in yet; the person's own clients when mine is set.
create or replace function public.work_numbers(target_firm uuid, since date, until date, mine boolean default false)
returns table(due int, filed int, waiting int)
language sql stable set search_path = '' as $$
  with theirs as (
    select not mine or (select public.member_role(target_firm)) in ('owner','partner') whole, array(select public.my_clients(target_firm) where mine) ids
  ), due as (
    select t.status from theirs, public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null
    where t.firm_id=target_firm and t.kind='compliance' and t.due_on between since and until and (theirs.whole or t.client_id = any(theirs.ids))
  )
  select (select count(*)::int from due),(select count(*)::int from due where status='filed'),
    (select count(distinct r.client_id)::int from theirs, public.requests r join public.clients c on c.id=r.client_id and c.firm_id=r.firm_id and c.archived_at is null
      where r.firm_id=target_firm and r.kind='documents' and r.status='pending' and r.expires_at>now() and (theirs.whole or r.client_id = any(theirs.ids)))
$$;
revoke all on function public.work_numbers(uuid, date, date, boolean) from public, anon;
grant execute on function public.work_numbers(uuid, date, date, boolean) to authenticated;

-- A manager's busiest people: the five in their team with the most returns not filed and due
-- by until (late ones too) on clients assigned to them by name.
create or replace function public.team_load(target_firm uuid, until date)
returns table(user_id uuid, returns int)
language sql stable set search_path = '' as $$
  select a.user_id,count(distinct t.id)::int
  from public.firm_members me
  join public.firm_members m on m.firm_id=me.firm_id and m.team_id=me.team_id and m.status='active'
  join public.client_assignments a on a.firm_id=m.firm_id and a.user_id=m.user_id
  join public.clients c on c.id=a.client_id and c.firm_id=a.firm_id and c.archived_at is null
  join public.tasks t on t.firm_id=a.firm_id and t.client_id=a.client_id and t.kind='compliance' and t.status<>'filed' and t.due_on<=until
  where me.firm_id=target_firm and me.user_id=(select auth.uid())
  group by a.user_id
  order by 2 desc,1
  limit 5
$$;
revoke all on function public.team_load(uuid, date) from public, anon;
grant execute on function public.team_load(uuid, date) to authenticated;
