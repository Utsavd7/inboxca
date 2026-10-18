-- M4 step 11: finding a file by the words in it (PLAN.md 5.5.0, D29). A job reads each file
-- once after it is filed and keeps only short keyed hashes of its words, with the words of
-- its name and type; the text itself is never stored, and the hashes mean nothing without
-- the firm's key. Search hashes the words typed the same way.
alter table public.documents add column search_tokens text[] not null default '{}';
create index documents_search on public.documents using gin (search_tokens);
grant select (search_tokens) on public.documents to authenticated;
