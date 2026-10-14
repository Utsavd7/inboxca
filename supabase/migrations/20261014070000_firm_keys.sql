-- M0 step 10: each firm's key set (PLAN.md 8.4), only ever stored wrapped by the outer key
-- (AWS KMS in production). The server alone reads it. Deleting a firm deletes its key, so
-- anything still encrypted with it, in backups too, can never be opened again.
-- KMS keeps its own key versions inside the wrapped value, and when a key was rotated is
-- in activity_log, so this table needs no more columns.
create table public.firm_keys (
  firm_id uuid primary key references public.firms (id) on delete cascade,
  wrapped_key text not null
);
alter table public.firm_keys enable row level security;
revoke all on public.firm_keys from anon, authenticated;
