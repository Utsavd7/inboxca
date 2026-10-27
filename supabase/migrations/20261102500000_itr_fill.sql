-- ITR returns join Fill and the automatic fill (PLAN.md "Plain English and Fill", as the user set
-- it on 26 Oct 2026) on the GST rules of 20261031900000_return_work.sql. An ITR-1 to ITR-4 is
-- filled in the form its team chose on its own page, from the figures entered for it and the
-- figures read from the client's papers for the assessment year, checked or not. Its draft is
-- never approved, downloaded or filed until every figure is checked, and src/lib/fill.ts and the
-- file worker leave to a person, with a plain reason, any return whose form, official schema,
-- software ID or details are not there yet. The period is the year's key (2026 is AY 2026-27,
-- 2027 tax year 2026-27), its task's period the March that ends the year of income (2026-03),
-- the registration the client's PAN.

-- As in 20261031900000_return_work.sql, for an ITR too. A year whose ITR is filed in any form is
-- never filled again.
create or replace function public.fill_form(firm uuid, client uuid, registration uuid, form text, period text, template text, sources jsonb, person uuid, prefix text, extension text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.documents; number int; itr boolean := form ~ '^ITR[1-4]$'; day date;
begin
  if extension not in ('xlsx','json') or length(prefix)>180
    or not (form in ('GSTR1','GSTR3B') and period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or itr and period ~ '^20[0-9]{2}$') then return null; end if;
  day=(period||case when itr then '-04-01' else '-01' end)::date;
  perform pg_advisory_xact_lock(hashtextextended(firm::text||client::text||registration::text||form||period,0));
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(sources)) order by id for share;
  if exists(select 1 from public.documents d where d.firm_id=firm and d.client_id=client and d.period_key=period
      and (d.prepared->>'form'=form or itr and d.prepared->>'form' ~ '^ITR[1-6]$') and d.prepared->>'registration'=registration::text and d.prepared->>'status'='filed')
    or exists(select 1 from public.tasks t where t.firm_id=firm and t.client_id=client and t.registration_id=registration and t.kind='compliance'
      and t.status='filed' and (t.period_key=period and t.code in (form||'_M',form||'_Q') or itr and t.period_key=period||'-03' and t.code ~ '^ITR_')) then return null; end if;
  if private.form_sources_match(firm,client,form,period,sources) then
    return public.reserve_form(firm,client,registration,form,period,template,sources,person,prefix,extension);
  end if;
  if private.form_sources_filled(firm,client,form,period,sources) is not true
    or not exists(select 1 from public.client_registrations where id=registration and firm_id=firm and client_id=client and kind=case when itr then 'pan' else 'gstin' end)
    or not exists(select 1 from public.templates t where t.form_code=form and t.version=template and t.status<>'draft'
      and t.valid_from<=day and (t.valid_until is null or t.valid_until>day)) then return null; end if;
  select * into saved from public.documents d where d.firm_id=firm and d.client_id=client and d.period_key=period and d.status<>'deleted'
    and d.prepared->>'form'=form and d.prepared->>'registration'=registration::text and d.prepared->>'template'=template and d.prepared ? 'filled'
    and d.prepared->>'status'='draft'
    and (select array_agg(value->>'id' order by value->>'id') from jsonb_array_elements(d.prepared->'sources'))=(select array_agg(value->>'id' order by value->>'id') from jsonb_array_elements(sources))
    order by (d.prepared->>'version')::int desc limit 1;
  if found and not exists(select 1 from public.documents d where d.firm_id=firm and d.client_id=client and d.period_key=period
    and d.prepared->>'form'=form and d.prepared->>'registration'=registration::text and (d.prepared->>'version')::int>(saved.prepared->>'version')::int) then
    -- A fill still being saved finishes with the later revisions of its same figures.
    if saved.drive_file_id='' and saved.prepared->'sources' is distinct from sources then update public.documents set prepared=jsonb_set(prepared,'{sources}',sources) where id=saved.id; end if;
    return jsonb_build_object('id',saved.id,'name',saved.name,'ready',saved.drive_file_id<>'');
  end if;
  select coalesce(max((d.prepared->>'version')::int),0)+1 into number from public.documents d
    where d.firm_id=firm and d.client_id=client and d.period_key=period and d.prepared->>'form'=form and d.prepared->>'registration'=registration::text;
  insert into public.documents(firm_id,client_id,work_type,document_type,period_key,name,size,sha256,drive_file_id,share_policy,prepared)
    values(firm,client,case when itr then 'income_tax' else 'gst' end,case when itr then replace(form,'ITR','ITR-') when form='GSTR1' then 'GSTR-1' else 'GSTR-3B' end,period,prefix||' - v'||number||' (to check).'||extension,0,'','','internal',
      jsonb_build_object('form',form,'registration',registration,'version',number,'template',template,'sources',sources,'status','draft','filled',true)) returning * into saved;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(firm,person,'form.started','document',saved.id,jsonb_build_object('version',number,'template',template,'filled',true));
  return jsonb_build_object('id',saved.id,'name',saved.name,'ready',false);
