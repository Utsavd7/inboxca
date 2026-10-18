-- M5 step 3: the records auto-reply (PLAN.md 5.5.2). A client's request for a paper is
-- answered from the firm's mailbox with a secure link. A routine paper goes at once; a
-- private paper waits as a send of status waiting for one person's approval, with no link
-- until then. A send remembers the email it answers.
alter table public.shares add column status text not null default 'sent' check (status in ('waiting', 'sent', 'refused'));
alter table public.shares add column email_event_id uuid references public.email_events (id) on delete set null;
alter table public.shares alter column link_token_hash drop not null, alter column link_expires_at drop not null;
alter table public.shares add constraint shares_link_when_sent check (status <> 'sent' or (link_token_hash is not null and link_expires_at is not null));
grant select (status, email_event_id) on public.shares to authenticated;
create index shares_waiting on public.shares (firm_id) where status = 'waiting';
