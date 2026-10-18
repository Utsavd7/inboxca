-- M5 step 6: a one-time code for private papers (PLAN.md 8.6). A link to a private paper opens
-- only with a 6-digit code emailed to the address it was sent to: kept as a hash, good for
-- 10 minutes and 5 tries.
alter table public.shares add column needs_code boolean not null default false;
alter table public.shares add column code_hash text, add column code_expires_at timestamptz, add column code_attempts int not null default 0 check (code_attempts between 0 and 5);
