-- The weekly check of due dates (the user, 3 Nov 2026): every Sunday InboxCA reads the week's
-- official notices the daily check found (src/jobs/date-watch.ts) and a plain extension of a
-- return it knows takes effect at once for every firm, marked as taken from that notice; any
-- doubt waits for a person. A date is never moved earlier, and any Orelu admin undoes an
-- automatic extension in one click. The week's items and what was done wait in
-- platform_settings 'dates' for /admin/due-dates.

-- 09:00 India time on Sunday is 03:30 UTC, after the day's forms check at 08:30.
create or replace function private.queue_date_watch() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (kind, entity_type, idempotency_key)
  values ('date_watch', 'platform', 'date_watch:' || (now() at time zone 'Asia/Kolkata')::date)
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_date_watch() from public, anon, authenticated, service_role;
select cron.schedule('date-watch', '30 3 * * 0', 'select private.queue_date_watch()');

-- An extension read from an official notice, for the server only: the period's row is added,
-- already checked (the notice is the check), and the period's returns not yet filed move to
-- the new date. Refused, in a word, when the rule is unknown, the period already has an
-- extension (a person decides whether it is extended again), the rule has no fixed date for
-- the period (AOC-4 and MGT-7 follow the AGM), the notice's earlier date is not the rule's
-- date for the period (it is about something else), or the new date is not later than every
-- date the period has today. Nothing is ever moved earlier.
create or replace function public.apply_notice_extension(rule_code text, rule_period text, new_date date, link text, notice text, earlier date default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  rule jsonb;
  usual date;
begin
  select due_rule into rule from public.compliance_types where code = rule_code and period_key = '';
  if rule is null then return 'unknown'; end if;
  if exists (select 1 from public.compliance_types where code = rule_code and period_key = rule_period) then return 'exists'; end if;
  usual := private.due_on(rule, (rule_period || '-01')::date, null);
  if usual is null then return 'no_fixed_date'; end if;
  if earlier is not null and earlier <> usual then return 'mismatch'; end if;
  if new_date <= greatest(usual, (select max(due_on) from public.tasks where kind = 'compliance' and code = rule_code and period_key = rule_period and status <> 'filed')) then return 'earlier'; end if;
  insert into public.compliance_types (code, period_key, due_rule, source_url, verified_on, approved_by)
  values (rule_code, rule_period, jsonb_build_object('on', new_date, 'notice', notice), btrim(link), (now() at time zone 'Asia/Kolkata')::date, 'InboxCA, from the official notice');
  update public.tasks set due_on = new_date
  where kind = 'compliance' and code = rule_code and period_key = rule_period and status <> 'filed' and due_on < new_date;
  insert into public.activity_log (action, entity_type, details)
  values ('watch.extension_applied', 'rule', jsonb_build_object('code', rule_code, 'period', rule_period, 'on', new_date, 'notice', notice, 'link', btrim(link)));
  return 'extended';
end;
$$;
revoke all on function public.apply_notice_extension(text, text, date, text, text, date) from public, anon, authenticated;

-- An Orelu admin undoes an automatic extension: the period's row goes, and its returns not yet
-- filed go back to the rule's date for each one's state. Logged with what was undone.
create or replace function public.admin_undo_extension(rule_code text, rule_period text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  undone jsonb;
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  delete from public.compliance_types where code = rule_code and period_key = rule_period and period_key <> '' and due_rule ? 'notice' returning due_rule into undone;
  if undone is null then return false; end if;
  update public.tasks t set due_on = private.due_on(x.due_rule, (t.period_key || '-01')::date, (select r.state_code from public.client_registrations r where r.id = t.registration_id))
  from public.compliance_types x
  where x.code = rule_code and x.period_key = '' and t.kind = 'compliance' and t.code = rule_code and t.period_key = rule_period and t.status <> 'filed';
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.extension_undone', 'rule', jsonb_build_object('code', rule_code, 'period', rule_period) || undone);
  return true;
end;
$$;

-- The week's official items and what the Sunday check did with each, for the admin.
create or replace function public.admin_dates() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return coalesce((select value from public.platform_settings where key = 'dates'), '{}');
end;
$$;

revoke all on function public.admin_undo_extension(text, text), public.admin_dates() from public, anon;
grant execute on function public.admin_undo_extension(text, text), public.admin_dates() to authenticated;
