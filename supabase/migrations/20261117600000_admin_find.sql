-- The admin console finds a firm by a word of its name, its id (or the id's first 8 letters)
-- or the exact sign in email of anyone in it; the email only finds, it is never shown. Failed
-- jobs carry their firm's id, so the console groups them by firm and links to it.
drop function if exists public.admin_firms();
create or replace function public.admin_firms(find text default null)
returns table (id uuid, name text, status text, created_at timestamptz, members int, mailbox boolean, drive boolean, last_active timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := lower(btrim(coalesce(find, '')));
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select f.id, f.name, f.status, f.created_at,
    (select count(*)::int from public.firm_members m where m.firm_id = f.id and m.status = 'active'),
    exists (select 1 from public.connected_accounts a where a.firm_id = f.id and a.kind = 'mail' and a.status = 'connected'),
    exists (select 1 from public.connected_accounts a where a.firm_id = f.id and a.kind = 'drive' and a.status = 'connected'),
    (select max(l.at) from public.activity_log l where l.firm_id = f.id)
  from public.firms f
  where q = '' or strpos(lower(f.name), q) > 0
    or (length(q) >= 8 and starts_with(f.id::text, q))
    or exists (select 1 from public.firm_members m join auth.users u on u.id = m.user_id where m.firm_id = f.id and lower(u.email) = q)
  order by f.created_at desc;
end;
$$;

drop function if exists public.admin_failed_jobs();
create or replace function public.admin_failed_jobs()
returns table (id bigint, kind text, firm text, error text, attempts int, at timestamptz, firm_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select j.id, j.kind, f.name, j.last_error_code, j.attempts, j.run_at, j.firm_id
  from public.jobs j left join public.firms f on f.id = j.firm_id
  where j.state = 'failed'
  order by j.run_at desc
  limit 200;
end;
$$;

revoke all on function public.admin_firms(text), public.admin_failed_jobs() from public, anon;
grant execute on function public.admin_firms(text), public.admin_failed_jobs() to authenticated;
