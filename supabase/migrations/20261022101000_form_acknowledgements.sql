-- A portal acknowledgement or the firm's own number record closes the same work.
alter table public.requests drop constraint requests_kind_check;
alter table public.requests add constraint requests_kind_check check(kind in ('team_reply','documents','alert','import','permission','bulk_send','filing_download','form_confirmation'));
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
  if paper is not null and not exists(select 1 from public.documents where id=paper and firm_id=doc.firm_id and client_id=doc.client_id and status='filed' and document_type in ('Acknowledgement','Filing record') and period_key=doc.period_key) then return false; end if;
  update public.documents set prepared=prepared||jsonb_build_object('status','filed','acknowledgement',paper) where id=target;
  update public.tasks set status='filed',details=details||jsonb_build_object('ack',coalesce(trim(acknowledgement),''),'ack_document',paper,'filed_on',(now() at time zone 'Asia/Kolkata')::date,'prepared_form',target)
    where firm_id=doc.firm_id and client_id=doc.client_id and registration_id=(doc.prepared->>'registration')::uuid
      and kind='compliance' and period_key=doc.period_key and code in ((doc.prepared->>'form')||'_M',(doc.prepared->>'form')||'_Q');
  perform public.cancel_jobs('task',id) from public.tasks where firm_id=doc.firm_id and client_id=doc.client_id
    and registration_id=(doc.prepared->>'registration')::uuid and period_key=doc.period_key and status='filed';
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(doc.firm_id,person,'form.filed','document',target,jsonb_build_object('ack',trim(acknowledgement),'paper',paper));
  update public.requests set status='done' where firm_id=doc.firm_id and kind='form_confirmation' and entity_id=target and status='pending';
  if paper is not null then
    insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key) values(doc.firm_id,'form_ack','document',target,'form_ack:'||target) on conflict(idempotency_key) do nothing;
  end if;
  return true;
end;
$$;

-- The filing copy keeps its own name and period even when a correction is requested.
create function private.keep_form_name() returns trigger language plpgsql set search_path='' as $$
begin
  if old.prepared is not null and (new.name,new.document_type,new.work_type,new.period_key,new.client_id) is distinct from (old.name,old.document_type,old.work_type,old.period_key,old.client_id) then
    raise exception 'prepared_form_name';
  end if;
  return new;
end;
$$;
create trigger prepared_name before update on public.documents for each row execute function private.keep_form_name();
revoke all on function private.keep_form_name() from public,anon,authenticated,service_role;

-- A saved acknowledgement is a suggestion only. A person still confirms the filing.
create function private.match_form_ack() returns trigger language plpgsql security definer set search_path='' as $$
declare form uuid; matches int;
begin
  if new.document_type<>'Acknowledgement' or new.status<>'filed' or new.period_key='' then return new; end if;
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
create trigger match_form_ack after insert or update of document_type,period_key,status on public.documents for each row execute function private.match_form_ack();
revoke all on function private.match_form_ack() from public,anon,authenticated,service_role;
