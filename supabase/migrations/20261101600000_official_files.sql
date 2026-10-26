-- A store for official files (D42): a new GSTR-1 workbook or ITR schema that the daily check
-- downloads with the same layout as the version InboxCA fills is kept here, so Orelu's admin
-- can use it from a period in one click, without an app release. Kept by its SHA-256 and
-- written once; only the server reads it (the daily check, and the file worker through a link
-- the app signs). Local Supabase has no Storage set up, so a table holds the bytes.
create table if not exists public.official_files (
  sha256 text primary key,
  bytes bytea not null,
  check (sha256 = encode(sha256(bytes), 'hex'))
);
alter table public.official_files enable row level security;
revoke all on public.official_files from public, anon, authenticated;
revoke update, delete, truncate on public.official_files from service_role;

-- Orelu's admin uses a same layout file from a period (its first day): a new active version
-- with the file's hash and official link, and the mappings and end of the version it matches.
-- That version keeps its own periods; from the first period both work, the newer by default.
-- Only what the check recorded is used, only a file with the same layout that is in the
-- store, and only within the periods of the version it matches. Logged.
create or replace function public.admin_add_template(change_source text, change_at text, file text, starts date) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  kept jsonb;
  twin public.templates;
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  select c into kept from public.platform_settings s
    cross join jsonb_array_elements(s.value -> 'changes') ch
    cross join jsonb_array_elements(case when jsonb_typeof(ch -> 'compared') = 'array' then ch -> 'compared' else '[]' end) c
  where s.key = 'watch' and ch ->> 'source' = change_source and ch ->> 'at' = change_at and c ->> 'file' = file
    and c -> 'same' = 'true' and jsonb_typeof(c -> 'template') = 'object'
  limit 1;
  select t.* into twin from public.templates t where t.form_code = kept #>> '{template,form_code}' and t.version = kept ->> 'with' and t.status <> 'draft';
  if twin.form_code is null or starts < twin.valid_from or starts >= coalesce(twin.valid_until, 'infinity') or starts <> date_trunc('month', starts)
    or twin.form_code ~ '^ITR' and extract(month from starts) <> 4
    or not exists (select 1 from public.official_files f where f.sha256 = kept #>> '{template,source,sha256}') then return false; end if;
  insert into public.templates (form_code, version, valid_from, valid_until, status, source, mappings)
  values (twin.form_code, kept #>> '{template,version}', starts, twin.valid_until, 'active', kept #> '{template,source}', twin.mappings)
  on conflict do nothing;
  if not found then return false; end if;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.template_added', 'rule', jsonb_build_object('form', twin.form_code, 'version', kept #>> '{template,version}', 'from', starts, 'sha256', kept #>> '{template,source,sha256}'));
  return true;
end;
$$;
revoke all on function public.admin_add_template(text, text, text, date) from public, anon;
grant execute on function public.admin_add_template(text, text, text, date) to authenticated;
