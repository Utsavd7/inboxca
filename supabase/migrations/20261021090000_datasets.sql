-- Figures are encrypted separately, bound to their firm, draft and line.
create table public.datasets (
  id uuid primary key,
  firm_id uuid not null,
  client_id uuid not null,
  form_code text not null check (form_code ~ '^[A-Z0-9_]{2,30}$'),
  period_key text not null check (period_key ~ '^20[0-9]{2}(-[0-9]{2})?$'),
  revision int not null default 1,
  data jsonb not null check (jsonb_typeof(data->'lines')='array' and jsonb_array_length(data->'lines') between 1 and 10000),
  foreign key (firm_id,client_id) references public.clients(firm_id,id) on delete cascade
);
create index datasets_client on public.datasets(firm_id,client_id,period_key);
alter table public.datasets enable row level security;
revoke all on public.datasets from anon,authenticated;
grant select on public.datasets to authenticated;
create policy datasets_select on public.datasets for select to authenticated
  using (firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()));

-- The server checks access and figures first. A stale review cannot overwrite a new one.
create function public.save_dataset(draft uuid, firm uuid, client uuid, form text, period text, expected int, body jsonb, person uuid, event text, audit jsonb, permission uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if event not in ('dataset.created','dataset.checked','dataset.changed') then raise exception 'Unknown draft change'; end if;
  if permission is not null then
    perform 1 from public.requests where id=permission and firm_id=firm and client_id=client and kind='permission'
      and reason_code='edit_figures' and status='approved' and expires_at>now() and details->>'by'=person::text for update;
    if not found then return false; end if;
  end if;
  if expected=0 then
    insert into public.datasets(id,firm_id,client_id,form_code,period_key,data) values(draft,firm,client,form,period,body) on conflict do nothing;
  else
    update public.datasets set data=body,revision=revision+1 where id=draft and firm_id=firm and client_id=client and revision=expected and form_code=form and period_key=period;
  end if;
  if not found then return false; end if;
  if permission is not null then update public.requests set status='used' where id=permission; end if;
  insert into public.activity_log(firm_id,actor_id,action,entity_type,entity_id,details)
    values(firm,person,event,'client',client,audit || jsonb_build_object('dataset',draft,'revision',expected+1));
  return true;
end;
$$;
revoke all on function public.save_dataset(uuid,uuid,uuid,text,text,int,jsonb,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_dataset(uuid,uuid,uuid,text,text,int,jsonb,uuid,text,jsonb,uuid) to service_role;
