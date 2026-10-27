-- Read once, reuse (PLAN.md 5.4, D29). fingerprint: a hash of a file's text, keyed with the
-- firm's own key, so the same paper saved again with other bytes is known and a new version
-- with the same content is not read for figures again. details.text: where the text read from
-- the file is kept, sealed with the firm's key, in Orelu's workspace store. Neither is shown to
-- people, so neither is granted to signed in users.
alter table public.documents add column if not exists fingerprint text;
alter table public.documents add column if not exists details jsonb;
