-- The value check uses encrypted fields, never a hash of an amount someone could guess.
create function private.dataset_values(target uuid) returns text language sql stable set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_object('lines',(select jsonb_agg(value-'state'-'by'-'at' order by value->>'id') from jsonb_array_elements(data->'lines')),'checks',data->'checks')::text,'UTF8')),'hex')
  from public.datasets where id=target
$$;
revoke all on function private.dataset_values(uuid) from public,anon,authenticated;

create function public.add_edited_form(target uuid, draft uuid, registration uuid, template text, person uuid, prefix text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc public.documents; work public.datasets; number int; body jsonb;
begin
  select * into doc from public.documents where id=target and status='filed' and drive_file_id<>'' and name like '%.xlsx';
  if not found or length(prefix)>180 then return null; end if;
  select * into work from public.datasets where id=draft and firm_id=doc.firm_id and client_id=doc.client_id and form_code='GSTR1' and period_key=doc.period_key;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(doc.firm_id::text||doc.client_id::text||registration::text||work.form_code||doc.period_key,0));
  select * into work from public.datasets where id=draft and firm_id=doc.firm_id and client_id=doc.client_id and form_code='GSTR1' and period_key=doc.period_key for share;
  if not found then return null; end if;
  perform 1 from public.documents where id=target and prepared is null for update;
  if not found then return null; end if;
  if not exists(select 1 from public.client_registrations where id=registration and firm_id=doc.firm_id and client_id=doc.client_id and kind='gstin')
    or not exists(select 1 from public.templates t where t.form_code=work.form_code and t.version=template and t.status<>'draft'
      and t.valid_from<=(doc.period_key||'-01')::date and (t.valid_until is null or t.valid_until>(doc.period_key||'-01')::date))
    or jsonb_array_length(work.data->'lines')=0 or exists(select 1 from jsonb_array_elements(work.data->'lines') l where l->>'state'<>'pending' or l->'source'->>'document'<>target::text or l->'source'->>'sha256'<>doc.sha256)
    then return null; end if;
  select coalesce(max((d.prepared->>'version')::int),0)+1 into number from public.documents d where d.firm_id=doc.firm_id and d.client_id=doc.client_id
    and d.period_key=doc.period_key and d.prepared->>'form'=work.form_code and d.prepared->>'registration'=registration::text;
  body=jsonb_build_object('form',work.form_code,'registration',registration,'version',number,'template',template,'sources',jsonb_build_array(jsonb_build_object('id',draft,'revision',work.revision)),
    'status','draft','external',true,'values',private.dataset_values(draft));
  update public.documents set prepared=body,share_policy='internal',name=prefix||' - v'||number||'.xlsx' where id=target;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(doc.firm_id,person,'form.edited_outside','document',target,jsonb_build_object('version',number,'template',template));
  return jsonb_build_object('id',target,'name',prefix||' - v'||number||'.xlsx');
end;
$$;
revoke all on function public.add_edited_form(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.add_edited_form(uuid,uuid,uuid,text,uuid,text) to service_role;

create or replace function private.clear_form_approval() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.documents set prepared=jsonb_set(prepared,'{status}','"draft"')
    where firm_id=new.firm_id and client_id=new.client_id and prepared->>'status'='approved'
      and prepared->'sources' @> jsonb_build_array(jsonb_build_object('id',new.id));
  -- A checked upload is the same file only while its encrypted values and sources agree.
  if not exists(select 1 from jsonb_array_elements(new.data->'lines') l where l->>'state' is distinct from 'confirmed') then
    update public.documents d set prepared=prepared||jsonb_build_object('sources',jsonb_build_array(jsonb_build_object('id',new.id,'revision',new.revision)),
      'status',case when coalesce((f.settings->>'second_form_approval')::boolean,false) then 'draft' else 'approved' end)
      from public.firms f where f.id=new.firm_id and d.firm_id=new.firm_id and d.client_id=new.client_id
        and d.prepared->>'status' in ('draft','approved') and d.prepared->>'external'='true'
        and d.prepared->'sources' @> jsonb_build_array(jsonb_build_object('id',new.id)) and jsonb_array_length(d.prepared->'sources')=1
        and d.prepared->>'values'=private.dataset_values(new.id);
  end if;
  return new;
end;
$$;
