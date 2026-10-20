-- One mailbox counter and one send queue, shared by every kind of outgoing email.
alter table public.email_events add column delivery jsonb not null default '{}';
create function public.mail_health(account_id uuid, phase text, failed boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare account public.connected_accounts; failures int;
begin
  if phase not in ('read','send') then raise exception 'unknown mail check'; end if;
  select * into account from public.connected_accounts where id=account_id and kind='mail' for update;
  if not found then return 0; end if;
  failures := case when failed then coalesce((account.settings->'mail_failures'->>phase)::int,0)+1 else 0 end;
  update public.connected_accounts set settings=jsonb_set(settings,'{mail_failures}',coalesce(settings->'mail_failures','{}') || jsonb_build_object(phase,failures)),
    status=case when failures>=3 then 'needs_reconnect' else status end where id=account_id;
  return failures;
end;
$$;
revoke all on function public.mail_health(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.mail_health(uuid,text,boolean) to service_role;

-- Keep only reservation times from the last 24 hours, never addresses or email text.
create function public.reserve_mail_send(account_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare account public.connected_accounts; sends jsonb; first_send timestamptz; last_send timestamptz; slot timestamptz; cap int;
begin
  select * into account from public.connected_accounts where id=account_id and kind='mail' for update;
  if not found or account.status<>'connected' then return jsonb_build_object('ready',false,'at',now()+interval '1 hour'); end if;
  select case when settings->>'mail_limit' ~ '^[0-9]{1,4}$' then greatest(1,least(2000,(settings->>'mail_limit')::int)) else 500 end into cap from public.firms where id=account.firm_id;
  select coalesce(jsonb_agg(at order by at),'[]'),min(at),max(at) into sends,first_send,last_send
    from (select value::timestamptz at from jsonb_array_elements_text(coalesce(account.settings->'mail_sends','[]')) where value::timestamptz>now()-interval '24 hours') times;
  if jsonb_array_length(sends)>=cap then return jsonb_build_object('ready',false,'at',first_send+interval '24 hours 5 seconds'); end if;
  slot := greatest(now(),coalesce(last_send+interval '1 second',now()));
  if slot>now()+interval '5 seconds' then return jsonb_build_object('ready',false,'at',slot); end if;
  update public.connected_accounts set settings=jsonb_set(settings,'{mail_sends}',sends || jsonb_build_array(slot)) where id=account_id;
  return jsonb_build_object('ready',true,'at',slot);
end;
$$;
revoke all on function public.reserve_mail_send(uuid) from public,anon,authenticated;
grant execute on function public.reserve_mail_send(uuid) to service_role;

create function private.mailbox_reconnect() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key)
    values(new.firm_id,'mailbox_reconnect','account',new.id,'mailbox_reconnect:' || new.id || ':' || gen_random_uuid());
  return new;
end;
$$;
create trigger mailbox_reconnect after update of status on public.connected_accounts for each row
  when(new.kind='mail' and new.status='needs_reconnect' and old.status is distinct from new.status) execute function private.mailbox_reconnect();
