-- M11 security pass (PLAN.md 8.5, 8.9).

-- Limits for the sign in steps anyone can reach: a count per key in a fixed window. The key
-- is a keyed digest the server makes (src/lib/rate-limit.ts), never an address or a person's
-- id, and a row lasts a day at most. Server only.
create table if not exists private.rate_limits (
  key text primary key check (length(key) <= 64),
  since timestamptz not null default now(),
  hits int not null default 1
);
alter table private.rate_limits enable row level security;
revoke all on private.rate_limits from public, anon, authenticated;

-- Counts one try and says whether it is within `most` tries in `seconds` (a day at most).
create or replace function public.rate_limit(bucket text, most int, seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  counted int;
begin
  delete from private.rate_limits where since < now() - interval '1 day';
  insert into private.rate_limits as r (key) values (bucket)
  on conflict (key) do update set
    since = case when r.since < now() - make_interval(secs => least(seconds, 86400)) then now() else r.since end,
    hits = case when r.since < now() - make_interval(secs => least(seconds, 86400)) then 1 else r.hits + 1 end
  returning hits into counted;
  return counted <= most;
end;
$$;
revoke all on function public.rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit(text, int, int) to service_role;

-- Phone notification addresses are read and written by the server only; nobody signed in or
-- not reaches them, even with row level security on.
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on sequence public.jobs_id_seq from anon, authenticated;
-- A device's token hash is the server's to match: people see their firm's devices, not it.
revoke select on public.devices from authenticated;
grant select (id, firm_id, name, kind, status, person_id, ends_on, key_id, key_public) on public.devices to authenticated;

-- The access checks that policies call need a signed in person: a visitor who is not signed
-- in calls none of them.
revoke all on function public.member_role(uuid), public.can_access_client(uuid, uuid), public.office_allows(jsonb, text) from public, anon;
grant execute on function public.member_role(uuid), public.can_access_client(uuid, uuid), public.office_allows(jsonb, text) to authenticated, service_role;

-- A sender's address is kept in the log only as a keyed digest (the enquiry form's limit),
-- never as the address itself: an IPv4 or IPv6 address has dots or colons, a digest neither.
alter table public.activity_log drop constraint if exists activity_log_ip_hashed;
alter table public.activity_log add constraint activity_log_ip_hashed check (details ->> 'ip' is null or details ->> 'ip' !~ '[.:]');

-- A key from one firm row to another names the firm too, so no row can point at another
-- firm's (PLAN.md 11: tenant consistent foreign keys). These four were the last without it.
alter table public.email_events drop constraint if exists email_events_account_id_fkey, drop constraint if exists email_events_account_fkey;
alter table public.documents drop constraint if exists documents_email_event_id_fkey, drop constraint if exists documents_email_event_fkey;
alter table public.shares drop constraint if exists shares_email_event_id_fkey, drop constraint if exists shares_email_event_fkey,
  drop constraint if exists shares_document_id_fkey, drop constraint if exists shares_document_fkey;
alter table public.connected_accounts drop constraint if exists connected_accounts_firm_id_id_key, add constraint connected_accounts_firm_id_id_key unique (firm_id, id);
alter table public.email_events drop constraint if exists email_events_firm_id_id_key, add constraint email_events_firm_id_id_key unique (firm_id, id);
alter table public.documents drop constraint if exists documents_firm_id_id_key, add constraint documents_firm_id_id_key unique (firm_id, id);
alter table public.email_events add constraint email_events_account_fkey
  foreign key (firm_id, account_id) references public.connected_accounts (firm_id, id) on delete cascade;
alter table public.documents add constraint documents_email_event_fkey
  foreign key (firm_id, email_event_id) references public.email_events (firm_id, id) on delete set null (email_event_id);
alter table public.shares add constraint shares_email_event_fkey
  foreign key (firm_id, email_event_id) references public.email_events (firm_id, id) on delete set null (email_event_id),
  add constraint shares_document_fkey
  foreign key (firm_id, document_id) references public.documents (firm_id, id) on delete cascade;
