-- Today took about 12 seconds in a week with 1,200 returns due (2,400 GSTR-1 and GSTR-3B):
-- public.return_stages read each return's figures through public.return_drafts, one query a
-- return, each checking row level security again. Without a set search_path the function is
-- read into the one query instead (every name in it is schema qualified, and it runs as the
-- caller, so search_path changes nothing it can reach): 12 s became about 90 ms.
alter function public.return_drafts(uuid) reset search_path;

-- Pins are worked out only for the returns of clients the person looks after (public.my_clients,
-- as Today's list reads them, so a manager also sees their team's people's clients), not for
-- every return in the firm before keeping theirs. Who may approve a draft is unchanged.
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
      and (me.role in ('owner','partner') or t.client_id in (select public.my_clients(target_firm)))
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
        where a.firm_id=target_firm and a.client_id=w.client_id and (a.user_id=me.id and a.role='manager' or a.team_id=me.team_id)))
      and not exists(select 1 from public.documents x cross join jsonb_array_elements(x.prepared->'sources') src
        join public.datasets d on d.id=(src->>'id')::uuid cross join jsonb_array_elements(d.data->'lines') l where x.id=s.form and l->>'by'=me.id::text)
    when s.stage='filed' or s.stage<>'approved' and not w.soon then false
    else true
  end
  order by w.due_on,w.name
$$;
