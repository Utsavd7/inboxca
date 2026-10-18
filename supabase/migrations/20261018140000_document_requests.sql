-- M4 step 8: asking a client for files (PLAN.md 5.3.1, 8.6). A request lists what is asked
-- for, for one period; the client uploads through a private link that works for 30 days.
-- Only the hash of the link's token is kept, so the link itself is shown once.
alter table public.requests drop constraint requests_kind_check;
alter table public.requests add constraint requests_kind_check check (kind in ('team_reply', 'documents'));
alter table public.requests add column expires_at timestamptz, add column details jsonb not null default '{}';
create unique index requests_link on public.requests ((details ->> 'link_hash')) where kind = 'documents';
