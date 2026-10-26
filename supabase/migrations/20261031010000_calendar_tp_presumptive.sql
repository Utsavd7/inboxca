-- Two return types the official text dates exactly; both stay unconfirmed until a CA checks
-- them in the admin console.
-- A return where transfer pricing applies (s.92E of the 1961 Act, s.172 of the 2025 Act) is
-- due 30 November: Finance Act, 2026 (No. 4 of 2026), s.5 and s.66, Table Sl. No. 1.
insert into public.compliance_types (code, name, frequency, due_rule, source_url)
values ('ITR_TP', 'ITR (transfer pricing)', 'yearly', '{"for": "pan", "after": 8, "day": 30, "one_of": "itr"}', 'https://egazette.gov.in/WriteReadData/2026/271439.pdf')
on conflict (code, period_key) do nothing;
-- Presumptive income (Income-tax Act, 2025, s.58(2) Table Sl. No. 1 or 3; the old s.44AD and
-- s.44ADA): the whole advance tax by 15 March, s.408(2). Only a resident individual, HUF or a
-- firm other than an LLP may declare it (s.58(11)). It replaces the four instalments.
insert into public.compliance_types (code, name, frequency, due_rule, client_kinds, source_url)
values ('ADV_TAX_P', 'Advance tax (presumptive, by 15 March)', 'yearly', '{"for": "pan", "after": 0, "day": 15, "one_of": "advance_tax"}', '{individual,business}', 'https://egazette.gov.in/WriteReadData/2025/265620.pdf')
on conflict (code, period_key) do nothing;
update public.compliance_types set due_rule = due_rule || '{"one_of": "advance_tax"}'
where code = 'ADV_TAX' and period_key = '' and verified_on is null and not due_rule ? 'one_of';

-- As in 20261031000000_itr_due_dates.sql, with the transfer pricing return among the ITR
-- tasks a filed ITR closes.
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
      and kind='compliance' and period_key=case when doc.prepared->>'form' ~ '^ITR[1-6]$' then doc.period_key||'-03' else doc.period_key end and (code in ((doc.prepared->>'form')||'_M',(doc.prepared->>'form')||'_Q') or doc.prepared->>'form' ~ '^ITR[1-6]$' and code in ('ITR_NA','ITR_BIZ','ITR_AUDIT','ITR_TP'));
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
