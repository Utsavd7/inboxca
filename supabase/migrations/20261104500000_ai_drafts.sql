-- AI drafts for emails waiting in Needs reply (PLAN.md "Inbox, answered" G, 5.11): AI writes a
-- reply from the client's records for a person to check and send; AI itself sends nothing.
-- The draft is sealed with the firm's key on the email's request and goes when the email stops
-- waiting (answered or marked done) or once the email is 7 days old (D6). Off until an AI key
-- is set: each job then ends at once (src/jobs/ai-draft.ts).
alter table public.requests add column if not exists draft_enc text;

-- One try for each waiting email of a known client: when it starts waiting, or when a person
-- says which client a contact wrote for.
create or replace function private.queue_ai_draft() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  values (new.firm_id, 'ai_draft', 'request', new.id, 'ai_draft:' || new.id || ':' || new.client_id)
  on conflict (idempotency_key) do nothing;
  return null;
end;
$$;
revoke all on function private.queue_ai_draft() from public, anon, authenticated, service_role;
drop trigger if exists requests_ai_draft on public.requests;
create trigger requests_ai_draft after insert or update of client_id on public.requests
  for each row when (new.kind = 'team_reply' and new.entity_type = 'email' and new.status = 'pending' and new.client_id is not null)
  execute function private.queue_ai_draft();

-- The draft goes with the wait, whoever ends it.
create or replace function private.drop_ai_draft() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.draft_enc := null;
  return new;
end;
$$;
revoke all on function private.drop_ai_draft() from public, anon, authenticated, service_role;
drop trigger if exists requests_drop_ai_draft on public.requests;
create trigger requests_drop_ai_draft before update on public.requests
  for each row when (new.status <> 'pending' and new.draft_enc is not null)
  execute function private.drop_ai_draft();

-- And at the latest once the email is 7 days old; drafts are written only for younger ones.
create or replace function private.purge_ai_drafts() returns void
language sql security definer set search_path = '' as $$
  update public.requests r set draft_enc = null
  from public.email_events e
  where r.draft_enc is not null and r.entity_type = 'email' and e.id = r.entity_id and e.received_at < now() - interval '7 days';
$$;
revoke all on function private.purge_ai_drafts() from public, anon, authenticated, service_role;
select cron.schedule('ai-draft-purge', '45 * * * *', 'select private.purge_ai_drafts()');
