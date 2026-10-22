-- Name the saved value separately from the grouped edits.
create or replace function private.keep_figure_edits() returns trigger
language plpgsql set search_path='' as $$
declare saved_edits jsonb;
begin
  if old.data ? 'edits' then
    with actual as materialized (select l->>'id' id,l->>'value_enc' base from jsonb_array_elements(new.data->'lines') l),
    kept as (
      select p.key person,c.key line,c.value from jsonb_each(old.data->'edits') p
      cross join lateral jsonb_each(p.value) c join actual a on a.id=c.key and a.base=c.value->>'base'
    ), people as (select person,jsonb_object_agg(line,value) edits from kept group by person)
    select coalesce(jsonb_object_agg(people.person,people.edits),'{}') into saved_edits from people;
    new.data=jsonb_set(new.data,'{edits}',saved_edits);
  end if;
  return new;
end;
$$;
