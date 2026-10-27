-- M11 fair use of downloads (PLAN.md D26, 5.14): the month's downloads, India time, are counted
-- and a download's log lines added in one step, under a lock for the firm, so downloads at the
-- same moment never pass `most` (null: no figure set, nothing is stopped). False, and nothing
-- logged, when they do not fit. The activity log stays the only record. Server only.
create or replace function public.claim_downloads(target_firm uuid, lines jsonb, most int default null) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('downloads:' || target_firm, 0));
  if (select count(*) from public.activity_log
      where firm_id = target_firm and action in ('document.downloaded', 'document.downloaded_by_client')
        and at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') + jsonb_array_length(lines) > most then
    return false;
  end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select target_firm, l.actor_id, l.action, 'document', l.entity_id, coalesce(l.details, '{}')
    from jsonb_to_recordset(lines) as l(actor_id uuid, action text, entity_id uuid, details jsonb);
  return true;
end;
$$;
revoke all on function public.claim_downloads(uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.claim_downloads(uuid, jsonb, int) to service_role;
