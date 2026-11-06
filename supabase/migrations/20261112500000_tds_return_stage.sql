-- A quarter's TDS return is every Form No. 138, 140 and 144 statement with figures on its TAN
-- (20261111460000_tds_more_forms.sql), so where it stands is where the least advanced of them
-- stands, each measured against its own form's figures: one statement approved and another still
-- a draft is a draft. A statement filed on its own is done; the return is filed once each is
-- (public.file_prepared_form). Every other return stands as before: one group of all its figures.
create or replace function public.return_stages(target_firm uuid, task_ids uuid[])
returns table(task uuid, stage text, form uuid, open int, missing text)
language sql stable set search_path='' as $$
  select distinct on (t.id) t.id,s.stage,f.id,w.total,w.missing
  from public.tasks t
  cross join lateral (
    select g.*,(sum(g.open) over ())::int total from (
      select case when t.code='TDS_RET' then r.form_code end code,count(r.id)::int drafts,coalesce(sum(r.open),0)::int open,
        case when t.code ~ '^GSTR(1|3B)_' and not coalesce(bool_or(r.form_code='GSTR1'),false) then 'sales'
          when t.code ~ '^GSTR3B_' and not coalesce(bool_or(r.form_code='GSTR3B'),false) then 'credit'
          when t.code ~ '^ITR_' and not coalesce(bool_or(r.target is not null),false) then 'return' end missing,
        coalesce(jsonb_agg(jsonb_build_object('id',r.id)) filter (where r.id is not null),'[]') ids
      from (values(1)) one(x) left join public.return_drafts(t.id) r on true
      group by 1
    ) g
  ) w
  left join lateral (
    select d.id,d.prepared->>'status' status,d.size>0 finished,coalesce((d.prepared->>'external')::boolean,false) external,
      d.prepared ? 'filled' filled,d.prepared->'sources' @> w.ids covers,
      not exists(select 1 from jsonb_array_elements(d.prepared->'sources') s left join public.datasets x on x.id=(s->>'id')::uuid where x.id is null) present,
      not exists(select 1 from jsonb_array_elements(d.prepared->'sources') s left join public.datasets x on x.id=(s->>'id')::uuid and x.revision=(s->>'revision')::int where x.id is null) same,
      not exists(select 1 from jsonb_array_elements(d.prepared->'sources') s join public.datasets x on x.id=(s->>'id')::uuid
        cross join jsonb_array_elements(x.data->'lines') l where l->>'state' is distinct from 'confirmed') done
    from public.documents d
    where d.firm_id=t.firm_id and d.client_id=t.client_id and d.prepared is not null and d.status<>'deleted'
      and d.prepared->>'registration'=t.registration_id::text
      and (t.code ~ '^GSTR(1|3B)_' and d.period_key=t.period_key and d.prepared->>'form'=split_part(t.code,'_',1)
        or t.code ~ '^ITR_' and d.period_key=left(t.period_key,4) and d.prepared->>'form' ~ '^ITR[1-6]$'
        or t.code in ('TDS_RET','TCS_RET') and d.period_key=t.period_key and d.prepared->>'form'=any(case t.code when 'TCS_RET' then '{TDS143}'::text[] else '{TDS138,TDS140,TDS144}' end))
      and (w.code is null or d.prepared->>'form'=w.code)
    order by (d.prepared->>'version')::int desc limit 1
  ) f on true
  cross join lateral (
    select bool_or(q.status='done') done,bool_or(q.status='pending' and q.expires_at>now()) asked from public.requests q
    where q.firm_id=t.firm_id and q.client_id=t.client_id and q.kind='documents' and q.details->>'period'=t.period_key
  ) q
  cross join lateral (
    select case when t.status='filed' or w.code is not null and f.status='filed' then 'filed'
      when f.status in ('draft','approved') and f.finished and f.same and f.done and (f.external or f.covers) then f.status
      when f.filled and f.status='draft' and f.finished and f.present and f.covers and not f.done then 'filled'
      when f.external and f.status in ('draft','approved') then 'figures'
      when f.status='rejected' and f.same then 'rejected'
      when w.drafts>0 and w.open=0 and w.missing is null then 'checked'
      when w.drafts>0 then 'figures'
      when q.done then 'in'
      when q.asked then 'asked'
      else 'none' end stage
  ) s
  where t.firm_id=target_firm and t.id=any(task_ids) and t.kind='compliance'
  order by t.id,array_position('{none,asked,in,figures,checked,rejected,filled,draft,approved,filed}'::text[],s.stage)
$$;

-- As 20261109300000_assignment_by_work.sql, with TDS and TCS returns: a statement waiting for
-- the second approval is pinned to its approvers, and an approved one to download and file, as
-- GST and income tax drafts are (a TDS statement is never filled, so it has no other pin). An
-- approver who checked a figure of the draft cannot approve it (public.decide_form): theirs is a
-- 'waiting' pin, so Today says the return waits for someone else.
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
      and (me.role in ('owner','partner') or exists(select 1 from public.my_work(target_firm) x where x.client_id=t.client_id and (x.work is null or x.work=public.work_of(t.code))))
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
