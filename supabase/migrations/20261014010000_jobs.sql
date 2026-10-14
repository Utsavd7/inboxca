-- M0 step 3: the one jobs table that runs every piece of background work (PLAN.md D2, 4.3).
-- Workers claim due jobs with FOR UPDATE SKIP LOCKED and a lease, so no separate queue
-- service is needed. Only the server reaches this table; nobody signed in can read it.
-- Columns that only one kind of job needs (a sent message's provider id, a reminder's skip
-- reason) are added by the step that brings that kind of job.

create table public.jobs (
  id bigint generated always as identity primary key,
  firm_id uuid references public.firms (id) on delete cascade, -- null for platform work
  kind text not null check (length(kind) between 1 and 40),
  entity_type text,
  entity_id uuid,
  schedule_version int not null default 0,
  idempotency_key text not null unique,
  run_at timestamptz not null default now(),
  state text not null default 'pending'
    check (state in ('pending', 'claimed', 'sending', 'done', 'failed', 'uncertain', 'cancelled')),
  claimed_until timestamptz,
  attempts int not null default 0,
  last_error_code text
);
-- The sweep reads only these small partial indexes, however many finished jobs pile up.
create index jobs_due on public.jobs (run_at) where state = 'pending';
create index jobs_leased on public.jobs (claimed_until) where state in ('claimed', 'sending');
create index jobs_entity on public.jobs (entity_type, entity_id) where state = 'pending';

alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated;

-- Claims up to `batch` due jobs for one worker, oldest first. Two workers never get the
-- same job. A lease that ran out puts a job back in the queue if it had not yet started
-- its outside call, and marks it uncertain if it had: an uncertain send is checked
-- against the mailbox before anything is tried again, so nothing is sent twice.
create function public.claim_jobs(batch int default 20, lease_seconds int default 120)
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  update public.jobs
  set state = case when state = 'sending' then 'uncertain' else 'pending' end,
      claimed_until = null
  where state in ('claimed', 'sending') and claimed_until < now();

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

-- Called right before a job reaches outside (an email, a drive, an AI call).
create function public.mark_job_sending(job_id bigint) returns boolean
language sql security definer set search_path = '' as $$
  update public.jobs set state = 'sending'
  where id = job_id and state = 'claimed'
  returning true
$$;

-- Ends a claimed job: done, back to pending at retry_at, or failed. Returns false if the
-- job was not this worker's to finish (its lease ran out, or it was cancelled).
create function public.finish_job(
  job_id bigint,
  outcome text,
  error_code text default null,
  retry_at timestamptz default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if outcome not in ('done', 'retry', 'failed') then
    raise exception 'unknown outcome %', outcome using errcode = '22023';
  end if;
  update public.jobs
  set state = case outcome when 'retry' then 'pending' else outcome end,
      run_at = case when outcome = 'retry' then coalesce(retry_at, now()) else run_at end,
      claimed_until = null,
      last_error_code = case when outcome = 'done' then null else error_code end
  where id = job_id and state in ('claimed', 'sending');
  return found;
end;
$$;

-- Cancels the waiting jobs of an entity that were planned under an older schedule, for
-- example the reminders of a task that has just been filed or moved.
create function public.cancel_jobs(
  p_entity_type text,
  p_entity_id uuid,
  below_version int default 2147483647
) returns int
language sql security definer set search_path = '' as $$
  with cancelled as (
    update public.jobs set state = 'cancelled'
    where entity_type = p_entity_type and entity_id = p_entity_id
      and state = 'pending' and schedule_version < below_version
    returning 1
  )
  select count(*)::int from cancelled
$$;

revoke all on function public.claim_jobs(int, int) from public, anon, authenticated;
revoke all on function public.mark_job_sending(bigint) from public, anon, authenticated;
revoke all on function public.finish_job(bigint, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_jobs(text, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_jobs(int, int) to service_role;
grant execute on function public.mark_job_sending(bigint) to service_role;
grant execute on function public.finish_job(bigint, text, text, timestamptz) to service_role;
grant execute on function public.cancel_jobs(text, uuid, int) to service_role;
