-- M4 step 3: files filed into the firm's own drive (PLAN.md 5.5.0, D24, D36). InboxCA
-- keeps no file, only where it is in the drive, what it is and its checksum. The name is
-- the one it was saved under; the name it came with is kept encrypted with the firm's key.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id uuid not null,
  work_type text not null check (work_type in ('gst', 'income_tax', 'tax_audit', 'audit', 'roc', 'other')),
  document_type text not null check (length(document_type) between 1 and 80),
  -- "2026-09" is a month, "2027" the financial year ending March 2027, '' not known.
  period_key text not null default '' check (period_key ~ '^(\d{4}(-\d{2})?)?$'),
  status text not null default 'filed' check (status in ('filed', 'to_check')),
  email_event_id uuid references public.email_events (id) on delete set null,
  drive_file_id text not null,
  name text not null,
  original_name_enc text,
  size bigint not null,
  sha256 text not null,
  foreign key (firm_id, client_id) references public.clients (firm_id, id) on delete cascade,
  -- A retried filing job never files the same attachment of an email twice.
  unique (email_event_id, sha256)
);
create index documents_client on public.documents (firm_id, client_id);
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
grant select (id, firm_id, client_id, work_type, document_type, period_key, status, email_event_id, name, size) on public.documents to authenticated;
-- Written by the server only; documents follow the client's visibility.
create policy documents_select on public.documents for select to authenticated
  using (public.can_access_client(firm_id, client_id));
