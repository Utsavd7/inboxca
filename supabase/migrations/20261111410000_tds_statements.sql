-- TDS statements, Form No. 140 (was Form 26Q), PLAN.md "TDS returns" (decided 4 Nov 2026):
-- InboxCA prepares the statement file from checked figures; the CA validates it with Protean's
-- File Validation Utility and files it. It uses the same checked figures (datasets, form code
-- TDS140, the quarter's last month as its period, the client's TAN as its registration), the
-- same prepared versions, approvals and filing downloads as GST and income tax returns.

-- The deductor's details the statement needs (src/lib/tds.ts deductorSchema), encrypted on the
-- client's TAN, changed by the owner, a partner or a manager as the TAN's services are; and the
-- columns a person matched for the client's payment and challan registers, as for its sales
-- and purchase registers.
alter table public.client_registrations add column if not exists details_enc text;
alter table public.clients add column if not exists tds_mapping_enc text;
grant select (details_enc) on public.client_registrations to authenticated;
grant update (details_enc) on public.client_registrations to authenticated;
drop trigger if exists registration_details_logged on public.client_registrations;
create trigger registration_details_logged after update of details_enc on public.client_registrations
  for each row execute function public.log_change('registration', 'client_id');

-- Protean's file format for Form No. 140, Q1 to Q4, version 1.2 (22 Jul 2026), for tax year
-- 2026-27 onwards. The format is not a file InboxCA fills, so none is shipped.
insert into public.templates(form_code,version,valid_from,valid_until,status,source,mappings) values
  ('TDS140','1.2','2026-04-01',null,'active','{"file":"protean/Form140_File_Format_V1.2.xlsx","url":"https://tinpan.proteantech.in/downloads/e-tds/eTDS-download-regular.html","sha256":"ec5d8a1138ac84fd5ed59f62aabb5b097479007d501cca98a27ba9c400a05f40"}','{"format":"txt"}')
on conflict(form_code,version) do update set valid_from=excluded.valid_from,valid_until=excluded.valid_until,status=excluded.status,source=excluded.source,mappings=excluded.mappings;