end;
$$;

-- As in 20261031900000_return_work.sql, for the year's ITR when the client's papers or the
-- entered figures for that year change.
create or replace function private.fill_changed_returns() returns trigger
language plpgsql security definer set search_path='' as $$
declare itr boolean := new.form_code='ITR';
begin
  if new.form_code not in ('GSTR1','GSTR3B','ITR') then return new; end if;
  if tg_op='UPDATE' and private.values_of(old.data) is distinct from private.values_of(new.data) then
    update public.documents set prepared=prepared-'filled' where firm_id=new.firm_id and client_id=new.client_id and prepared ? 'filled'
      and prepared->'sources' @> jsonb_build_array(jsonb_build_object('id',new.id));
  end if;
  insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key)
    select t.firm_id,'fill_return','task',t.id,'fill_return:'||t.id||':'||new.id||':'||new.revision
    from public.tasks t join public.firms f on f.id=t.firm_id cross join lateral public.return_stages(t.firm_id,array[t.id]) s
    where t.firm_id=new.firm_id and t.client_id=new.client_id and t.kind='compliance' and t.status<>'filed'
      and t.period_key=case when itr then new.period_key||'-03' else new.period_key end
      and t.code ~ case new.form_code when 'GSTR1' then '^GSTR(1|3B)_' when 'ITR' then '^ITR_' else '^GSTR3B_' end
      and s.stage in ('figures','checked') and s.missing is null
      and (s.stage='checked' or t.due_on<=(now() at time zone 'Asia/Kolkata')::date+coalesce((f.settings->>'pin_days')::int,5)
        or exists(select 1 from public.documents d where d.firm_id=t.firm_id and d.client_id=t.client_id and d.status<>'deleted' and d.period_key=new.period_key
          and d.prepared->>'registration'=t.registration_id::text and (d.prepared->>'form'=split_part(t.code,'_',1) or itr and d.prepared->>'form' ~ '^ITR[1-6]$')))
  on conflict(idempotency_key) do nothing;
  return new;
end;
$$;

-- As in 20261031900000_return_work.sql, with each ITR among the returns the morning run fills.
create or replace function private.queue_due_fills() returns void
language sql security definer set search_path='' as $$
  insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key)
  select t.firm_id,'fill_return','task',t.id,'fill_return:'||t.id||':'||(now() at time zone 'Asia/Kolkata')::date
  from public.tasks t join public.firms f on f.id=t.firm_id and f.status in ('active','grace')
  cross join lateral public.return_stages(t.firm_id,array[t.id]) s
  where t.kind='compliance' and t.status<>'filed' and t.code ~ '^(GSTR1|GSTR3B|ITR)_'
    and t.due_on between (now() at time zone 'Asia/Kolkata')::date-30 and (now() at time zone 'Asia/Kolkata')::date+coalesce((f.settings->>'pin_days')::int,5)
    and s.stage in ('figures','checked') and s.missing is null
  on conflict(idempotency_key) do nothing
$$;
