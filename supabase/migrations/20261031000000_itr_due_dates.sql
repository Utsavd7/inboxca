-- Return due dates under the Finance Act, 2026 (No. 4 of 2026, gazette of 30 March 2026,
-- https://egazette.gov.in/WriteReadData/2026/271439.pdf): s.5 replaced Explanation 2 to
-- s.139(1) of the Income-tax Act, 1961 from 1 March 2026, and s.66 the same table in
-- s.263(1) of the Income-tax Act, 2025 for tax year 2026-27 on. A business or profession
-- whose accounts need no audit, and a partner of such a firm, files by 31 August; any other
-- assessee without an audit by 31 July; audit cases by 31 October. The dates stay marked
-- unconfirmed until a CA checks them in the admin console.
insert into public.compliance_types (code, name, frequency, due_rule, client_kinds, source_url)
values ('ITR_BIZ', 'ITR (business, no audit)', 'yearly', '{"for": "pan", "after": 5, "day": 31, "one_of": "itr"}', '{individual,business,llp}', 'https://egazette.gov.in/WriteReadData/2026/271439.pdf')
on conflict (code, period_key) do nothing;
-- A proprietor or professional (an individual) may have either; a business or LLP has business income.
update public.compliance_types set name = 'ITR (no business, no audit)', client_kinds = '{individual,trust}', source_url = 'https://egazette.gov.in/WriteReadData/2026/271439.pdf'
where code = 'ITR_NA' and period_key = '' and verified_on is null;

-- The new forms under the Income-tax Rules, 2026 (rule 219: Form No. 138 for salary, 140 for
-- other payments; rule 47: Form No. 26 merges Form 3CA, 3CB and 3CD), with the old names a
-- firm still knows them by.
update public.compliance_types set name = 'TDS returns 138/140 (24Q/26Q)', source_url = 'https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf'
where code = 'TDS_RET' and period_key = '' and verified_on is null;
update public.compliance_types set name = 'Tax audit report, Form 26 (3CA/3CB/3CD)', source_url = 'https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf'
where code = 'TAX_AUDIT' and period_key = '' and verified_on is null;

-- Business and LLP clients move to the 31 August return. Their returns not yet filed move
-- first, so the services change below keeps them; filed returns keep their record.
update public.tasks t set code = 'ITR_BIZ', due_on = private.due_on(x.due_rule, to_date(t.period_key, 'YYYY-MM'), null)
from public.clients c, public.compliance_types x
where c.firm_id = t.firm_id and c.id = t.client_id and c.kind in ('business', 'llp')
  and t.kind = 'compliance' and t.code = 'ITR_NA' and t.status <> 'filed' and x.code = 'ITR_BIZ' and x.period_key = '';
update public.client_registrations r set services = array_replace(r.services, 'ITR_NA', 'ITR_BIZ')
from public.clients c
where c.firm_id = r.firm_id and c.id = r.client_id and c.kind in ('business', 'llp') and 'ITR_NA' = any (r.services);

-- As in 20261030100000_itr_returns.sql, with the 31 August return among the ITR tasks a filed
-- ITR closes.
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
      and kind='compliance' and period_key=case when doc.prepared->>'form' ~ '^ITR[1-6]$' then doc.period_key||'-03' else doc.period_key end and (code in ((doc.prepared->>'form')||'_M',(doc.prepared->>'form')||'_Q') or doc.prepared->>'form' ~ '^ITR[1-6]$' and code in ('ITR_NA','ITR_BIZ','ITR_AUDIT'));
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
