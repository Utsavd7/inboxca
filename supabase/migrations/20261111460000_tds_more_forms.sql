-- TDS and TCS statements beyond Form No. 140 (20261111410000_tds_statements.sql): Form No. 138
-- (salary, was 24Q) for Q1 to Q3, Form No. 144 (payments to non residents, was 27Q) and Form No.
-- 143 (TCS, was 27EQ), each from its own figures (datasets, form codes TDS138, TDS144, TDS143)
-- and prepared, approved and downloaded as Form No. 140 is.

-- Protean's file formats, version 1.2 (22 Jul 2026), for tax year 2026-27 onwards. InboxCA writes
-- each itself (src/lib/tds.ts), so none is shipped. Form No. 138 for Q4 waits for its format.
insert into public.templates(form_code,version,valid_from,valid_until,status,source,mappings) values
  ('TDS138','1.2','2026-04-01',null,'active','{"file":"protean/Form138_Q1_Q3_File_Format_V1.2.xlsx","url":"https://tinpan.proteantech.in/downloads/e-tds/eTDS-download-regular.html","sha256":"d58fd86b69932c6a7a4f518990c17d2112f55c65042d9c3bf2799ed201cbaf6c"}','{"format":"txt"}'),
  ('TDS144','1.2','2026-04-01',null,'active','{"file":"protean/Form144_File_Format_V1.2.xlsx","url":"https://tinpan.proteantech.in/downloads/e-tds/eTDS-download-regular.html","sha256":"5e78534c065133936a4bb594f310c10a44e25a0825fe9f7ff023b342730fd5da"}','{"format":"txt"}'),
  ('TDS143','1.2','2026-04-01',null,'active','{"file":"protean/Form143_File_Format_V1.2.xlsx","url":"https://tinpan.proteantech.in/downloads/e-tds/eTDS-download-regular.html","sha256":"c487ddd78125433aefc4063ccb93ebe820156c42e1d2a58986ae110c50fc51a7"}','{"format":"txt"}')
on conflict(form_code,version) do update set valid_from=excluded.valid_from,valid_until=excluded.valid_until,status=excluded.status,source=excluded.source,mappings=excluded.mappings;

