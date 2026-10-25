-- M3: a firm mailbox connected with Google, Microsoft or Zoho sign in instead of a password
-- (PLAN.md 5.13, 8.7). Its refresh token, and the short access token made from it, are kept
-- in credentials_enc as an IMAP password is, encrypted with the firm's key; settings keeps
-- only the provider's ids for the mailbox. Every use and save of a token is logged.
alter table public.connected_accounts drop constraint connected_accounts_provider_check,
  add constraint connected_accounts_provider_check check (provider in ('imap', 'gmail', 'outlook', 'zoho', 'local', 'onedrive', 'dropbox'));
