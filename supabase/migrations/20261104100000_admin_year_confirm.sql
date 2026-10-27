-- A kept file whose name differs from the version it matches in more than its number (an ITR
-- schema for another year, D42) is used only when Orelu's admin says they checked the year it
-- is for: the database refuses it otherwise, whatever the page sent. Else as before.
drop function if exists public.admin_add_template(text, text, text, date);
create or replace function public.admin_add_template(change_source text, change_at text, file text, starts date, year_checked boolean default false) returns boolean
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
    or kept -> 'renamed' = 'true' and year_checked is not true
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
revoke all on function public.admin_add_template(text, text, text, date, boolean) from public, anon;
grant execute on function public.admin_add_template(text, text, text, date, boolean) to authenticated;
