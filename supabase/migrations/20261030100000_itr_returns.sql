-- Income tax returns ITR-1 to ITR-4 use the same checked sources and prepared versions as GST.
-- The period is the assessment year (2026 is AY 2026-27); the registration is the client's PAN.
-- form_sources_match already takes ITR drafts (20261024160000_gstr3b.sql).

create or replace function public.reserve_form(firm uuid, client uuid, registration uuid, form text, period text, template text, sources jsonb, person uuid, prefix text, extension text, choice jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.documents; number int; body jsonb; itr boolean := form ~ '^ITR[1-6]$'; day date;
begin
  if extension not in ('xlsx','json') or length(prefix)>180 or (case when itr then period !~ '^20[0-9]{2}$' else period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' end) then return null; end if;
  day=(period||case when itr then '-04-01' else '-01' end)::date;
  perform pg_advisory_xact_lock(hashtextextended(firm::text||client::text||registration::text||form||period,0));
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(sources)) order by id for share;
  if private.form_sources_match(firm,client,form,period,sources) is not true
    or not exists(select 1 from public.client_registrations where id=registration and firm_id=firm and client_id=client and kind=case when itr then 'pan' else 'gstin' end)
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
    values(firm,client,case when itr then 'income_tax' else 'gst' end,case when itr then replace(form,'ITR','ITR-') when form='GSTR1' then 'GSTR-1' else 'GSTR-3B' end,period,prefix||' - v'||number||'.'||extension,0,'','','internal',body) returning * into saved;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(firm,person,'form.started','document',saved.id,jsonb_build_object('version',number,'template',template)||choice);
  return jsonb_build_object('id',saved.id,'name',saved.name,'ready',false);
end;
$$;

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
      and kind='compliance' and period_key=case when doc.prepared->>'form' ~ '^ITR[1-6]$' then doc.period_key||'-03' else doc.period_key end and (code in ((doc.prepared->>'form')||'_M',(doc.prepared->>'form')||'_Q') or doc.prepared->>'form' ~ '^ITR[1-6]$' and code in ('ITR_NA','ITR_AUDIT'));
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

create or replace function private.match_form_ack() returns trigger language plpgsql security definer set search_path='' as $$
declare form uuid; matches int;
begin
  if new.document_type not in ('Acknowledgement','ITR-V') or new.status<>'filed' or new.period_key='' then return new; end if;
  select count(*),(array_agg(id))[1] into matches,form from public.documents d where d.firm_id=new.firm_id and d.client_id=new.client_id
    and d.period_key=new.period_key and d.work_type=new.work_type and d.prepared->>'status'='approved' and private.form_current(d.id);
  if matches=1 then
    insert into public.requests(firm_id,client_id,kind,entity_type,entity_id,reason_code,details)
      values(new.firm_id,new.client_id,'form_confirmation','document',form,'matched_ack',jsonb_build_object('paper',new.id))
      on conflict(kind,entity_type,entity_id) do nothing;
  end if;
  return new;
end;
$$;

-- A corrected return uploaded from outside InboxCA is checked like a corrected GST workbook.
create or replace function public.add_edited_form(target uuid, draft uuid, registration uuid, template text, person uuid, prefix text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc public.documents; work public.datasets; number int; body jsonb; itr boolean; form text; extension text; day date;
begin
  select * into doc from public.documents where id=target and status='filed' and drive_file_id<>'' and (name like '%.xlsx' or name like '%.json');
  if not found or length(prefix)>180 then return null; end if;
  select * into work from public.datasets where id=draft and firm_id=doc.firm_id and client_id=doc.client_id and form_code in ('GSTR1','ITR') and period_key=doc.period_key;
  if not found then return null; end if;
  itr=work.form_code='ITR';
  form=case when itr then work.data->'target'->>'form' else work.form_code end;
  extension=case when itr then 'json' else 'xlsx' end;
  if (itr and (form !~ '^ITR[1-4]$' or doc.period_key !~ '^20[0-9]{2}$')) or doc.name not like '%.'||extension then return null; end if;
  day=(doc.period_key||case when itr then '-04-01' else '-01' end)::date;
  perform pg_advisory_xact_lock(hashtextextended(doc.firm_id::text||doc.client_id::text||registration::text||work.form_code||doc.period_key,0));
  select * into work from public.datasets where id=draft and firm_id=doc.firm_id and client_id=doc.client_id and form_code in ('GSTR1','ITR') and period_key=doc.period_key for share;
  if not found then return null; end if;
  perform 1 from public.documents where id=target and prepared is null for update;
  if not found then return null; end if;
  if not exists(select 1 from public.client_registrations where id=registration and firm_id=doc.firm_id and client_id=doc.client_id and kind=case when itr then 'pan' else 'gstin' end)
    or not exists(select 1 from public.templates t where t.form_code=form and t.version=template and t.status<>'draft'
      and t.valid_from<=day and (t.valid_until is null or t.valid_until>day))
    or jsonb_array_length(work.data->'lines')=0 or exists(select 1 from jsonb_array_elements(work.data->'lines') l where l->>'state'<>'pending' or l->'source'->>'document'<>target::text or l->'source'->>'sha256'<>doc.sha256)
    then return null; end if;
  select coalesce(max((d.prepared->>'version')::int),0)+1 into number from public.documents d where d.firm_id=doc.firm_id and d.client_id=doc.client_id
    and d.period_key=doc.period_key and d.prepared->>'form'=form and d.prepared->>'registration'=registration::text;
  body=jsonb_build_object('form',form,'registration',registration,'version',number,'template',template,'sources',jsonb_build_array(jsonb_build_object('id',draft,'revision',work.revision)),
    'status','draft','external',true,'values',private.dataset_values(draft));
  update public.documents set prepared=body,share_policy='internal',name=prefix||' - v'||number||'.'||extension where id=target;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(doc.firm_id,person,'form.edited_outside','document',target,jsonb_build_object('version',number,'template',template));
  return jsonb_build_object('id',target,'name',prefix||' - v'||number||'.'||extension);
end;
$$;

-- The pinned AY 2026-27 schemas. Fields are read from the schema itself, so no field list is stored.
insert into public.templates(form_code,version,valid_from,valid_until,status,source,mappings) values
  ('ITR1','1.1','2026-04-01','2027-04-01','active','{"file":"itr/ITR-1_2026_Main_V1.1.json","url":"https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/ITR-1_2026_Main_V1.1.json","sha256":"6a0ef9f64065431879dcc724869d8455a640bcf11279d1818eb19f11448ce763"}','{"format":"json"}'),
  ('ITR2','1.2','2026-04-01','2027-04-01','active','{"file":"itr/ITR-2_2026_Main_V1.2.json","url":"https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-08/ITR-2_2026_Main_V1.2.json","sha256":"4e34389cb1cb1a0d9261fc6db8594d9bdfaf761f13d4af6b84c1862510e2aeeb"}','{"format":"json"}'),
  ('ITR3','1.1','2026-04-01','2027-04-01','active','{"file":"itr/ITR-3_2026_Main_V1.1.json","url":"https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-07/ITR-3_2026_Main_V1.1.json","sha256":"66f4bd705e0e0788fdacb37eb297ace56749d791b84f2f170f4da84236c25e8b"}','{"format":"json"}'),
  ('ITR4','1.1','2026-04-01','2027-04-01','active','{"file":"itr/ITR-4_2026_Main_V1.1.json","url":"https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-07/ITR-4_2026_Main_V1.1.json","sha256":"5e9af50083ad92faa684a02ae51693189b43df16b92c1da5a184026fc5cdc2ac"}','{"format":"json"}')
on conflict(form_code,version) do update set valid_from=excluded.valid_from,valid_until=excluded.valid_until,status=excluded.status,source=excluded.source,mappings=excluded.mappings;
