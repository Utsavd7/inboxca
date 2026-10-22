-- A prepared file is a document, with its form, sources and approval beside it.
alter table public.documents add column prepared jsonb;
grant select(prepared) on public.documents to authenticated;
alter table public.requests drop constraint requests_kind_check;
alter table public.requests add constraint requests_kind_check check(kind in ('team_reply','documents','alert','import','permission','bulk_send','filing_download'));
create policy filing_download_read on public.requests as restrictive for select to authenticated
  using(kind<>'filing_download' or details->>'by'=(select auth.uid())::text);
create unique index prepared_versions on public.documents(firm_id,client_id,period_key,(prepared->>'form'),(prepared->>'registration'),((prepared->>'version')::int)) where prepared is not null;

create function private.form_sources_match(firm uuid, client uuid, form text, period text, sources jsonb)
returns boolean language sql stable set search_path='' as $$
  select jsonb_typeof(sources)='array' and jsonb_array_length(sources) between 1 and 25
    and (select count(distinct value->>'id') from jsonb_array_elements(sources))=jsonb_array_length(sources)
    and not exists (
      select 1 from jsonb_array_elements(sources) s left join public.datasets d on d.id=(s->>'id')::uuid
        and d.firm_id=firm and d.client_id=client and d.form_code=form and d.period_key=period and d.revision=(s->>'revision')::int
      where d.id is null or exists(select 1 from jsonb_array_elements(d.data->'lines') l where l->>'state' is distinct from 'confirmed')
    )
$$;
revoke all on function private.form_sources_match(uuid,uuid,text,text,jsonb) from public,anon,authenticated;

create function private.form_current(target uuid) returns boolean
language sql stable set search_path='' as $$
  select d.status<>'deleted' and d.drive_file_id<>''
    and private.form_sources_match(d.firm_id,d.client_id,d.prepared->>'form',d.period_key,d.prepared->'sources')
    and not exists(select 1 from public.documents newer where newer.firm_id=d.firm_id and newer.client_id=d.client_id and newer.period_key=d.period_key
      and newer.prepared->>'form'=d.prepared->>'form' and newer.prepared->>'registration'=d.prepared->>'registration'
      and (newer.prepared->>'version')::int>(d.prepared->>'version')::int)
  from public.documents d where d.id=target and d.prepared is not null
$$;
revoke all on function private.form_current(uuid) from public,anon,authenticated;

-- Reserve the name once. Retrying the same checked work resumes its version.
create function public.reserve_form(firm uuid, client uuid, registration uuid, form text, period text, template text, sources jsonb, person uuid, prefix text, extension text, choice jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.documents; number int; body jsonb;
begin
  if extension not in ('xlsx','json') or length(prefix)>180 or period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(firm::text||client::text||registration::text||form||period,0));
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(sources)) order by id for share;
  if private.form_sources_match(firm,client,form,period,sources) is not true
    or not exists(select 1 from public.client_registrations where id=registration and firm_id=firm and client_id=client and kind='gstin')
    or not exists(select 1 from public.templates t where t.form_code=form and t.version=template and t.status<>'draft'
      and t.valid_from<=(period||'-01')::date and (t.valid_until is null or t.valid_until>(period||'-01')::date)) then return null; end if;
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
    values(firm,client,'gst',case form when 'GSTR1' then 'GSTR-1' else 'GSTR-3B' end,period,prefix||' - v'||number||'.'||extension,0,'','','internal',body) returning * into saved;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(firm,person,'form.started','document',saved.id,jsonb_build_object('version',number,'template',template)||choice);
  return jsonb_build_object('id',saved.id,'name',saved.name,'ready',false);
