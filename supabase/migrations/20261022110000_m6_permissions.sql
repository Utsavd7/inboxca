-- Work rights narrow actions, never membership, office proof or hours.
create function public.clients_with_right(action text) returns setof uuid
language sql stable security definer set search_path='' as $$
  with members as materialized (
    select m.firm_id,m.role,m.access,f.settings,
      case when m.role in ('staff','front_desk') then 'employee' else 'manager' end as col
    from public.firm_members m join public.firms f on f.id=m.firm_id
    where m.user_id=(select auth.uid()) and m.firm_id in(select public.my_firms())
  )
  select c.id from public.clients c join members m on m.firm_id=c.firm_id
  where m.role='owner' or action not in ('remove','settings','export') and (
    exists(select 1 from jsonb_array_elements(coalesce(m.access->'always','[]')) g where g=to_jsonb(action) or
      g->>'right'=action and (not g ? 'until' or g->>'until'>=(now() at time zone 'Asia/Kolkata')::date::text)
      and (not g ? 'clients' or g->'clients' @> to_jsonb(array[c.id::text])))
    or coalesce((m.settings#>>array['permissions',m.col,action])::boolean,action in ('rename','portal_files','check_figures','mark_filed') or action='approve_requests' and m.col='manager')
      and (m.settings#>>array['permissions',m.col,'scope','until'] is null or m.settings#>>array['permissions',m.col,'scope','until']>=(now() at time zone 'Asia/Kolkata')::date::text)
      and (m.settings#>array['permissions',m.col,'scope','clients'] is null or m.settings#>array['permissions',m.col,'scope','clients'] @> to_jsonb(array[c.id::text]))
  );
$$;
revoke all on function public.clients_with_right(text) from public,anon;
grant execute on function public.clients_with_right(text) to authenticated;
create policy tasks_filing_right on public.tasks as restrictive for update to authenticated
  using(true) with check(status<>'filed' or client_id in(select public.clients_with_right('mark_filed')));

-- A candidate is encrypted separately from the checked value. It cannot feed a form.
create function public.save_figure_edit(draft uuid, firm uuid, client uuid, person uuid, line uuid, base text, value_enc text)
returns boolean language plpgsql security definer set search_path='' as $$
declare previous jsonb; edits jsonb; mine jsonb; body jsonb;
begin
  if length(value_enc) not between 20 and 20000 then return false; end if;
  select data into previous from public.datasets where id=draft and firm_id=firm and client_id=client for update;
  if not found or not exists(select 1 from jsonb_array_elements(previous->'lines') l where l->>'id'=line::text and l->>'value_enc'=base)
    or not exists(select 1 from public.firm_members where firm_id=firm and user_id=person and status='active') then return false; end if;
  edits=coalesce(previous->'edits','{}'); mine=coalesce(edits->person::text,'{}');
  if not mine ? line::text and (select count(*) from jsonb_object_keys(mine))>=50 then return false; end if;
  mine=mine||jsonb_build_object(line::text,jsonb_build_object('base',base,'value_enc',value_enc));
  body=previous||jsonb_build_object('edits',edits||jsonb_build_object(person::text,mine));
  if octet_length(body::text)>5000000 then return false; end if;
  update public.datasets set data=body where id=draft;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(firm,person,'dataset.edit_saved','client',client,jsonb_build_object('dataset',draft,'line',line));
  return true;
end;
$$;
revoke all on function public.save_figure_edit(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_figure_edit(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

-- A check in another tab must not erase a correction that has only been kept as a draft.
create function private.keep_figure_edits() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.data ? 'edits' then new.data=jsonb_set(new.data,'{edits}',old.data->'edits'); end if;
  return new;
end;
$$;
create trigger keep_figure_edits before update of revision on public.datasets for each row execute function private.keep_figure_edits();
revoke all on function private.keep_figure_edits() from public,anon,authenticated,service_role;
