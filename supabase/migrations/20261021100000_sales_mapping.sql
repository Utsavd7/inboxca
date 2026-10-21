-- Column choices contain client headings, so the server encrypts them too.
alter table public.clients add column sales_mapping_enc text;

-- A document job creates a pending draft once, without naming a person as its author.
create function public.create_automatic_dataset(draft uuid, firm uuid, client uuid, form text, period text, body jsonb)
returns boolean language sql security definer set search_path='' as $$
  select public.save_dataset(draft,firm,client,form,period,0,body,null,'dataset.created','{}');
$$;
revoke all on function public.create_automatic_dataset(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_automatic_dataset(uuid,uuid,uuid,text,text,jsonb) to service_role;