end;
$$;
revoke all on function public.reserve_form(uuid,uuid,uuid,text,text,text,jsonb,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_form(uuid,uuid,uuid,text,text,text,jsonb,uuid,text,text,jsonb) to service_role;

create function public.finish_form(target uuid, firm uuid, person uuid, file text, checksum text, bytes bigint, permission uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare doc public.documents; second boolean;
begin
  select * into doc from public.documents where id=target and firm_id=firm and drive_file_id='' and prepared->>'status'='draft';
  if not found or file='' or checksum !~ '^[a-f0-9]{64}$' or bytes not between 1 and 25000000 then return false; end if;
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(doc.prepared->'sources')) order by id for share;
  perform 1 from public.documents where id=target and drive_file_id='' and prepared->>'status'='draft' for update;
  if not found then return false; end if;
  if private.form_sources_match(firm,doc.client_id,doc.prepared->>'form',doc.period_key,doc.prepared->'sources') is not true then return false; end if;
  if permission is not null then
    perform 1 from public.requests where id=permission and firm_id=firm and client_id=doc.client_id and kind='permission' and reason_code='edit_figures'
      and status='approved' and expires_at>now() and details->>'by'=person::text for update;
    if not found then return false; end if;
    update public.requests set status='used' where id=permission;
  end if;
  select coalesce((settings->>'second_form_approval')::boolean,false) into second from public.firms where id=firm;
  update public.documents set drive_file_id=file,sha256=checksum,size=bytes,
    prepared=jsonb_set(prepared,'{status}',to_jsonb(case when second then 'draft'::text else 'approved'::text end)) where id=target;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id) values(firm,person,'form.prepared','document',target);
  return true;
