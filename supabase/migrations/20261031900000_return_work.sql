-- Returns that move by themselves (PLAN.md 5.7.4 and "Less work for the firm", as the user set
-- it on 26 Oct 2026): Fill makes a return's draft from every figure InboxCA has read, checked
-- or not, by hand or by itself from the firm's days before the due date. A draft with a figure
-- not yet checked can be looked at but never approved, downloaded, filed or sent: decide_form,
-- form_ready, take_form_download and file_prepared_form still need every figure checked
-- (private.form_current), and prepared files stay internal. InboxCA never files a return.

-- What a figure says, without who checked it: a change here means a fill shows old values.
create or replace function private.values_of(data jsonb) returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_object('lines',(select jsonb_agg(value-'state'-'by'-'at' order by value->>'id') from jsonb_array_elements(data->'lines')),'checks',data->'checks')::text,'UTF8')),'hex')
$$;
revoke all on function private.values_of(jsonb) from public,anon,authenticated,service_role;

-- As private.form_sources_match, but a figure may still wait for its check. One marked wrong
-- may not be filled.
create or replace function private.form_sources_filled(firm uuid, client uuid, form text, period text, sources jsonb)
returns boolean language sql stable set search_path='' as $$
  select jsonb_typeof(sources)='array' and jsonb_array_length(sources) between 1 and 25
    and (select count(distinct value->>'id') from jsonb_array_elements(sources))=jsonb_array_length(sources)
    and not exists (
      select 1 from jsonb_array_elements(sources) s left join public.datasets d on d.id=(s->>'id')::uuid
        and d.firm_id=firm and d.client_id=client and d.period_key=period and d.revision=(s->>'revision')::int
        and (d.form_code=case when form ~ '^ITR[1-6]$' then 'ITR' else form end or form='GSTR3B' and d.form_code='GSTR1')
      where d.id is null or (form ~ '^ITR[1-6]$' and d.data->'target'->>'form' is not null and d.data->'target'->>'form'<>form)
        or exists(select 1 from jsonb_array_elements(d.data->'lines') l where l->>'state'='rejected')
    )
$$;
revoke all on function private.form_sources_filled(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;

-- Fill: as reserve_form (20261030100000_itr_returns.sql), under the same lock, so one return
-- has one current draft however many people or runs fill it. Work whose every figure is checked
-- goes through reserve_form itself. Otherwise the draft is a fill, named "(to check)": filling
-- again resumes it while its figures have only been checked since (it keeps filled until a
-- figure changes), and after a change it is the next version. A filed return is never filled.
create or replace function public.fill_form(firm uuid, client uuid, registration uuid, form text, period text, template text, sources jsonb, person uuid, prefix text, extension text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.documents; number int;
begin
  if extension not in ('xlsx','json') or length(prefix)>180 or form not in ('GSTR1','GSTR3B') or period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(firm::text||client::text||registration::text||form||period,0));
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(sources)) order by id for share;
  if exists(select 1 from public.documents d where d.firm_id=firm and d.client_id=client and d.period_key=period
      and d.prepared->>'form'=form and d.prepared->>'registration'=registration::text and d.prepared->>'status'='filed')
    or exists(select 1 from public.tasks t where t.firm_id=firm and t.client_id=client and t.registration_id=registration and t.kind='compliance'
      and t.period_key=period and t.code in (form||'_M',form||'_Q') and t.status='filed') then return null; end if;
  if private.form_sources_match(firm,client,form,period,sources) then
    return public.reserve_form(firm,client,registration,form,period,template,sources,person,prefix,extension);
  end if;
  if private.form_sources_filled(firm,client,form,period,sources) is not true
    or not exists(select 1 from public.client_registrations where id=registration and firm_id=firm and client_id=client and kind='gstin')
    or not exists(select 1 from public.templates t where t.form_code=form and t.version=template and t.status<>'draft'
      and t.valid_from<=(period||'-01')::date and (t.valid_until is null or t.valid_until>(period||'-01')::date)) then return null; end if;
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
    values(firm,client,'gst',case form when 'GSTR1' then 'GSTR-1' else 'GSTR-3B' end,period,prefix||' - v'||number||' (to check).'||extension,0,'','','internal',
      jsonb_build_object('form',form,'registration',registration,'version',number,'template',template,'sources',sources,'status','draft','filled',true)) returning * into saved;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(firm,person,'form.started','document',saved.id,jsonb_build_object('version',number,'template',template,'filled',true));
  return jsonb_build_object('id',saved.id,'name',saved.name,'ready',false);
