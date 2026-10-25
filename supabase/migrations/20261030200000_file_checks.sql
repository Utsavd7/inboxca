-- The file worker's checks (PLAN.md 5.15, 8.4). scanned_at: when the virus check passed the
-- file; null is not scanned yet (no scanner set up, or a file InboxCA did not receive itself).
-- password_enc: a PDF's password, typed by a person (never guessed) and kept encrypted with
-- the firm's key, so the team can open the file; only the server reads it.
alter table public.documents add column if not exists scanned_at timestamptz;
alter table public.documents add column if not exists password_enc text;
grant select (scanned_at) on public.documents to authenticated;
