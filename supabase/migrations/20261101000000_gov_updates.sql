-- New from the government (D42, the user on 26 Oct 2026): the daily check runs at 08:30 India
-- time and reads the official listing pages too; a firm sees what is new for its work areas on
-- Today, each person dismisses an item for themselves on every device, and Orelu's admin adds
-- one line about an item, or ends a template version only with the official link that
-- discontinues it. The items wait in platform_settings 'watch' with the rest of the check.

-- 08:30 India time is 03:00 UTC. As in 20261024170000_forms_watch.sql otherwise.
select cron.schedule('forms-watch', '0 3 * * *', 'select private.queue_forms_watch()');

-- The government items this person has dismissed, newest last; items last 14 days, so the
-- last 50 are plenty.
alter table public.firm_members add column if not exists dismissed text[] not null default '{}';

-- A firm's work areas from its current clients' services: GST, income tax, TDS, company law.
-- Only the areas leave this function, never a client.
create or replace function private.work_areas(target_firm uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct case when s in ('DIR3KYC', 'LLP8', 'LLP11') or r.kind in ('cin', 'llpin') then 'company_law'
      when r.kind = 'gstin' then 'gst' when r.kind = 'tan' then 'tds' else 'income_tax' end), '{}')
  from public.client_registrations r
  join public.clients c on c.firm_id = r.firm_id and c.id = r.client_id and c.archived_at is null
  cross join unnest(r.services) s
  where r.firm_id = target_firm
$$;
revoke all on function private.work_areas(uuid) from public, anon, authenticated;

-- What is new from the government in the last 14 days for an active member's firm, newest
-- first, each marked dismissed or not for this person, with the firm's work areas.
create or replace function public.gov_updates(target_firm uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  mine text[];
  areas text[];
begin
  select m.dismissed into mine from public.firm_members m where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active';
  if mine is null then raise exception 'Members only' using errcode = '42501'; end if;
  areas := private.work_areas(target_firm);
  return jsonb_build_object('areas', to_jsonb(areas), 'items', coalesce((
    select jsonb_agg(i || jsonb_build_object('dismissed', i ->> 'id' = any(mine)) order by i ->> 'seen' desc, n desc)
    from public.platform_settings p cross join jsonb_array_elements(p.value -> 'items') with ordinality e (i, n)
    where p.key = 'watch' and i ->> 'area' = any(areas)
      and i ->> 'seen' > ((now() at time zone 'Asia/Kolkata')::date - 14)::text), '[]'));
end;
$$;

-- One person dismisses one item for themselves. Not logged: like marking the notifications
-- read, it changes only what this person sees.
create or replace function public.dismiss_gov_update(target_firm uuid, item text) returns boolean
language sql security definer set search_path = '' as $$
  with done as (
    update public.firm_members m set dismissed = (array_remove(m.dismissed, item) || item)[greatest(1, cardinality(array_remove(m.dismissed, item)) - 48):]
    where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active' and item ~ '^[0-9a-f]{16}$'
    returning 1
  )
  select exists (select 1 from done)
$$;

-- Orelu's admin adds the one line firms see under an item: InboxCA uses it from a date, or
-- keeps the earlier version for some periods. Logged like a reviewed change.
create or replace function public.admin_note_update(item text, uses date default null, keeps text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  if (uses is null) = (keeps is null) or length(trim(keeps)) not between 3 and 80 then raise exception 'A date or the periods' using errcode = '22023'; end if;
  update public.platform_settings s set value = jsonb_set(s.value, '{items}', (
    select jsonb_agg(case when i ->> 'id' = item then i || jsonb_build_object('note', jsonb_strip_nulls(jsonb_build_object('uses', uses, 'keeps', trim(keeps)))) else i end order by n)
    from jsonb_array_elements(s.value -> 'items') with ordinality e (i, n)))
  where s.key = 'watch' and exists (select 1 from jsonb_array_elements(s.value -> 'items') i where i ->> 'id' = item);
  if not found then return false; end if;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.update_noted', 'rule', jsonb_build_object('item', item, 'uses', uses, 'keeps', trim(keeps)));
  return true;
end;
$$;

-- A template version's last period (valid_until is the first day after it), set by Orelu's
-- admin only with the official link that discontinues the form, kept beside its source. Until
-- then an older version stays usable for its periods.
create or replace function public.admin_end_template(form text, ver text, until date, link text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  if link !~ '^https://[^[:space:]]+[.][^[:space:]]+$' or length(link) > 500 then raise exception 'The official link is needed' using errcode = '22023'; end if;
  update public.templates t set valid_until = until, source = t.source || jsonb_build_object('ended_by', link)
  where t.form_code = form and t.version = ver and t.status <> 'draft' and t.valid_from < until;
  if not found then return false; end if;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.template_ended', 'rule', jsonb_build_object('form', form, 'version', ver, 'until', until, 'link', link));
  return true;
end;
$$;

revoke all on function public.gov_updates(uuid), public.dismiss_gov_update(uuid, text), public.admin_note_update(text, date, text), public.admin_end_template(text, text, date, text) from public, anon;
grant execute on function public.gov_updates(uuid), public.dismiss_gov_update(uuid, text), public.admin_note_update(text, date, text), public.admin_end_template(text, text, date, text) to authenticated;
