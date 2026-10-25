-- One open GSTR-2A draft for the client's month, as for GSTR-2B credit. Sources add pending lines to it.
create unique index if not exists datasets_gstr2a_period on public.datasets(firm_id,client_id,period_key) where form_code='GSTR2A';
