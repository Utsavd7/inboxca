-- Corrected ITR files use the same source checks as corrected GST workbooks.
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
  if (itr and (form not in ('ITR1','ITR4') or doc.period_key !~ '^20[0-9]{2}$')) or doc.name not like '%.'||extension then return null; end if;
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
