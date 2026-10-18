-- M4 step 14: the first import of past files already in the firm's drive (PLAN.md 5.16). An
-- approved import is a request of kind import: the files to move and where, and, as they
-- move, where each one was, so the owner can undo it. Its job moves them a batch at a time.
alter table public.requests drop constraint requests_kind_check;
alter table public.requests add constraint requests_kind_check check (kind in ('team_reply', 'documents', 'alert', 'import'));
