-- Delivery and its log finish together, including a send found after a worker stopped.
create function public.finish_share(share_id uuid) returns void
language sql security definer set search_path = '' as $$
  with sent as (
    update public.shares set delivery='{"state":"sent"}' where id=share_id and delivery->>'state'='sending'
    returning id,firm_id,document_id,email_event_id
  ) insert into public.activity_log(firm_id,action,entity_type,entity_id,details)
    select firm_id,'document.shared','document',document_id,jsonb_build_object('share',id,'reply',email_event_id is not null) from sent
$$;
revoke all on function public.finish_share(uuid) from public,anon,authenticated;
grant execute on function public.finish_share(uuid) to service_role;
