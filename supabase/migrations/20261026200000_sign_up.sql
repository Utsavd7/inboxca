-- M0: public sign up (PLAN.md D5). The server makes the owner's sign in first, then this
-- makes the firm (pending: no payment yet) and its active owner in one statement. The
-- accepted terms, privacy notice and DPA versions go to activity_log, which nobody can
-- edit, so the time and versions of acceptance are kept as they were.
create or replace function public.sign_up_firm(firm_name text, state text, owner uuid, accepted jsonb)
returns uuid
language sql security definer set search_path = '' as $$
  with firm as (
    insert into public.firms (name, state_code) values (firm_name, state) returning id
  ), member as (
    insert into public.firm_members (firm_id, user_id, role, status)
    select id, owner, 'owner', 'active' from firm
  ), logged as (
    insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select id, owner, 'firm.signed_up', 'firm', id, jsonb_build_object('accepted', accepted) from firm
  )
  select id from firm
$$;

revoke all on function public.sign_up_firm(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sign_up_firm(text, text, uuid, jsonb) to service_role;