-- The TCS return: Rule 219(1) Table Sl. No. 4 (Form No. 143 for section 394(1)) and Rule 219(4),
-- the same due dates as the TDS statements: 31 July, 31 October, 31 January and 31 May
-- (https://www.incometaxindia.gov.in/w/rule-219-1, read 5 Nov 2026). Unconfirmed until a CA checks
-- it in the admin console, as every rule is. The TDS return covers Forms No. 138, 140 and 144.
insert into public.compliance_types (code, name, frequency, due_rule, source_url)
values ('TCS_RET', 'TCS return 143 (27EQ)', 'quarterly', '{"for": "tan", "after": 1, "day": 31, "except": {"03": {"after": 2, "day": 31}}}', 'https://www.incometaxindia.gov.in/w/rule-219-1')
on conflict (code, period_key) do nothing;
update public.compliance_types set name = 'TDS returns 138/140/144 (24Q/26Q/27Q)'
where code = 'TDS_RET' and period_key = '' and verified_on is null;

-- As 20261111410000_tds_statements.sql, for every statement on the client's TAN, named by its form.
create or replace function public.reserve_form(firm uuid, client uuid, registration uuid, form text, period text, template text, sources jsonb, person uuid, prefix text, extension text, choice jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.documents; number int; body jsonb; itr boolean := form ~ '^ITR[1-6]$'; tds boolean := form in ('TDS138','TDS140','TDS143','TDS144'); day date;
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
    values(firm,client,case when itr or tds then 'income_tax' else 'gst' end,case when itr then replace(form,'ITR','ITR-') when tds then 'Form No. '||substr(form,4) when form='GSTR1' then 'GSTR-1' else 'GSTR-3B' end,period,prefix||' - v'||number||'.'||extension,0,'','','internal',body) returning * into saved;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(firm,person,'form.started','document',saved.id,jsonb_build_object('version',number,'template',template)||choice);
  return jsonb_build_object('id',saved.id,'name',saved.name,'ready',false);
end;
$$;

-- As 20261111410000_tds_statements.sql: a filed Form No. 143 closes its quarter's TCS return; a
-- filed Form No. 138, 140 or 144 closes the TDS return once every other one with figures for the
-- quarter is filed too. The acknowledgement (the token number) stays on the statement, so the
-- next quarter's statement of the same form offers it.
create or replace function public.file_prepared_form(target uuid, person uuid, acknowledgement text, paper uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare doc public.documents; tds boolean; others boolean;
begin
  select * into doc from public.documents where id=target and prepared is not null;
  if not found or coalesce(length(trim(acknowledgement)),0)>80 or (paper is null and coalesce(length(trim(acknowledgement)),0)=0) then return false; end if;
  if not exists(select 1 from public.firm_members where firm_id=doc.firm_id and user_id=person and status='active') then return false; end if;
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(doc.prepared->'sources')) order by id for share;
  perform 1 from public.documents where id=target and prepared->>'status'='approved' for update;
  if not found or private.form_downloadable(target) is not true then return false; end if;
  if paper is not null and not exists(select 1 from public.documents where id=paper and firm_id=doc.firm_id and client_id=doc.client_id and status='filed' and (document_type in ('Acknowledgement','Filing record') or doc.prepared->>'form' ~ '^ITR[1-6]$' and document_type='ITR-V') and period_key=doc.period_key) then return false; end if;
  update public.documents set share_policy=null,prepared=prepared||jsonb_build_object('status','filed','acknowledgement',paper,'ack',coalesce(trim(acknowledgement),'')) where id=target;
  -- The quarter's TDS return is every TDS statement with figures on the TAN: it is filed once the
  -- last of them is; until then it is in progress.
  tds := doc.prepared->>'form' in ('TDS138','TDS140','TDS144');
  others := tds and exists(select 1 from public.datasets d where d.firm_id=doc.firm_id and d.client_id=doc.client_id and d.period_key=doc.period_key
    and d.data->>'registration'=doc.prepared->>'registration' and d.form_code in ('TDS138','TDS140','TDS144') and d.form_code<>doc.prepared->>'form'
    and not exists(select 1 from public.documents x where x.firm_id=d.firm_id and x.client_id=d.client_id and x.period_key=d.period_key and x.status<>'deleted'
      and x.prepared->>'form'=d.form_code and x.prepared->>'registration'=doc.prepared->>'registration' and x.prepared->>'status'='filed'));
  update public.tasks set status='in_progress' where others and firm_id=doc.firm_id and client_id=doc.client_id and registration_id=(doc.prepared->>'registration')::uuid
    and kind='compliance' and period_key=doc.period_key and code='TDS_RET' and status='upcoming';
  update public.tasks set status='filed',details=details||jsonb_build_object('ack',coalesce(trim(acknowledgement),''),'ack_document',paper,'filed_on',(now() at time zone 'Asia/Kolkata')::date,'prepared_form',target)
    where firm_id=doc.firm_id and client_id=doc.client_id and registration_id=(doc.prepared->>'registration')::uuid
      and kind='compliance' and period_key=case when doc.prepared->>'form' ~ '^ITR[1-6]$' then doc.period_key||'-03' else doc.period_key end and (code in ((doc.prepared->>'form')||'_M',(doc.prepared->>'form')||'_Q') or doc.prepared->>'form' ~ '^ITR[1-6]$' and code in ('ITR_NA','ITR_BIZ','ITR_AUDIT','ITR_TP') or tds and not others and code='TDS_RET' or doc.prepared->>'form'='TDS143' and code='TCS_RET');
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

-- As 20261111410000_tds_statements.sql: a quarter's TDS return is built from its Forms No. 138,
-- 140 and 144 figures on the TAN, its TCS return from its Form No. 143 figures.
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
      or t.code in ('TDS_RET','TCS_RET') and d.form_code=any(case t.code when 'TCS_RET' then '{TDS143}'::text[] else '{TDS138,TDS140,TDS144}' end)
        and d.period_key=t.period_key and d.data->>'registration'=t.registration_id::text)
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
        or t.code in ('TDS_RET','TCS_RET') and d.period_key=t.period_key and d.prepared->>'form'=any(case t.code when 'TCS_RET' then '{TDS143}'::text[] else '{TDS138,TDS140,TDS144}' end))
    order by (d.prepared->>'version')::int desc limit 1
  ) f on true
  cross join lateral (
    select bool_or(q.status='done') done,bool_or(q.status='pending' and q.expires_at>now()) asked from public.requests q
    where q.firm_id=t.firm_id and q.client_id=t.client_id and q.kind='documents' and q.details->>'period'=t.period_key
  ) q
  where t.firm_id=target_firm and t.id=any(task_ids) and t.kind='compliance'
$$;