-- As 20261030100000_itr_returns.sql, with Form No. 140 on the client's TAN as a text file.
create or replace function public.reserve_form(firm uuid, client uuid, registration uuid, form text, period text, template text, sources jsonb, person uuid, prefix text, extension text, choice jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.documents; number int; body jsonb; itr boolean := form ~ '^ITR[1-6]$'; tds boolean := form='TDS140'; day date;
begin
  if extension not in ('xlsx','json','txt') or (extension='txt')<>tds or length(prefix)>180
    or (case when itr then period !~ '^20[0-9]{2}$' when tds then period !~ '^20[0-9]{2}-(03|06|09|12)$' else period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' end) then return null; end if;
  day=(period||case when itr then '-04-01' else '-01' end)::date;
  perform pg_advisory_xact_lock(hashtextextended(firm::text||client::text||registration::text||form||period,0));
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(sources)) order by id for share;
  if private.form_sources_match(firm,client,form,period,sources) is not true
    or not exists(select 1 from public.client_registrations where id=registration and firm_id=firm and client_id=client and kind=case when itr then 'pan' when tds then 'tan' else 'gstin' end)
    or tds and exists(select 1 from jsonb_array_elements(sources) s join public.datasets d on d.id=(s->>'id')::uuid where d.data->>'registration' is distinct from registration::text)
    or not exists(select 1 from public.templates t where t.form_code=form and t.version=template and t.status<>'draft'
      and t.valid_from<=day and (t.valid_until is null or t.valid_until>day)) then return null; end if;
  select * into saved from public.documents d where d.firm_id=firm and d.client_id=client and d.period_key=period and d.status<>'deleted'
    and d.prepared->>'form'=form and d.prepared->>'registration'=registration::text and d.prepared->>'template'=template
    and d.prepared->'sources'=sources and d.prepared->>'status'<>'rejected' order by (d.prepared->>'version')::int desc limit 1;
  if found and not exists(select 1 from public.documents d where d.firm_id=firm and d.client_id=client and d.period_key=period
    and d.prepared->>'form'=form and d.prepared->>'registration'=registration::text and (d.prepared->>'version')::int>(saved.prepared->>'version')::int)
    then return jsonb_build_object('id',saved.id,'name',saved.name,'ready',saved.drive_file_id<>''); end if;
  select coalesce(max((d.prepared->>'version')::int),0)+1 into number from public.documents d
    where d.firm_id=firm and d.client_id=client and d.period_key=period and d.prepared->>'form'=form and d.prepared->>'registration'=registration::text;
  body=jsonb_build_object('form',form,'registration',registration,'version',number,'template',template,'sources',sources,'status','draft');
  insert into public.documents(firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id,share_policy,prepared)
    values(firm,client,case when itr or tds then 'income_tax' else 'gst' end,case when itr then replace(form,'ITR','ITR-') when tds then 'Form No. 140' when form='GSTR1' then 'GSTR-1' else 'GSTR-3B' end,period,prefix||' - v'||number||'.'||extension,0,'','','internal',body) returning * into saved;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(firm,person,'form.started','document',saved.id,jsonb_build_object('version',number,'template',template)||choice);
  return jsonb_build_object('id',saved.id,'name',saved.name,'ready',false);
end;
$$;

-- As 20261031010000_calendar_tp_presumptive.sql: a filed Form No. 140 closes its quarter's TDS
-- return on the same TAN.
create or replace function public.file_prepared_form(target uuid, person uuid, acknowledgement text, paper uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare doc public.documents;
begin
  select * into doc from public.documents where id=target and prepared is not null;
  if not found or coalesce(length(trim(acknowledgement)),0)>80 or (paper is null and coalesce(length(trim(acknowledgement)),0)=0) then return false; end if;
  if not exists(select 1 from public.firm_members where firm_id=doc.firm_id and user_id=person and status='active') then return false; end if;
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(doc.prepared->'sources')) order by id for share;
  perform 1 from public.documents where id=target and prepared->>'status'='approved' for update;
  if not found or private.form_downloadable(target) is not true then return false; end if;
  if paper is not null and not exists(select 1 from public.documents where id=paper and firm_id=doc.firm_id and client_id=doc.client_id and status='filed' and (document_type in ('Acknowledgement','Filing record') or doc.prepared->>'form' ~ '^ITR[1-6]$' and document_type='ITR-V') and period_key=doc.period_key) then return false; end if;
  update public.documents set share_policy=null,prepared=prepared||jsonb_build_object('status','filed','acknowledgement',paper) where id=target;
  update public.tasks set status='filed',details=details||jsonb_build_object('ack',coalesce(trim(acknowledgement),''),'ack_document',paper,'filed_on',(now() at time zone 'Asia/Kolkata')::date,'prepared_form',target)
    where firm_id=doc.firm_id and client_id=doc.client_id and registration_id=(doc.prepared->>'registration')::uuid
      and kind='compliance' and period_key=case when doc.prepared->>'form' ~ '^ITR[1-6]$' then doc.period_key||'-03' else doc.period_key end and (code in ((doc.prepared->>'form')||'_M',(doc.prepared->>'form')||'_Q') or doc.prepared->>'form' ~ '^ITR[1-6]$' and code in ('ITR_NA','ITR_BIZ','ITR_AUDIT','ITR_TP') or doc.prepared->>'form'='TDS140' and code='TDS_RET');
  perform public.cancel_jobs('task',id) from public.tasks where firm_id=doc.firm_id and client_id=doc.client_id
    and registration_id=(doc.prepared->>'registration')::uuid and period_key=case when doc.prepared->>'form' ~ '^ITR[1-6]$' then doc.period_key||'-03' else doc.period_key end and status='filed';
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(doc.firm_id,person,'form.filed','document',target,jsonb_build_object('ack',trim(acknowledgement),'paper',paper));
  update public.requests set status='done' where firm_id=doc.firm_id and kind='form_confirmation' and entity_id=target and status='pending';
  if paper is not null then
    insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key) values(doc.firm_id,'form_ack','document',target,'form_ack:'||target) on conflict(idempotency_key) do nothing;
  end if;
  return true;
