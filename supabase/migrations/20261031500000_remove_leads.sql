-- Leads are removed (the user, 26 Oct 2026). A lead was a client row at an earlier stage, so
-- those rows go, with the mail offered as a possible enquiry (the email stays in the firm's
-- mailbox), the enquiry form's and the enquiry capture's settings, and what only leads used:
-- clients.stage, details and notes_enc, the lead functions, policies and indexes, and the
-- log's check on the form's sender digest. Every client is then a client, and the lists no
-- longer keep to stage 'client'. Safe to run again, and where no lead was ever added.

-- No "client removed" line for each lead (log_change stands aside while app.logged is on).
select set_config('app.logged', 'on', false);
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'stage') then
    execute 'delete from public.clients where stage <> ''client''';
  end if;
end;
$$;
delete from public.email_events where reason_code = 'enquiry';
update public.connected_accounts set settings = settings - 'capture_enquiries' where settings ? 'capture_enquiries';
select set_config('app.logged', 'off', false);
update public.firms set settings = settings - 'enquiry_form' where settings ? 'enquiry_form';

-- Each member sees the clients and mail they saw before leads (20261018240000).
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (firm_id in (select public.open_firms()) or id in (select public.assigned_clients()));
drop policy if exists email_events_select on public.email_events;
create policy email_events_select on public.email_events for select to authenticated
  using (firm_id in (select public.my_firms()) and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients())));

drop function if exists public.add_form_lead(uuid, uuid, text, text, text, text, jsonb, text, text);
drop function if exists public.add_lead(uuid, uuid, text, text, text, text, jsonb, text, uuid);
drop function if exists public.dismiss_enquiry(uuid, uuid);
drop function if exists public.change_lead(uuid, uuid, text, text);
drop function if exists public.won_leads(uuid);
drop function if exists public.lead_firms();
drop function if exists private.put_lead(uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text);

drop index if exists public.clients_leads;
drop index if exists public.firms_enquiry_form;
alter table public.clients drop column if exists stage, drop column if exists details, drop column if exists notes_enc;
