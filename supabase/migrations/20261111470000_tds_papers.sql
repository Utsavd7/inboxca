-- TDS papers (TDS registers, salary registers and TDS challans) are filed under the client's
-- TDS work, in a TDS folder beside GST and Income tax.
alter table public.documents drop constraint if exists documents_work_type_check;
alter table public.documents add constraint documents_work_type_check check (work_type in ('gst', 'income_tax', 'tax_audit', 'audit', 'roc', 'tds', 'other'));