end;
$$;

-- As 20261031900000_return_work.sql (no search_path, 20261101800000_return_pins_speed.sql): a
-- quarter's TDS return is built from the quarter's Form No. 140 figures on its TAN.
create or replace function public.return_drafts(task_id uuid)
returns table(id uuid, revision int, form_code text, open int, wrong int, document uuid, target text)
language sql stable as $$
  select d.id,d.revision,d.form_code,
    (select count(*)::int from jsonb_array_elements(d.data->'lines') l where l->>'state' is distinct from 'confirmed'),
    (select count(*)::int from jsonb_array_elements(d.data->'lines') l where l->>'state'='rejected'),
    (d.data->'lines'->0->'source'->>'document')::uuid,d.data->'target'->>'form'
  from public.tasks t join public.datasets d on d.firm_id=t.firm_id and d.client_id=t.client_id
  where t.id=task_id and t.kind='compliance'
    and not exists(select 1 from public.documents x where x.id=(d.data->'lines'->0->'source'->>'document')::uuid and x.prepared is not null)
    and (t.code ~ '^GSTR(1|3B)_' and d.period_key=t.period_key and (d.form_code='GSTR3B' and t.code ~ '^GSTR3B_'
        or d.form_code='GSTR1' and coalesce(d.data->>'registration',(select min(r.id::text) from public.client_registrations r
          where r.firm_id=t.firm_id and r.client_id=t.client_id and r.kind='gstin' having count(*)=1))=t.registration_id::text)
      or t.code ~ '^ITR_' and d.form_code='ITR' and d.period_key=left(t.period_key,4)
      or t.code='TDS_RET' and d.form_code='TDS140' and d.period_key=t.period_key and d.data->>'registration'=t.registration_id::text)
  order by d.form_code,d.id
$$;

create or replace function public.return_stages(target_firm uuid, task_ids uuid[])
returns table(task uuid, stage text, form uuid, open int, missing text)
language sql stable set search_path='' as $$
  select t.id,
    case when t.status='filed' then 'filed'
      when f.status in ('draft','approved') and f.finished and f.same and f.done and (f.external or f.covers) then f.status
      when f.filled and f.status='draft' and f.finished and f.present and f.covers and not f.done then 'filled'
      when f.external and f.status in ('draft','approved') then 'figures'
      when f.status='rejected' and f.same then 'rejected'
      when w.drafts>0 and w.open=0 and w.missing is null then 'checked'
      when w.drafts>0 then 'figures'
      when q.done then 'in'
      when q.asked then 'asked'
      else 'none' end,
    f.id,w.open,w.missing
  from public.tasks t
  cross join lateral (
    select count(*)::int drafts,coalesce(sum(r.open),0)::int open,
      case when t.code ~ '^GSTR(1|3B)_' and not coalesce(bool_or(r.form_code='GSTR1'),false) then 'sales'
        when t.code ~ '^GSTR3B_' and not coalesce(bool_or(r.form_code='GSTR3B'),false) then 'credit'
        when t.code ~ '^ITR_' and not coalesce(bool_or(r.target is not null),false) then 'return' end missing,
      coalesce(jsonb_agg(jsonb_build_object('id',r.id)),'[]') ids
    from public.return_drafts(t.id) r
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
        or t.code='TDS_RET' and d.period_key=t.period_key and d.prepared->>'form'='TDS140')
    order by (d.prepared->>'version')::int desc limit 1
  ) f on true
  cross join lateral (
    select bool_or(q.status='done') done,bool_or(q.status='pending' and q.expires_at>now()) asked from public.requests q
    where q.firm_id=t.firm_id and q.client_id=t.client_id and q.kind='documents' and q.details->>'period'=t.period_key
  ) q
  where t.firm_id=target_firm and t.id=any(task_ids) and t.kind='compliance'
$$;
