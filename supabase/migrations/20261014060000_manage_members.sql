-- M0 step 9: the owner changes a person's role, removes them, or brings them back. Each
-- change is logged in the same statement, like invites (step 8). The owner never changes
-- their own row and never makes another owner, so they can not lock themselves out.

create function public.change_role(target_firm uuid, person uuid, new_role text) returns boolean
language sql security definer set search_path = '' as $$
  with changed as (
    update public.firm_members set role = new_role
    where firm_id = target_firm and user_id = person and person <> (select auth.uid())
      and status <> 'deactivated' and role <> new_role and new_role <> 'owner'
      and public.member_role(target_firm) = 'owner'
    returning firm_id, user_id, role
  ), logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select firm_id, (select auth.uid()), 'member.role_changed', 'member', user_id,
      jsonb_build_object('role', role)
    from changed
  )
  select exists (select 1 from changed)
$$;

-- An invite not yet accepted is withdrawn (the row goes); a member is deactivated, so
-- that what they did stays linked to them. Either way they see nothing of the firm.
create function public.remove_member(target_firm uuid, person uuid) returns boolean
language sql security definer set search_path = '' as $$
  with allowed as (
    select public.member_role(target_firm) = 'owner' and person <> (select auth.uid()) as ok
  ), withdrawn as (
    delete from public.firm_members
    where firm_id = target_firm and user_id = person and status = 'invited'
      and (select ok from allowed)
    returning firm_id, user_id, 'member.invite_withdrawn' as action
  ), deactivated as (
    update public.firm_members set status = 'deactivated'
    where firm_id = target_firm and user_id = person and status = 'active'
      and (select ok from allowed)
    returning firm_id, user_id, 'member.removed' as action
  ), done as (
    select * from withdrawn union all select * from deactivated
  ), logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
    select firm_id, (select auth.uid()), action, 'member', user_id from done
  )
  select exists (select 1 from done)
$$;

create function public.restore_member(target_firm uuid, person uuid) returns boolean
language sql security definer set search_path = '' as $$
  with restored as (
    update public.firm_members set status = 'active'
    where firm_id = target_firm and user_id = person and status = 'deactivated'
      and public.member_role(target_firm) = 'owner'
    returning firm_id, user_id
  ), logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
    select firm_id, (select auth.uid()), 'member.restored', 'member', user_id from restored
  )
  select exists (select 1 from restored)
$$;

revoke all on function public.change_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.restore_member(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.change_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.restore_member(uuid, uuid) to authenticated;

-- Roles and status change through the functions above only, so each change is logged.
revoke update (role, status) on public.firm_members from authenticated;