end;
$$;
revoke all on function public.finish_form(uuid,uuid,uuid,text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.finish_form(uuid,uuid,uuid,text,text,bigint,uuid) to service_role;

-- A correction ends every earlier approval at once. The saved files remain unchanged.
create function private.clear_form_approval() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.documents set prepared=jsonb_set(prepared,'{status}','"draft"')
    where firm_id=new.firm_id and client_id=new.client_id and prepared->>'status'='approved'
      and prepared->'sources' @> jsonb_build_array(jsonb_build_object('id',new.id));
  return new;
end;
$$;
create trigger figures_clear_forms after update of revision on public.datasets for each row execute function private.clear_form_approval();
revoke all on function private.clear_form_approval() from public,anon,authenticated,service_role;

-- Preparing a return never makes it a paper an email request can send.
create function private.keep_draft_internal() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.prepared is not null and new.prepared->>'status'<>'filed' then new.share_policy='internal'; end if;
  return new;
end;
$$;
create trigger prepared_internal before insert or update on public.documents for each row execute function private.keep_draft_internal();
revoke all on function private.keep_draft_internal() from public,anon,authenticated,service_role;

create function public.decide_form(target uuid, person uuid, decision text, reason jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare doc public.documents; allowed boolean;
begin
  select * into doc from public.documents where id=target and prepared is not null;
  if not found or decision not in ('approved','rejected') then return false; end if;
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(doc.prepared->'sources')) order by id for share;
  perform 1 from public.documents where id=target and prepared->>'status' in ('draft','approved') for update;
  if not found or private.form_current(target) is not true then return false; end if;
  select exists(select 1 from public.firm_members m where m.firm_id=doc.firm_id and m.user_id=person and m.status='active'
    and (m.role in ('owner','partner') or m.role='manager' and exists(
      select 1 from public.client_assignments a where a.firm_id=doc.firm_id and a.client_id=doc.client_id
        and (a.user_id=person and a.role='manager' or a.team_id=m.team_id)
    ))) into allowed;
  if not allowed then return false; end if;
  if decision='approved' and exists(
    select 1 from public.datasets d cross join lateral jsonb_array_elements(d.data->'lines') l
    where d.id in(select (value->>'id')::uuid from jsonb_array_elements(doc.prepared->'sources')) and l->>'by'=person::text
  ) then return false; end if;
  if decision='rejected' and (coalesce(reason->>'code','') not in ('figures','source','other') or coalesce(length(reason->>'text_enc'),0)<20) then return false; end if;
  update public.documents set prepared=jsonb_set(prepared,'{status}',to_jsonb(decision)) where id=target;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(doc.firm_id,person,case decision when 'approved' then 'form.approved' else 'form.rejected' end,'document',target,reason);
  return true;
end;
$$;
revoke all on function public.decide_form(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.decide_form(uuid,uuid,text,jsonb) to service_role;

create function private.form_downloadable(target uuid) returns boolean
language sql stable set search_path='' as $$
  select private.form_current(d.id) and d.prepared->>'status' in ('approved','filed')
    and (not coalesce((f.settings->>'second_form_approval')::boolean,false) or exists(
      select 1 from public.activity_log a where a.firm_id=d.firm_id and a.entity_id=d.id and a.action='form.approved'
    )) from public.documents d join public.firms f on f.id=d.firm_id where d.id=target
$$;
revoke all on function private.form_downloadable(uuid) from public,anon,authenticated;

-- The app issues a one-use question bound to the signed in person. Only its hash stays.
create function public.take_form_download(ticket uuid, person uuid, token_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare request public.requests; doc public.documents;
begin
  select * into request from public.requests where id=ticket and kind='filing_download'
    and status='pending' and expires_at>now() and details->>'by'=person::text and details->>'token_hash'=token_hash for update;
  if not found then return null; end if;
  select * into doc from public.documents where id=request.entity_id and firm_id=request.firm_id and client_id=request.client_id;
  if not found then return null; end if;
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(doc.prepared->'sources')) order by id for share;
  perform 1 from public.documents where id=doc.id for share;
  if private.form_downloadable(doc.id) is not true then return null; end if;
  update public.requests set status='done',details=details-'token_hash' where id=ticket;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id)
    values(doc.firm_id,person,'form.downloaded','document',doc.id);
  return doc.id;
end;
$$;
revoke all on function public.take_form_download(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.take_form_download(uuid,uuid,text) to service_role;

create function public.file_prepared_form(target uuid, person uuid, acknowledgement text, paper uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare doc public.documents;
begin
  select * into doc from public.documents where id=target and prepared is not null;
  if not found or length(trim(acknowledgement)) not between 1 and 80 then return false; end if;
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(doc.prepared->'sources')) order by id for share;
  perform 1 from public.documents where id=target and prepared->>'status'='approved' for update;
  if not found or private.form_downloadable(target) is not true then return false; end if;
  if paper is not null and not exists(select 1 from public.documents where id=paper and firm_id=doc.firm_id and client_id=doc.client_id and status='filed' and document_type='Acknowledgement') then return false; end if;
  update public.documents set prepared=jsonb_set(prepared,'{status}','"filed"') where id=target;
  update public.tasks set status='filed',details=details||jsonb_build_object('ack',trim(acknowledgement),'filed_on',(now() at time zone 'Asia/Kolkata')::date,'prepared_form',target)
    where firm_id=doc.firm_id and client_id=doc.client_id and registration_id=(doc.prepared->>'registration')::uuid
      and kind='compliance' and period_key=doc.period_key and code in ((doc.prepared->>'form')||'_M',(doc.prepared->>'form')||'_Q');
  perform public.cancel_jobs('task',id) from public.tasks where firm_id=doc.firm_id and client_id=doc.client_id
    and registration_id=(doc.prepared->>'registration')::uuid and period_key=doc.period_key and status='filed';
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(doc.firm_id,person,'form.filed','document',target,jsonb_build_object('ack',trim(acknowledgement),'paper',paper));
  return true;
end;
$$;
revoke all on function public.file_prepared_form(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.file_prepared_form(uuid,uuid,text,uuid) to service_role;

create function public.form_ready(target uuid) returns boolean
language sql stable security definer set search_path='' as $$ select coalesce(private.form_downloadable(target),false) $$;
revoke all on function public.form_ready(uuid) from public,anon,authenticated;
grant execute on function public.form_ready(uuid) to service_role;
