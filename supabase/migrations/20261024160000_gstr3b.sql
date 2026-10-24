-- M6: the GSTR-3B file. It is built from the month's confirmed GSTR-1 figures and GSTR-2B
-- credit, so its sources may be GSTR-1 drafts as well as its own. The JSON is the one the
-- official offline utility uploads (Prepare Offline), checked against GSTN's save schema v7.1.
-- InboxCA offers it from April 2025; earlier months are prepared on the portal. The source
-- check keeps the income tax rule (an ITR draft serves ITR-1 to ITR-6, or the one form it names).
create or replace function private.form_sources_match(firm uuid, client uuid, form text, period text, sources jsonb)
returns boolean language sql stable set search_path='' as $$
  select jsonb_typeof(sources)='array' and jsonb_array_length(sources) between 1 and 25
    and (select count(distinct value->>'id') from jsonb_array_elements(sources))=jsonb_array_length(sources)
    and not exists (
      select 1 from jsonb_array_elements(sources) s left join public.datasets d on d.id=(s->>'id')::uuid
        and d.firm_id=firm and d.client_id=client and d.period_key=period and d.revision=(s->>'revision')::int
        and (d.form_code=case when form ~ '^ITR[1-6]$' then 'ITR' else form end or form='GSTR3B' and d.form_code='GSTR1')
      where d.id is null or (form ~ '^ITR[1-6]$' and d.data->'target'->>'form' is not null and d.data->'target'->>'form'<>form)
        or exists(select 1 from jsonb_array_elements(d.data->'lines') l where l->>'state' is distinct from 'confirmed')
    )
$$;

update public.templates set status='active',valid_from='2025-04-01',
  mappings='{"format":"json","validator":{"file":"gstn/gstr3b-v7.1-request-schema.json","sha256":"043917ea6fcbe34e97e851fde6cfe9a472aaefb2be503e9438973b16e67480ae"}}'
  where form_code='GSTR3B' and version='7.1';
