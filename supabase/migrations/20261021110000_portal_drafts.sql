-- One open credit draft for the client's month. Sources add pending lines to it.
create unique index datasets_credit_period on public.datasets(firm_id,client_id,period_key) where form_code='GSTR3B';
create function public.append_automatic_dataset(draft uuid,firm uuid,client uuid,form text,period text,expected int,body jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
  select data into previous from public.datasets where id=draft and firm_id=firm and client_id=client and form_code=form and period_key=period and revision=expected for update;
  if not found or not (body->'lines' @> previous->'lines') or not (body->'checks' @> previous->'checks') then return false; end if;
  if exists(select 1 from jsonb_array_elements(body->'lines') line where not (previous->'lines' @> jsonb_build_array(line)) and (line->>'state'<>'pending' or line ? 'by' or line ? 'at')) then return false; end if;
  return public.save_dataset(draft,firm,client,form,period,expected,body,null,'dataset.changed','{}');
end;
$$;
revoke all on function public.append_automatic_dataset(uuid,uuid,uuid,text,text,int,jsonb) from public,anon,authenticated;
grant execute on function public.append_automatic_dataset(uuid,uuid,uuid,text,text,int,jsonb) to service_role;