end;
$$;
revoke all on function public.fill_form(uuid,uuid,uuid,text,text,text,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fill_form(uuid,uuid,uuid,text,text,text,jsonb,uuid,text,text) to service_role;

-- As in 20261022100000_prepared_forms.sql, for a fill too. Only work whose every figure is
-- checked is approved by itself (when the firm has no second approval); a fill stays a draft.
create or replace function public.finish_form(target uuid, firm uuid, person uuid, file text, checksum text, bytes bigint, permission uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare doc public.documents; second boolean; whole boolean;
begin
  select * into doc from public.documents where id=target and firm_id=firm and drive_file_id='' and prepared->>'status'='draft';
  if not found or file='' or checksum !~ '^[a-f0-9]{64}$' or bytes not between 1 and 25000000 then return false; end if;
  perform 1 from public.datasets where id in(select (value->>'id')::uuid from jsonb_array_elements(doc.prepared->'sources')) order by id for share;
  select * into doc from public.documents where id=target and drive_file_id='' and prepared->>'status'='draft' for update;
  if not found then return false; end if;
  if private.form_sources_filled(firm,doc.client_id,doc.prepared->>'form',doc.period_key,doc.prepared->'sources') is not true then return false; end if;
  whole=private.form_sources_match(firm,doc.client_id,doc.prepared->>'form',doc.period_key,doc.prepared->'sources') and not doc.prepared ? 'filled';
  if permission is not null then
    perform 1 from public.requests where id=permission and firm_id=firm and client_id=doc.client_id and kind='permission' and reason_code='edit_figures'
      and status='approved' and expires_at>now() and details->>'by'=person::text for update;
    if not found then return false; end if;
    update public.requests set status='used' where id=permission;
  end if;
  select coalesce((settings->>'second_form_approval')::boolean,false) into second from public.firms where id=firm;
  update public.documents set drive_file_id=file,sha256=checksum,size=bytes,
    prepared=jsonb_set(prepared,'{status}',to_jsonb(case when whole and not second then 'approved'::text else 'draft'::text end)) where id=target;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id) values(firm,person,'form.prepared','document',target);
  return true;
end;
$$;

-- The figures a return is built from, as the client page offers them: the month's GSTR-1
-- registers for its GSTIN (every register when the client has one GSTIN), with the month's
-- GSTR-2B credit for GSTR-3B; for an ITR, the year's figures. A file corrected outside InboxCA
-- is its own source and is left out. open: figures not yet checked; wrong: marked wrong.
drop function if exists public.return_pins(uuid);
drop function if exists public.return_stages(uuid,uuid[]);
drop function if exists public.return_drafts(uuid);
create function public.return_drafts(task_id uuid)
returns table(id uuid, revision int, form_code text, open int, wrong int, document uuid, target text)
language sql stable set search_path='' as $$
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
      or t.code ~ '^ITR_' and d.form_code='ITR' and d.period_key=left(t.period_key,4))
  order by d.form_code,d.id
$$;

-- Where each return stands: filed; approved or draft (ready to approve: the latest file, made
-- from the current revision of every figure, all checked); filled (the latest fill, its figures
-- unchanged since, some not checked yet); rejected (sent back, nothing changed since); checked
-- (every figure checked, not filled yet); figures (some to check, or a part missing: sales,
-- credit or the return itself); in or asked (papers); none.
create function public.return_stages(target_firm uuid, task_ids uuid[])
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
        or t.code ~ '^ITR_' and d.period_key=left(t.period_key,4) and d.prepared->>'form' ~ '^ITR[1-6]$')
    order by (d.prepared->>'version')::int desc limit 1
  ) f on true
  cross join lateral (
    select bool_or(q.status='done') done,bool_or(q.status='pending' and q.expires_at>now()) asked from public.requests q
    where q.firm_id=t.firm_id and q.client_id=t.client_id and q.kind='documents' and q.details->>'period'=t.period_key
  ) q
  where t.firm_id=target_firm and t.id=any(task_ids) and t.kind='compliance'
$$;

-- Today's pinned returns for the signed in person: a draft to approve goes to whoever may
-- approve it (decide_form: the owner, a partner or the client's manager, never someone who
-- checked its figures); an approved file, and from the firm's pin_days (5 by default) before
-- the due date a return still waiting for papers, a fill or checks, go to the client's
-- assigned people and their team. The owner and partners see the whole firm.
create function public.return_pins(target_firm uuid)
returns table(kind text, stage text, task uuid, form uuid, client uuid, client_name text, code text, period_key text, due_on date, open int, missing text)
language sql stable set search_path='' as $$
  with me as (
    select m.user_id id,m.role,m.team_id from public.firm_members m where m.firm_id=target_firm and m.user_id=(select auth.uid()) and m.status='active'
  ), window_days as (
    select (now() at time zone 'Asia/Kolkata')::date today,coalesce((select (f.settings->>'pin_days')::int from public.firms f where f.id=target_firm),5) days
  ), work as (
    select t.id,t.client_id,c.name,t.code,t.period_key,t.due_on,t.due_on between w.today and w.today+w.days soon
    from public.tasks t join public.clients c on c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null cross join window_days w
    where t.firm_id=target_firm and t.kind='compliance' and t.status<>'filed' and t.code ~ '^(GSTR1|GSTR3B|ITR)_'
      and (t.due_on between w.today and w.today+w.days or exists(select 1 from public.documents d where d.firm_id=t.firm_id and d.client_id=t.client_id
        and d.prepared->>'status' in ('draft','approved') and d.prepared->>'registration'=t.registration_id::text
        and d.period_key=case when t.code ~ '^ITR_' then left(t.period_key,4) else t.period_key end))
  )
  select case when s.stage='draft' then 'approve' when s.stage='approved' then 'approved'
      when s.stage in ('none','asked','in') or s.missing is not null then 'missing'
      when s.stage in ('figures','checked') then 'fill' else 'check' end,
    s.stage,w.id,s.form,w.client_id,w.name,w.code,w.period_key,w.due_on,s.open,s.missing
  from work w join public.return_stages(target_firm,array(select id from work)) s on s.task=w.id cross join me
  where case
    when s.stage='draft' then (me.role in ('owner','partner') or me.role='manager' and exists(select 1 from public.client_assignments a
        where a.firm_id=target_firm and a.client_id=w.client_id and (a.user_id=me.id and a.role='manager' or a.team_id=me.team_id)))
      and not exists(select 1 from public.documents x cross join jsonb_array_elements(x.prepared->'sources') src
        join public.datasets d on d.id=(src->>'id')::uuid cross join jsonb_array_elements(d.data->'lines') l where x.id=s.form and l->>'by'=me.id::text)
    when s.stage='filed' or s.stage<>'approved' and not w.soon then false
    else me.role in ('owner','partner') or exists(select 1 from public.client_assignments a
      where a.firm_id=target_firm and a.client_id=w.client_id and (a.user_id=me.id or a.team_id=me.team_id))
  end
  order by w.due_on,w.name
