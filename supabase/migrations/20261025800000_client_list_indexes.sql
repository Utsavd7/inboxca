-- The Clients list at 10,000 clients (measured 25 Oct 2026). The Missing papers pill counts
-- clients with an open request for papers; without this each client read every pending request of the firm.
create index if not exists requests_documents_open on public.requests (firm_id, client_id) where kind = 'documents' and status = 'pending';
-- The Late pill and each row's next return read a client's returns still to file, earliest first.
create index if not exists tasks_open_by_client on public.tasks (firm_id, client_id, due_on) where kind = 'compliance' and status <> 'filed';
