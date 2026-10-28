-- Money and sending safety (29 Oct 2026 review). Every object here is new or was last defined
-- before this file, so the migrations give the same result in any order they are applied in.

-- As in 20261014010000_jobs.sql, with a lease that ran out handled so nothing repeats or loops:
-- a job that had reached outside fails as 'uncertain', for an admin to check and try again from
-- Admin, Failed jobs; one that had not goes back in the queue, unless the worker keeps stopping
-- on it ('lease_expired': on its 5th try, or twice running after many patient tries). Either
-- queues one jobs_stopped alert a day for Orelu's admins.
create or replace function public.claim_jobs(batch int default 20, lease_seconds int default 120)
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  with stopped as (
    update public.jobs
    set state = 'failed', claimed_until = null,
        last_error_code = case when state = 'sending' then 'uncertain' else 'lease_expired' end
    where state in ('claimed', 'sending') and claimed_until < now()
      and (state = 'sending' or attempts >= 5 and last_error_code = 'lease_expired')
    returning 1
  )
  insert into public.jobs (kind, entity_type, idempotency_key)
  select 'jobs_stopped', 'platform', 'jobs_stopped:' || (now() at time zone 'Asia/Kolkata')::date
  where exists (select 1 from stopped)
  on conflict (idempotency_key) do nothing;

  update public.jobs set state = 'pending', claimed_until = null, last_error_code = 'lease_expired'
  where state = 'claimed' and claimed_until < now();

  return query
  with due as (
    select id from public.jobs
    where state = 'pending' and run_at <= now()
    order by run_at
    limit batch
    for update skip locked
  )
  update public.jobs j
  set state = 'claimed',
      claimed_until = now() + make_interval(secs => lease_seconds),
      attempts = j.attempts + 1
  from due
  where j.id = due.id
  returning j.*;
end;
$$;
update public.jobs set state = 'failed', last_error_code = 'uncertain' where state = 'uncertain';

-- A retry at a set time (the end of quiet hours, the mailbox's sending limit, the next batch) is
-- not a failure: the job waits until then and gets back the try its claim counted.
create or replace function public.wait_job(job_id bigint, error_code text, retry_at timestamptz) returns boolean
language sql security definer set search_path = '' as $$
  update public.jobs
  set state = 'pending', run_at = retry_at, claimed_until = null, last_error_code = error_code, attempts = greatest(attempts - 1, 0)
  where id = job_id and state in ('claimed', 'sending')
  returning true
$$;
revoke all on function public.wait_job(bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.wait_job(bigint, text, timestamptz) to service_role;

-- As in 20261020120000_mailbox_health.sql, and a message's own id is kept with its slot, before
-- SMTP is reached, for the same 24 hours (mail_ids). A send that may have happened is then
-- known to have been tried even where the provider keeps no copy in the Sent folder; a send that
-- failed lets its id go (forget_mail_send).
drop function if exists public.reserve_mail_send(uuid);
create function public.reserve_mail_send(account_id uuid, message_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare account public.connected_accounts; sends jsonb; first_send timestamptz; last_send timestamptz; slot timestamptz; cap int; ids jsonb;
begin
  select * into account from public.connected_accounts where id=account_id and kind='mail' for update;
  if not found or account.status<>'connected' then return jsonb_build_object('ready',false,'at',now()+interval '1 hour'); end if;
  select case when settings->>'mail_limit' ~ '^[0-9]{1,4}$' then greatest(1,least(2000,(settings->>'mail_limit')::int)) else 500 end into cap from public.firms where id=account.firm_id;
  select coalesce(jsonb_agg(at order by at),'[]'),min(at),max(at) into sends,first_send,last_send
    from (select value::timestamptz at from jsonb_array_elements_text(coalesce(account.settings->'mail_sends','[]')) where value::timestamptz>now()-interval '24 hours') times;
  if jsonb_array_length(sends)>=cap then return jsonb_build_object('ready',false,'at',first_send+interval '24 hours 5 seconds'); end if;
  slot := greatest(now(),coalesce(last_send+interval '1 second',now()));
  if slot>now()+interval '5 seconds' then return jsonb_build_object('ready',false,'at',slot); end if;
  update public.connected_accounts set settings=jsonb_set(settings,'{mail_sends}',sends || jsonb_build_array(slot)) where id=account_id;
  if message_id is not null then
    select coalesce(jsonb_object_agg(key,value),'{}') into ids from jsonb_each_text(coalesce(account.settings->'mail_ids','{}')) where value::timestamptz>now()-interval '24 hours';
    update public.connected_accounts set settings=jsonb_set(settings,'{mail_ids}',ids || jsonb_build_object(message_id,slot)) where id=account_id;
  end if;
  return jsonb_build_object('ready',true,'at',slot);
end;
$$;
revoke all on function public.reserve_mail_send(uuid, text) from public,anon,authenticated;
grant execute on function public.reserve_mail_send(uuid, text) to service_role;

create or replace function public.forget_mail_send(account_id uuid, message_id text) returns void
language sql security definer set search_path = '' as $$
  update public.connected_accounts set settings = settings #- array['mail_ids', message_id] where id = account_id
$$;
revoke all on function public.forget_mail_send(uuid, text) from public, anon, authenticated;
grant execute on function public.forget_mail_send(uuid, text) to service_role;

-- A payment captured and what it buys, in one transaction (src/lib/billing/billing.ts, paid): the
-- payment is marked done and its grants are written with it, so a failure part way leaves both
-- as they were for the provider's retry, and no payment is done without what it bought. The app
-- works the grants out from plan_formula as before: the payment's details, the subscription's
-- paid_until, plan or cycle (moved only from the paid_until given as `from`), and the states the
-- firm becomes active from. Null when the payment was not open (done already, or cancelled).
create or replace function public.pay(payment_id uuid, grants jsonb, ref text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
  moved boolean := true;
  started text;
begin
  update public.payments set status = 'done', provider_ref = ref, details = coalesce(grants -> 'details', details)
  where id = payment_id and kind <> 'refund' and status in ('created', 'failed')
  returning firm_id into target;
  if target is null then return null; end if;
  if grants ? 'subscription' then
    update public.subscriptions s
    set paid_until = coalesce((grants #>> '{subscription,paid_until}')::date, s.paid_until),
        plan = coalesce(grants #> '{subscription,plan}', s.plan),
        cycle = coalesce(grants #>> '{subscription,cycle}', s.cycle)
    where s.firm_id = target and (grants #>> '{subscription,from}' is null or s.paid_until = (grants #>> '{subscription,from}')::date);
    moved := found;
  end if;
  if moved and grants ? 'activate' then
    update public.firms set status = 'active'
    where id = target and status in (select jsonb_array_elements_text(grants -> 'activate'))
    returning name into started;
  end if;
  return jsonb_build_object('moved', moved, 'started', started);
end;
$$;
revoke all on function public.pay(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.pay(uuid, jsonb, text) to service_role;
