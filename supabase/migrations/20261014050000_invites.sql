-- M0 step 8: invites. The owner adds a person to the firm with a role; the person sees the
-- invite after signing in (both sign in steps) and joins with one press. Each change is
-- written to activity_log in the same statement, so it can not happen unlogged.

-- The owner invites someone who has an InboxCA sign in (the server makes one first if
-- needed). Never a second owner; never someone already in the firm.
create function public.invite_member(target_firm uuid, person uuid, new_role text) returns boolean
language sql security definer set search_path = '' as $$
  with added as (
    insert into public.firm_members (firm_id, user_id, role)
    select target_firm, person, new_role
    where public.member_role(target_firm) = 'owner' and new_role <> 'owner'
    on conflict do nothing
    returning firm_id, user_id, role
  ), logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select firm_id, (select auth.uid()), 'member.invited', 'member', user_id,
      jsonb_build_object('role', role)
    from added
  )
  select exists (select 1 from added)
$$;

-- The signed in person's open invites, with the firm's name: they can not read the firm
-- itself until they join.
create function public.my_invites()
returns table (firm_id uuid, firm_name text, role text)
language sql stable security definer set search_path = '' as $$
  select m.firm_id, f.name, m.role
  from public.firm_members m join public.firms f on f.id = m.firm_id
  where m.user_id = (select auth.uid()) and m.status = 'invited'
    and (select auth.jwt() ->> 'aal') = 'aal2'
$$;

create function public.accept_invite(target_firm uuid) returns boolean
language sql security definer set search_path = '' as $$
  with joined as (
    update public.firm_members set status = 'active'
    where firm_id = target_firm and user_id = (select auth.uid()) and status = 'invited'
      and (select auth.jwt() ->> 'aal') = 'aal2'
    returning firm_id, user_id
  ), logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
    select firm_id, user_id, 'member.joined', 'member', user_id from joined
  )
  select exists (select 1 from joined)
$$;

-- The firm's people with their email addresses (kept by Supabase Auth, not repeated in
-- firm_members), for anyone active in the firm.
create function public.firm_people(target_firm uuid)
returns table (user_id uuid, email text, role text, status text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.status
  from public.firm_members m join auth.users u on u.id = m.user_id
  where m.firm_id = target_firm and public.member_role(target_firm) is not null
  order by m.status, u.email
$$;

-- Server only: whether an address already has an InboxCA sign in.
create function public.user_id_for_email(address text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where email = lower(address)
$$;

revoke all on function public.invite_member(uuid, uuid, text), public.my_invites(),
  public.accept_invite(uuid), public.firm_people(uuid), public.user_id_for_email(text)
  from public, anon, authenticated, service_role;
grant execute on function public.invite_member(uuid, uuid, text), public.my_invites(),
  public.accept_invite(uuid), public.firm_people(uuid) to authenticated;
grant execute on function public.user_id_for_email(text) to service_role;

-- Invites go through invite_member only, so that each one is logged.
revoke insert on public.firm_members from authenticated;
drop policy members_insert on public.firm_members;
