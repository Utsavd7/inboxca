-- M4 (decided 24 Oct 2026): versions, and the GSTIN a paper is for. A paper that arrives for
-- the same client, type, period and GSTIN as a current one becomes current; the older one
-- is kept as an earlier version, its file left in the drive, never deleted.
alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check check (status in ('filed', 'to_check', 'deleted', 'missing', 'earlier'));

-- The GSTIN of a GST paper: the client's only one, or the one a person chose; else null.
alter table public.documents add column if not exists registration_id uuid;
alter table public.documents drop constraint if exists documents_registration_fkey;
alter table public.documents add constraint documents_registration_fkey
  foreign key (firm_id, registration_id) references public.client_registrations (firm_id, id) on delete set null (registration_id);
grant select (registration_id) on public.documents to authenticated;
