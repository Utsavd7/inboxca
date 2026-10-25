-- Deleting a client or one of its numbers cascades into these tables; without an index on the
-- referencing columns each deleted row read the whole table (a 10,000 client firm took over 11
-- minutes to delete). The index on the foreign key makes each cascade a lookup.
create index if not exists email_events_client on public.email_events (firm_id, client_id);
create index if not exists requests_client on public.requests (firm_id, client_id);
create index if not exists documents_registration on public.documents (firm_id, registration_id) where registration_id is not null;