$$;

revoke all on function public.return_drafts(uuid) from public,anon;
revoke all on function public.return_stages(uuid,uuid[]) from public,anon;
revoke all on function public.return_pins(uuid) from public,anon;
grant execute on function public.return_drafts(uuid) to authenticated,service_role;
grant execute on function public.return_stages(uuid,uuid[]) to authenticated,service_role;
grant execute on function public.return_pins(uuid) to authenticated,service_role;

-- A GSTR-1 or GSTR-3B is filled (src/jobs/fill-return.ts) when its figures change: once every
-- figure is checked (the file to approve), from the firm's days before the due date, and again
-- after a figure changes. A check alone leaves the fill as it is.
create or replace function private.fill_changed_returns() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.form_code not in ('GSTR1','GSTR3B') then return new; end if;
  if tg_op='UPDATE' and private.values_of(old.data) is distinct from private.values_of(new.data) then
    update public.documents set prepared=prepared-'filled' where firm_id=new.firm_id and client_id=new.client_id and prepared ? 'filled'
      and prepared->'sources' @> jsonb_build_array(jsonb_build_object('id',new.id));
  end if;
  insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key)
    select t.firm_id,'fill_return','task',t.id,'fill_return:'||t.id||':'||new.id||':'||new.revision
    from public.tasks t join public.firms f on f.id=t.firm_id cross join lateral public.return_stages(t.firm_id,array[t.id]) s
    where t.firm_id=new.firm_id and t.client_id=new.client_id and t.kind='compliance' and t.status<>'filed' and t.period_key=new.period_key
      and t.code ~ case new.form_code when 'GSTR1' then '^GSTR(1|3B)_' else '^GSTR3B_' end
      and s.stage in ('figures','checked') and s.missing is null
      and (s.stage='checked' or t.due_on<=(now() at time zone 'Asia/Kolkata')::date+coalesce((f.settings->>'pin_days')::int,5)
        or exists(select 1 from public.documents d where d.firm_id=t.firm_id and d.client_id=t.client_id and d.status<>'deleted' and d.period_key=t.period_key
          and d.prepared->>'registration'=t.registration_id::text and d.prepared->>'form'=split_part(t.code,'_',1)))
  on conflict(idempotency_key) do nothing;
  return new;
end;
$$;
revoke all on function private.fill_changed_returns() from public,anon,authenticated,service_role;
drop trigger if exists figures_fill_returns on public.datasets;
create trigger figures_fill_returns after insert or update of revision on public.datasets for each row execute function private.fill_changed_returns();

-- Every morning at 06:00 India time: each GST return from the firm's days before its due date
-- (and up to a month late) whose papers are in but which is not filled yet.
create or replace function private.queue_due_fills() returns void
language sql security definer set search_path='' as $$
  insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key)
  select t.firm_id,'fill_return','task',t.id,'fill_return:'||t.id||':'||(now() at time zone 'Asia/Kolkata')::date
  from public.tasks t join public.firms f on f.id=t.firm_id and f.status in ('active','grace')
  cross join lateral public.return_stages(t.firm_id,array[t.id]) s
  where t.kind='compliance' and t.status<>'filed' and t.code ~ '^GSTR(1|3B)_'
    and t.due_on between (now() at time zone 'Asia/Kolkata')::date-30 and (now() at time zone 'Asia/Kolkata')::date+coalesce((f.settings->>'pin_days')::int,5)
    and s.stage in ('figures','checked') and s.missing is null
  on conflict(idempotency_key) do nothing
$$;
revoke all on function private.queue_due_fills() from public,anon,authenticated,service_role;
select cron.schedule('fill-due-returns','30 0 * * *','select private.queue_due_fills()');
