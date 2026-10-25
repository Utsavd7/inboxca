-- M11 (PLAN.md 5.17 #43): the public status page and Orelu's incidents. Each part of InboxCA
-- is judged from the jobs table (work waiting past its time) and the server's own checks; an
-- incident is posted and closed by an Orelu admin and shown to everyone with its updates. Only
-- what an admin wrote for the public is kept: no firm, person or client.
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  parts text[] not null check (cardinality(parts) > 0 and parts <@ '{app,mail,files,reminders}'),
  level text not null check (level in ('slow', 'down')),
  -- Later notes: [{at, note}], oldest first.
  updates jsonb not null default '[]',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists incidents_started on public.incidents (started_at desc);
alter table public.incidents enable row level security;
revoke all on public.incidents from anon, authenticated;

-- For anyone, signed in or not: how long the oldest due work of each part has waited, and the
-- incidents open now or closed in the last 90 days.
create or replace function public.service_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'late', (select coalesce(jsonb_object_agg(part, late), '{}') from (
      select case
          when kind in ('mail_poll', 'file_mail', 'notice_from_mail') then 'mail'
          when kind in ('read_document', 'import_files', 'read_portal', 'read_sales', 'regenerate_form', 'upload_receipt') then 'files'
          when kind in ('reminders', 'bulk_send') then 'reminders'
        end as part,
        extract(epoch from now() - min(run_at))::int as late
      from public.jobs
      where state = 'pending' and run_at < now()
      group by 1
    ) waiting where part is not null),
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'parts', i.parts, 'level', i.level,
        'updates', i.updates, 'started_at', i.started_at, 'ended_at', i.ended_at) order by i.started_at desc), '[]')
      from public.incidents i where i.ended_at is null or i.ended_at > now() - interval '90 days'));
$$;

-- An admin posts an incident, adds a note to it or closes it; each is logged as Orelu's own.
create or replace function public.admin_post_incident(incident_title text, incident_parts text[], incident_level text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  posted uuid;
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  insert into public.incidents (title, parts, level) values (btrim(incident_title), incident_parts, incident_level) returning id into posted;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'admin.incident_posted', 'incident', posted, jsonb_build_object('parts', incident_parts, 'level', incident_level));
  return posted;
end;
$$;

create or replace function public.admin_update_incident(incident uuid, note text, finish boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  if length(btrim(coalesce(note, ''))) > 1000 then raise exception 'Keep the note under 1,000 characters' using errcode = '22001'; end if;
  update public.incidents set
    updates = case when btrim(coalesce(note, '')) = '' then updates else updates || jsonb_build_array(jsonb_build_object('at', now(), 'note', btrim(note))) end,
    ended_at = case when finish then now() end
  where id = incident and ended_at is null;
  if not found then return false; end if;
  insert into public.activity_log (actor_id, action, entity_type, entity_id)
  values ((select auth.uid()), case when finish then 'admin.incident_closed' else 'admin.incident_updated' end, 'incident', incident);
  return true;
end;
$$;

-- The outage email (#43): one job for each affected firm's owner, at most once an incident.
-- A mail reading or file worker incident affects the firms using that part; any other, every
-- working firm. The server sends only once Orelu's system mail is set up (src/lib/system-mail.ts).
create or replace function public.admin_email_incident(incident uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  touched text[];
  queued integer;
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  select parts into touched from public.incidents where id = incident and ended_at is null;
  if touched is null then return 0; end if;
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  select f.id, 'outage_email', 'incident', incident, 'outage_email:' || incident || ':' || f.id
  from public.firms f
  where f.status in ('active', 'grace', 'read_only')
    and (touched && '{app,reminders}' or exists (select 1 from public.connected_accounts a where a.firm_id = f.id and a.status = 'connected'
      and (a.kind = 'mail' and 'mail' = any (touched) or a.kind = 'drive' and 'files' = any (touched))))
  on conflict (idempotency_key) do nothing;
  get diagnostics queued = row_count;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'admin.incident_emailed', 'incident', incident, jsonb_build_object('firms', queued));
  return queued;
end;
$$;

-- How many firms an incident's email went to, for the admin view.
create or replace function public.admin_incidents() returns table (id uuid, title text, parts text[], level text, updates jsonb, started_at timestamptz, ended_at timestamptz, emailed int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select i.id, i.title, i.parts, i.level, i.updates, i.started_at, i.ended_at,
    (select count(*)::int from public.jobs j where j.kind = 'outage_email' and j.entity_type = 'incident' and j.entity_id = i.id)
  from public.incidents i
  where i.ended_at is null or i.ended_at > now() - interval '90 days'
  order by i.ended_at is null desc, i.started_at desc;
end;
$$;

revoke all on function public.admin_post_incident(text, text[], text), public.admin_update_incident(uuid, text, boolean),
  public.admin_email_incident(uuid), public.admin_incidents() from public, anon;
grant execute on function public.service_status() to anon, authenticated;
grant execute on function public.admin_post_incident(text, text[], text), public.admin_update_incident(uuid, text, boolean),
  public.admin_email_incident(uuid), public.admin_incidents() to authenticated;
