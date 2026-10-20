-- Three days late: tell the client's active partner, or the owner when there is none.
create function private.queue_return_alerts() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key)
  select t.firm_id,'return_alert','task',t.id,'return_alert:' || t.id
  from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  where t.kind='compliance' and t.status<>'filed' and c.archived_at is null
    and t.due_on <= (now() at time zone 'Asia/Kolkata')::date-3
    and not coalesce((t.details->>'return_alerted')::boolean,false)
  on conflict(idempotency_key) do nothing
$$;
revoke all on function private.queue_return_alerts() from public,anon,authenticated,service_role;
select cron.schedule('return-alerts','*/5 * * * *','select private.queue_return_alerts()');

create function private.keep_return_alert() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.details->>'return_alerted'='true' then new.details := new.details || '{"return_alerted":true}'; end if;
  return new;
end;
$$;
create trigger return_alert_kept before update of details on public.tasks for each row
  when(old.kind='compliance') execute function private.keep_return_alert();

create function public.claim_return_alert(task_id uuid) returns uuid[]
language sql security definer set search_path = '' as $$
  with claimed as (
    update public.tasks t set details=t.details || '{"return_alerted":true}'
    from public.clients c where t.id=task_id and c.id=t.client_id and c.firm_id=t.firm_id
      and c.archived_at is null and t.kind='compliance' and t.status<>'filed'
      and t.due_on <= (now() at time zone 'Asia/Kolkata')::date-3
      and not coalesce((t.details->>'return_alerted')::boolean,false)
    returning t.firm_id,t.client_id
  ), partners as (
    select m.user_id from claimed t join public.firm_members m on m.firm_id=t.firm_id
    where m.role='partner' and m.status='active' and exists(select 1 from public.client_assignments a
      where a.firm_id=t.firm_id and a.client_id=t.client_id and a.role='partner_in_charge'
        and (a.user_id=m.user_id or a.team_id=m.team_id))
  ) select array_agg(user_id) from (
    select user_id from partners union select m.user_id from claimed t join public.firm_members m on m.firm_id=t.firm_id
    where m.role='owner' and m.status='active' and not exists(select 1 from partners)
  ) people
$$;
revoke all on function public.claim_return_alert(uuid) from public,anon,authenticated;
grant execute on function public.claim_return_alert(uuid) to service_role;

create function public.late_returns(target_firm uuid) returns table(id uuid,client_name text,due_on date)
language sql stable set search_path = '' as $$
  with partners as (
    select a.client_id,m.user_id from public.client_assignments a join public.firm_members m on m.firm_id=a.firm_id
      and (a.user_id=m.user_id or a.team_id=m.team_id)
    where a.firm_id=target_firm and a.role='partner_in_charge' and m.role='partner' and m.status='active'
  ) select t.id,c.name,t.due_on from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id
  join public.firm_members m on m.firm_id=t.firm_id and m.user_id=(select auth.uid())
  where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and c.archived_at is null
    and t.due_on <= (now() at time zone 'Asia/Kolkata')::date-3
    and (exists(select 1 from partners p where p.client_id=t.client_id and p.user_id=m.user_id)
      or (m.role='owner' and not exists(select 1 from partners p where p.client_id=t.client_id)))
  order by t.due_on,t.id
$$;
revoke all on function public.late_returns(uuid) from public,anon;
grant execute on function public.late_returns(uuid) to authenticated;
