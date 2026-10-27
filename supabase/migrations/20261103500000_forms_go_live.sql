-- A new form version goes live by itself (D42) when every field InboxCA fills is unchanged. The
-- daily check calls this after saving what it saw: each file it recorded with the same layout
-- as the active version, in a newer version of that same file (marked live) and kept in the
-- store, becomes an active version for that one's periods with its mappings. Both stay usable
-- there, the newer by default. The admin sees it on the change; logged. Anything else, a changed
-- layout above all, waits for the admin as a draft.
create or replace function public.forms_go_live() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  kept jsonb;
  twin public.templates;
  added integer := 0;
begin
  for kept in
    select c from public.platform_settings s
      cross join jsonb_array_elements(s.value -> 'changes') ch
      cross join jsonb_array_elements(case when jsonb_typeof(ch -> 'compared') = 'array' then ch -> 'compared' else '[]' end) c
    where s.key = 'watch' and c -> 'same' = 'true' and c -> 'live' = 'true' and jsonb_typeof(c -> 'template') = 'object'
  loop
    select t.* into twin from public.templates t where t.form_code = kept #>> '{template,form_code}' and t.version = kept ->> 'with' and t.status = 'active';
    continue when twin.form_code is null or not exists (select 1 from public.official_files f where f.sha256 = kept #>> '{template,source,sha256}');
    insert into public.templates (form_code, version, valid_from, valid_until, status, source, mappings)
    values (twin.form_code, kept #>> '{template,version}', twin.valid_from, twin.valid_until, 'active', kept #> '{template,source}', twin.mappings)
    on conflict do nothing;
    continue when not found;
    insert into public.activity_log (action, entity_type, details)
    values ('form.went_live', 'rule', jsonb_build_object('form', twin.form_code, 'version', kept #>> '{template,version}', 'with', twin.version, 'sha256', kept #>> '{template,source,sha256}'));
    added := added + 1;
  end loop;
  return added;
end;
$$;
revoke all on function public.forms_go_live() from public, anon, authenticated;
grant execute on function public.forms_go_live() to service_role;
