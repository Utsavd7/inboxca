-- A scoped action never reveals the ids of clients the person cannot see.
create or replace function public.clients_with_right(action text) returns setof uuid
language sql stable security definer set search_path='' as $$
  with members as materialized (
    select m.firm_id,m.role,m.access,f.settings,
      case when m.role in ('staff','front_desk') then 'employee' else 'manager' end as col
    from public.firm_members m join public.firms f on f.id=m.firm_id
    where m.user_id=(select auth.uid()) and m.firm_id in(select public.my_firms())
  )
  select c.id from public.clients c join members m on m.firm_id=c.firm_id
  where (c.firm_id in(select public.open_firms()) or c.id in(select public.assigned_clients()))
    and (m.role='owner' or action not in ('remove','settings','export') and (
    exists(select 1 from jsonb_array_elements(coalesce(m.access->'always','[]')) g where g=to_jsonb(action) or
      g->>'right'=action and (not g ? 'until' or g->>'until'>=(now() at time zone 'Asia/Kolkata')::date::text)
      and (not g ? 'clients' or g->'clients' @> to_jsonb(array[c.id::text])))
    or coalesce((m.settings#>>array['permissions',m.col,action])::boolean,action in ('rename','portal_files','check_figures','mark_filed') or action='approve_requests' and m.col='manager')
      and (m.settings#>>array['permissions',m.col,'scope','until'] is null or m.settings#>>array['permissions',m.col,'scope','until']>=(now() at time zone 'Asia/Kolkata')::date::text)
      and (m.settings#>array['permissions',m.col,'scope','clients'] is null or m.settings#>array['permissions',m.col,'scope','clients'] @> to_jsonb(array[c.id::text]))
  ));
$$;
