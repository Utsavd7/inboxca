-- An old attempt must not mark newly supplied credentials as broken.
drop function public.mail_health(uuid,text,boolean);
create function public.mail_health(account_id uuid, phase text, failed boolean, expected text) returns int
language plpgsql security definer set search_path = '' as $$
declare account public.connected_accounts; failures int;
begin
  if phase not in ('read','send') then raise exception 'unknown mail check'; end if;
  select * into account from public.connected_accounts where id=account_id and kind='mail' and credentials_enc=expected for update;
  if not found then return 0; end if;
  failures := case when failed then coalesce((account.settings->'mail_failures'->>phase)::int,0)+1 else 0 end;
  update public.connected_accounts set settings=jsonb_set(settings,'{mail_failures}',coalesce(settings->'mail_failures','{}') || jsonb_build_object(phase,failures)),
    status=case when failures>=3 then 'needs_reconnect' else status end where id=account_id;
  return failures;
end;
$$;
revoke all on function public.mail_health(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.mail_health(uuid,text,boolean,text) to service_role;

create function public.finish_mail_ack(event_id uuid, template_version int) returns void
language sql security definer set search_path = '' as $$
  with sent as (
    update public.email_events set delivery=delivery || '{"ack":"sent"}' where id=event_id and delivery->>'ack'='sending' returning firm_id,id
  ) insert into public.activity_log(firm_id,action,entity_type,entity_id,details)
    select firm_id,'email.acknowledged','email',id,jsonb_build_object('template','received.en.' || template_version) from sent
$$;
revoke all on function public.finish_mail_ack(uuid,int) from public,anon,authenticated;
grant execute on function public.finish_mail_ack(uuid,int) to service_role;
