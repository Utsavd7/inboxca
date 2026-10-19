-- Keep office requests private, and log refusals only for staff under the switch.
create function public.can_review_office(target_firm uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.jwt() ->> 'aal') = 'aal2' and private.office_approver(target_firm, (select auth.uid()))
$$;
revoke all on function public.can_review_office(uuid) from public, anon;
grant execute on function public.can_review_office(uuid) to authenticated;
drop policy requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (public.member_role(firm_id) is not null and (client_id is null or public.can_access_client(firm_id, client_id))
    and (entity_type <> 'office_connection' or public.can_review_office(firm_id)));

create or replace function public.office_refused(target_firm uuid, person uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.firms where id = target_firm for update;
  if not exists (select from public.firm_members m join public.firms f on f.id = m.firm_id
    where m.firm_id = target_firm and m.user_id = person and m.status = 'active'
      and m.role in ('staff', 'manager', 'front_desk') and (f.settings -> 'office' ->> 'on')::boolean) then return; end if;
  if not exists (select from public.activity_log where firm_id = target_firm and actor_id = person
    and action = 'office.refused' and at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') then
    insert into public.activity_log (firm_id, actor_id, action, details)
      values (target_firm, person, 'office.refused', jsonb_build_object('reason', reason));
  end if;
end
$$;
