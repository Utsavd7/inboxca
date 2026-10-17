-- M3 step 2: reading new mail (PLAN.md 4.5, 5.5, D6). Every 2 minutes each connected
-- mailbox gets a mail_poll job; the worker reads only messages newer than its cursor and
-- keeps a row only for mail from a client or a contact: the sender's blind index, the
-- matched contact or client when there is exactly one, the time and the provider's ids.
-- Never the subject, the body, the sender's address or the attachments.

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  account_id uuid not null references public.connected_accounts (id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  sender_bidx text not null,
  contact_id uuid,
  client_id uuid,
  received_at timestamptz not null,
  status text not null default 'new' check (status in ('new')),
  foreign key (firm_id, contact_id) references public.contacts (firm_id, id) on delete cascade,
  foreign key (firm_id, client_id) references public.clients (firm_id, id) on delete cascade,
  unique (account_id, provider_message_id)
);
create index email_events_received on public.email_events (firm_id, received_at desc);
alter table public.email_events enable row level security;
revoke all on public.email_events from anon, authenticated;
grant select on public.email_events to authenticated;
-- Written by the server only. A message from someone who writes for several clients waits
-- for triage to choose the client; until then every member sees it.
create policy email_events_select on public.email_events for select to authenticated
  using (public.member_role(firm_id) is not null and (client_id is null or public.can_access_client(firm_id, client_id)));

-- One poll at a time for each connected mailbox.
create function private.queue_mail_polls() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  select a.firm_id, 'mail_poll', 'account', a.id, 'mail_poll:' || a.id || ':' || floor(extract(epoch from now()) / 60)::bigint
  from public.connected_accounts a
  where a.kind = 'mail' and a.status = 'connected'
    and not exists (select 1 from public.jobs j where j.entity_type = 'account' and j.entity_id = a.id and j.state in ('pending', 'claimed', 'sending'))
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_mail_polls() from public, anon, authenticated, service_role;
select cron.schedule('mail-polls', '*/2 * * * *', 'select private.queue_mail_polls()');

-- Finished jobs stay a week for checking, failed ones a month; then they are removed.
select cron.schedule('job-cleanup', '15 20 * * *', $$delete from public.jobs
  where (state in ('done', 'cancelled') and run_at < now() - interval '7 days') or (state = 'failed' and run_at < now() - interval '30 days')$$);
