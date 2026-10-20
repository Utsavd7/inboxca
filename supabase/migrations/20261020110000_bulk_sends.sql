-- A send keeps its recovery token encrypted only until the mailbox confirms delivery.
alter table public.shares add column delivery jsonb;
alter table public.documents add column share_policy text check(share_policy in ('auto','approval','internal'));
grant select(share_policy) on public.documents to authenticated;
alter table public.requests drop constraint requests_kind_check;
alter table public.requests add constraint requests_kind_check check(kind in ('team_reply','documents','alert','import','permission','bulk_send'));

create policy bulk_requests_read on public.requests as restrictive for select to authenticated
  using(kind<>'bulk_send' or details->>'by'=(select auth.uid())::text or firm_id in
    (select m.firm_id from public.firm_members m where m.user_id=(select auth.uid()) and m.role in ('owner','partner')));

create function private.queue_bulk_send() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.jobs(firm_id,kind,entity_type,entity_id,idempotency_key)
  values(new.firm_id,'bulk_send','request',new.id,'bulk_send:' || new.id);
  return new;
end;
$$;
create trigger bulk_send_queued after insert on public.requests for each row when(new.kind='bulk_send') execute function private.queue_bulk_send();
