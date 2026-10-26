-- Who did it, in the activity log. A paper a person sends is logged as theirs; one the
-- server sends on its own (a records reply, a bulk send asked for earlier, an
-- acknowledgement) has no person. As in 20261020111000_share_delivery_status.sql otherwise.
drop function if exists public.finish_share(uuid);
create function public.finish_share(share_id uuid, actor uuid default null) returns void
language sql security definer set search_path = '' as $$
  with sent as (
    update public.shares set status='sent',delivery='{"state":"sent"}' where id=share_id and status='waiting' and delivery->>'state'='sending'
    returning id,firm_id,document_id,email_event_id
  ) insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    select firm_id,actor,'document.shared','document',document_id,jsonb_build_object('share',id,'reply',email_event_id is not null) from sent
$$;
revoke all on function public.finish_share(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_share(uuid, uuid) to service_role;

-- An Orelu admin's review of a change to an official source is logged like a checked rule.
-- As in 20261026100000_admin_console.sql otherwise.
create or replace function public.admin_review_change(change_source text, change_at text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare reviewed boolean;
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  update public.platform_settings s set value = jsonb_set(s.value, '{changes}', (
    select jsonb_agg(case when c ->> 'source' = change_source and c ->> 'at' = change_at
      then c || jsonb_build_object('status', 'reviewed', 'reviewed_by', (select auth.uid()), 'reviewed_at', now()) else c end order by n)
    from jsonb_array_elements(s.value -> 'changes') with ordinality e (c, n)))
  where s.key = 'watch' and exists (select 1 from jsonb_array_elements(s.value -> 'changes') c
    where c ->> 'source' = change_source and c ->> 'at' = change_at and c ->> 'status' = 'draft');
  reviewed := found;
  if reviewed then
    insert into public.activity_log (actor_id, action, entity_type, details)
    values ((select auth.uid()), 'admin.change_reviewed', 'rule', jsonb_build_object('source', change_source, 'at', change_at));
  end if;
  return reviewed;
end;
$$;
