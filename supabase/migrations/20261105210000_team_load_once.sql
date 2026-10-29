-- A manager's busiest people (20261101100000_today_by_role.sql), with the row rules checked once
-- instead of on every row read: under them each firm_members row scanned asked member_role(),
-- and a manager's Today ran into the 8 second limit. It keeps their meaning: nothing for someone
-- not signed in to the firm (firm_members' rule), and only the clients this person may see
-- (client_assignments', clients' and tasks' rule: the whole firm, else the clients given to them
-- or their team).
create or replace function public.team_load(target_firm uuid, until date)
returns table(user_id uuid, returns int)
language sql stable security definer set search_path = '' as $$
  select a.user_id,count(distinct t.id)::int
  from public.firm_members me
  join public.firm_members m on m.firm_id=me.firm_id and m.team_id=me.team_id and m.status='active'
  join public.client_assignments a on a.firm_id=m.firm_id and a.user_id=m.user_id
  join public.clients c on c.id=a.client_id and c.firm_id=a.firm_id and c.archived_at is null
  join public.tasks t on t.firm_id=a.firm_id and t.client_id=a.client_id and t.kind='compliance' and t.status<>'filed' and t.due_on<=until
  where me.firm_id=target_firm and me.user_id=(select auth.uid())
    and (select public.member_role(target_firm)) is not null
    and (target_firm in (select public.open_firms()) or a.client_id in (select public.assigned_clients()))
  group by a.user_id
  order by 2 desc,1
  limit 5
$$;
revoke all on function public.team_load(uuid, date) from public, anon;
grant execute on function public.team_load(uuid, date) to authenticated;
