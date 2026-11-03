-- The logins of a closed firm's people stay with its activity log for the extra year, instead of
-- going with its records at day 30. An intermediary keeps what a user gave to register for 180
-- days after the registration ends (IT Rules 2021, rule 3(1)(h)), and from May 2027 the DPDP
-- Rules 2025 keep logs of processing a year (rule 8(3)). Their sessions end at day 30; the second
-- run removes the logins of those still in no other firm. The rest is as in firm_download_close.
create or replace function public.delete_firm(target_firm uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  people uuid[];
  firm_settings jsonb := (select settings from public.firms where id = target_firm and status = 'closed');
  deleted_on date := (firm_settings ->> 'data_deleted_on')::date;
  part regclass;
begin
  if deleted_on is not null then
    if deleted_on > current_date - 365 then return false; end if;
    select array_agg(value::uuid) into people from jsonb_array_elements_text(coalesce(firm_settings -> 'people', '[]'));
    perform set_config('app.log_purge', 'on', true);
    delete from public.firms where id = target_firm;
    perform set_config('app.log_purge', 'off', true);
    delete from auth.users u where u.id = any(people)
      and not exists (select 1 from public.firm_members o where o.user_id = u.id);
    return true;
  end if;
  if firm_settings is null
    or not exists (select 1 from public.activity_log where firm_id = target_firm and action = 'firm.closed'
      and at <= now() - interval '30 days') then
    return false;
  end if;
  select array_agg(m.user_id) into people from public.firm_members m
  where m.firm_id = target_firm
    and not exists (select 1 from public.firm_members o where o.user_id = m.user_id and o.firm_id <> target_firm);
  -- Every table that hangs off the firm, except the log; their own children go by cascade.
  for part in select distinct c.conrelid::regclass from pg_catalog.pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.firms'::regclass and c.conrelid::regclass::text not like '%activity_log%'
  loop
    execute format('delete from %s where firm_id = $1', part) using target_firm;
  end loop;
  update public.firms set settings = jsonb_build_object('data_deleted_on', current_date, 'people', coalesce(to_jsonb(people), '[]'))
  where id = target_firm;
  insert into public.activity_log (firm_id, action, entity_type, entity_id) values (target_firm, 'firm.data_deleted', 'firm', target_firm);
  insert into public.jobs (kind, entity_type, entity_id, run_at, idempotency_key)
    values ('delete_firm', 'firm', target_firm, now() + interval '366 days', 'delete_firm_log:' || target_firm);
  delete from auth.sessions where user_id = any(people);
  return true;
end;
$$;
revoke all on function public.delete_firm(uuid) from public, anon, authenticated;
grant execute on function public.delete_firm(uuid) to service_role;
