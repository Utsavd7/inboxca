-- Derived figures leave with a source at its final deletion, never outliving it.
create function private.remove_source_drafts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.datasets where firm_id=old.firm_id and client_id=old.client_id
    and data @> jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('source',jsonb_build_object('document',old.id))));
  return old;
end;
$$;
create trigger documents_remove_drafts after delete on public.documents for each row execute function private.remove_source_drafts();
