-- M3 step 1: the firm's mailbox (PLAN.md 5.13, 8.7). The owner connects the firm's own
-- email; InboxCA reads and sends through it. The address and the password (or, later, the
-- provider's token) are encrypted with the firm's key, bound to the account and field. The
-- browser never reads the credentials: members see only that a mailbox is connected and
-- its state; the server reads the rest with its own key. The drive joins this table (M4).

create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  kind text not null check (kind in ('mail')),
  provider text not null check (provider in ('imap')),
  address_enc text not null,
  credentials_enc text not null,
  -- Where reading resumes: the mailbox's UIDVALIDITY and the next UID, as "validity:uid".
  sync_cursor text,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  -- Mail: the IMAP and SMTP hosts and ports.
  settings jsonb not null default '{}',
  unique (firm_id, kind)
);
alter table public.connected_accounts enable row level security;
revoke all on public.connected_accounts from anon, authenticated;
grant select (id, firm_id, kind, provider, address_enc, status) on public.connected_accounts to authenticated;
grant insert (id, firm_id, kind, provider, address_enc, credentials_enc, sync_cursor, settings), delete on public.connected_accounts to authenticated;
create policy accounts_select on public.connected_accounts for select to authenticated
  using (public.member_role(firm_id) is not null);
create policy accounts_insert on public.connected_accounts for insert to authenticated
  with check (public.member_role(firm_id) = 'owner');
create policy accounts_delete on public.connected_accounts for delete to authenticated
  using (public.member_role(firm_id) = 'owner');
create trigger accounts_logged after insert or update of status or delete on public.connected_accounts
  for each row execute function public.log_change('account', 'id', 'account');
