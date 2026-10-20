-- An interrupted send stays available to retry; only a confirmed send says Sent.
create or replace function public.finish_share(share_id uuid) returns void
language sql security definer set search_path = '' as $$
  with sent as (
    update public.shares set status='sent',delivery='{"state":"sent"}' where id=share_id and status='waiting' and delivery->>'state'='sending'
    returning id,firm_id,document_id,email_event_id
  ) insert into public.activity_log(firm_id,action,entity_type,entity_id,details)
    select firm_id,'document.shared','document',document_id,jsonb_build_object('share',id,'reply',email_event_id is not null) from sent
$$;
