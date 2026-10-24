-- Review of M6: when a removed file is finally deleted, only its own figures leave. A draft
-- that also holds figures from other files (a month's GSTR-2B statements for several GSTINs)
-- keeps those, with their checks, as a new revision, which clears any approval built on it.
-- The draft is deleted only when no figure is left. Totals checks that used a removed figure
-- go with it.
create or replace function private.remove_source_drafts() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  draft public.datasets;
  kept jsonb;
  gone text[];
begin
  for draft in select * from public.datasets where firm_id=old.firm_id and client_id=old.client_id
      and data @> jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('source',jsonb_build_object('document',old.id))))
      for update loop
    select coalesce(jsonb_agg(l) filter (where l->'source'->>'document' is distinct from old.id::text),'[]'),
      coalesce(array_agg(l->>'id') filter (where l->'source'->>'document'=old.id::text),'{}')
      into kept,gone from jsonb_array_elements(draft.data->'lines') l;
    if jsonb_array_length(kept)=0 then
      delete from public.datasets where id=draft.id;
    else
      update public.datasets set revision=revision+1,data=jsonb_set(jsonb_set(data,'{lines}',kept),'{checks}',coalesce((
        select jsonb_agg(c) from jsonb_array_elements(data->'checks') c
        where not (coalesce(c->'parts','[]') ?| gone) and coalesce(c->>'total','') <> all(gone)
          and coalesce(c->>'base','') <> all(gone) and coalesce(c->>'rate','') <> all(gone)),'[]'))
      where id=draft.id;
    end if;
  end loop;
  return old;
end;
$$;
