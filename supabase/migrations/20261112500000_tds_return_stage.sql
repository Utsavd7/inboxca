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
