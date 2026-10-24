-- M11: Orelu's admin console (PLAN.md 3, roles: orelu_admin). An admin is a login listed
-- here, added by the Orelu team in the database; it signs in like anyone else, with the
-- 2 step code, and belongs to no firm. The console reads only through the functions below,
-- which return firm health and never client names, emails, documents or figures: the firm
-- is the fiduciary of its clients' data.
create table if not exists public.orelu_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.orelu_admins enable row level security;
revoke all on public.orelu_admins from anon, authenticated;

create or replace function public.is_orelu_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    and exists (select 1 from public.orelu_admins where user_id = (select auth.uid()))
$$;

-- Every firm: its status, people, whether its mailbox and drive are connected, and when
-- anyone last did anything in it.
create or replace function public.admin_firms()
returns table (id uuid, name text, status text, created_at timestamptz, members int, mailbox boolean, drive boolean, last_active timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select f.id, f.name, f.status, f.created_at,
    (select count(*)::int from public.firm_members m where m.firm_id = f.id and m.status = 'active'),
    exists (select 1 from public.connected_accounts a where a.firm_id = f.id and a.kind = 'mail' and a.status = 'connected'),
    exists (select 1 from public.connected_accounts a where a.firm_id = f.id and a.kind = 'drive' and a.status = 'connected'),
    (select max(l.at) from public.activity_log l where l.firm_id = f.id)
  from public.firms f
  order by f.created_at desc;
end;
$$;

-- Every connected mailbox and drive, never its address: its last finished job (the last
-- poll, for a mailbox), its sign in failures in a row, and the error of its latest job.
create or replace function public.admin_accounts()
returns table (firm text, kind text, provider text, status text, last_run timestamptz, failures int, last_error text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select f.name, a.kind, a.provider, a.status, j.last_run,
    coalesce((a.settings #>> '{mail_failures,read}')::int, 0) + coalesce((a.settings #>> '{mail_failures,send}')::int, 0),
    j.last_error
  from public.connected_accounts a
  join public.firms f on f.id = a.firm_id
  left join (
    select j.entity_id, max(j.run_at) filter (where j.state = 'done') last_run,
      (array_agg(j.last_error_code order by j.run_at desc))[1] last_error
    from public.jobs j where j.entity_type = 'account' group by j.entity_id
  ) j on j.entity_id = a.id
  order by a.status desc, f.name, a.kind;
end;
$$;

-- Failed jobs, newest first: ids, kinds and error codes only, as the jobs table keeps.
create index if not exists jobs_failed on public.jobs (run_at) where state = 'failed';
create or replace function public.admin_failed_jobs()
returns table (id bigint, kind text, firm text, error text, attempts int, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select j.id, j.kind, f.name, j.last_error_code, j.attempts, j.run_at
  from public.jobs j left join public.firms f on f.id = j.firm_id
  where j.state = 'failed'
  order by j.run_at desc
  limit 200;
end;
$$;

-- Puts a failed job back in the queue with its tries counted afresh.
create or replace function public.admin_retry_job(job_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  update public.jobs set state = 'pending', run_at = now(), attempts = 0, claimed_until = null
  where id = job_id and state = 'failed';
  return found;
end;
$$;

-- The daily forms check (D42): what it saw of each official source, its changes and alerts.
create or replace function public.admin_watch() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return coalesce((select value from public.platform_settings where key = 'watch'), '{}');
end;
$$;

-- Marks one change of the forms check reviewed, with who did it and when.
create or replace function public.admin_review_change(change_source text, change_at text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  update public.platform_settings s set value = jsonb_set(s.value, '{changes}', (
    select jsonb_agg(case when c ->> 'source' = change_source and c ->> 'at' = change_at
      then c || jsonb_build_object('status', 'reviewed', 'reviewed_by', (select auth.uid()), 'reviewed_at', now()) else c end order by n)
    from jsonb_array_elements(s.value -> 'changes') with ordinality e (c, n)))
  where s.key = 'watch' and exists (select 1 from jsonb_array_elements(s.value -> 'changes') c
    where c ->> 'source' = change_source and c ->> 'at' = change_at and c ->> 'status' = 'draft');
  return found;
end;
$$;

revoke all on function public.is_orelu_admin(), public.admin_firms(), public.admin_accounts(), public.admin_failed_jobs(),
  public.admin_retry_job(bigint), public.admin_watch(), public.admin_review_change(text, text) from public, anon;
grant execute on function public.is_orelu_admin(), public.admin_firms(), public.admin_accounts(), public.admin_failed_jobs(),
  public.admin_retry_job(bigint), public.admin_watch(), public.admin_review_change(text, text) to authenticated;
