-- Parenthesise each JSON value before checking containment.
create or replace function public.append_automatic_dataset(draft uuid,firm uuid,client uuid,form text,period text,expected int,body jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
  select data into previous from public.datasets where id=draft and firm_id=firm and client_id=client and form_code=form and period_key=period and revision=expected for update;
  if not found or jsonb_typeof(body->'lines') is distinct from 'array' or jsonb_typeof(body->'checks') is distinct from 'array' then return false; end if;
  if not ((body->'lines') @> (previous->'lines')) or not ((body->'checks') @> (previous->'checks')) then return false; end if;
  if exists(select 1 from jsonb_array_elements(body->'lines') line where not ((previous->'lines') @> jsonb_build_array(line)) and (line->>'state' is distinct from 'pending' or line ? 'by' or line ? 'at')) then return false; end if;
  return public.save_dataset(draft,firm,client,form,period,expected,body,null,'dataset.changed','{}');
end;
$$;
