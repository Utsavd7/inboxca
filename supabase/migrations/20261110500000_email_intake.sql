-- Papers come by email (owner, 3 Nov 2026): the virus scanner and the client upload links are
-- gone. scanned_at said the scanner passed a file; a request for papers kept the link's hash
-- and its encrypted token. History stays: the requests, their items and their follow ups.
alter table public.documents drop column if exists scanned_at;
drop index if exists public.requests_link;
update public.requests set details = details - 'link_hash' - 'link_enc' where kind = 'documents' and (details ? 'link_hash' or details ? 'link_enc');
-- Files held for a scanner that was away open like any other; the alert about it is over.
update public.documents set details = details - 'held' where details ? 'held';
update public.requests set status = 'done' where kind = 'alert' and entity_type = 'scan' and status = 'pending';
delete from public.jobs where kind in ('rescan', 'upload_receipt') and state = 'pending';
