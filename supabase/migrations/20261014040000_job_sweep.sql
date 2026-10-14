-- M0 step 6: Supabase Cron calls the app's job worker (/api/jobs) once a minute, and only
-- while jobs are due, so an idle app is never woken. The worker's address and secret are
-- kept in Supabase Vault ('job_worker_url', 'job_worker_secret'), never in a migration;
-- until both are stored (as in local development), nothing is called.
create extension if not exists pg_net;

create function private.call_job_worker() returns void
language plpgsql security definer set search_path = '' as $$
declare
  worker_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'job_worker_url');
  worker_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'job_worker_secret');
begin
  if worker_url is null or worker_secret is null then
    return;
  end if;
  -- The same test claim_jobs makes, on its small partial indexes.
  if not exists (select 1 from public.jobs where state = 'pending' and run_at <= now())
     and not exists (select 1 from public.jobs
                     where state in ('claimed', 'sending') and claimed_until < now()) then
    return;
  end if;
  perform net.http_post(
    url := worker_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || worker_secret),
    timeout_milliseconds := 55000);
end;
$$;
revoke all on function private.call_job_worker() from public, anon, authenticated, service_role;

select cron.schedule('job-sweep', '* * * * *', 'select private.call_job_worker()');
