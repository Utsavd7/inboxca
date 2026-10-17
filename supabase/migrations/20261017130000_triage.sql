-- M3 step 3: triage (PLAN.md 5.5, D8). Each client or contact email gets one label, made
-- in memory from its subject, text and attachment names by rules first; only the label,
-- who decided (rule, AI, staff) and a reason code are kept. Anything the rules cannot
-- place is "other" and becomes a Needs team reply request: staff answer it from their
-- own mailbox and mark it done. A person may correct a label; the correction is logged.

alter table public.email_events
  add column label text check (label in ('records_past', 'records_current', 'notice_received', 'data_gst', 'data_income_tax', 'data_tax_audit', 'other')),
  add column decision_source text check (decision_source in ('rule', 'confirmed_mapping', 'ai', 'staff')),
  add column reason_code text check (length(reason_code) <= 40);
grant update (label, decision_source) on public.email_events to authenticated;
create policy email_events_update on public.email_events for update to authenticated
  using (public.member_role(firm_id) is not null and (client_id is null or public.can_access_client(firm_id, client_id)))
  with check (decision_source = 'staff');
create trigger email_events_logged after update of label on public.email_events
  for each row execute function public.log_change('email', 'id', 'email');

-- Work for the firm's people. Permission, delete and remote-day requests join this table
-- with the Office only switch (M7).
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  kind text not null check (kind in ('team_reply')),
  client_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  reason_code text check (length(reason_code) <= 40),
  status text not null default 'pending' check (status in ('pending', 'done')),
  foreign key (firm_id, client_id) references public.clients (firm_id, id) on delete cascade,
  unique (kind, entity_type, entity_id)
);
create index requests_pending on public.requests (firm_id) where status = 'pending';
alter table public.requests enable row level security;
revoke all on public.requests from anon, authenticated;
grant select, update (status) on public.requests to authenticated;
create policy requests_select on public.requests for select to authenticated
  using (public.member_role(firm_id) is not null and (client_id is null or public.can_access_client(firm_id, client_id)));
create policy requests_update on public.requests for update to authenticated
  using (public.member_role(firm_id) is not null and (client_id is null or public.can_access_client(firm_id, client_id)))
  with check (public.member_role(firm_id) is not null);
create trigger requests_logged after update of status on public.requests
  for each row execute function public.log_change('request', 'id', 'request');

-- A poll may follow another within the same minute; the pending check alone keeps one at
-- a time, so each poll's key is unique.
create or replace function private.queue_mail_polls() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  select a.firm_id, 'mail_poll', 'account', a.id, 'mail_poll:' || a.id || ':' || gen_random_uuid()
  from public.connected_accounts a
  where a.kind = 'mail' and a.status = 'connected'
    and not exists (select 1 from public.jobs j where j.entity_type = 'account' and j.entity_id = a.id and j.state in ('pending', 'claimed', 'sending'))
$$;
