-- Changing the switch applies to checked files too, without changing their contents.
create function private.change_form_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce((new.settings->>'second_form_approval')::boolean,false) is distinct from coalesce((old.settings->>'second_form_approval')::boolean,false) then
    if coalesce((new.settings->>'second_form_approval')::boolean,false) then
      update public.documents d set prepared=jsonb_set(prepared,'{status}','"draft"') where firm_id=new.id and prepared->>'status'='approved'
        and not exists(select 1 from public.activity_log where firm_id=new.id and entity_id=d.id and action='form.approved');
    else
      update public.documents d set prepared=jsonb_set(prepared,'{status}','"approved"') where firm_id=new.id and prepared->>'status'='draft' and private.form_current(d.id);
    end if;
  end if;
  return new;
end;
$$;
create trigger form_approval_switch after update of settings on public.firms for each row execute function private.change_form_approval();
revoke all on function private.change_form_approval() from public,anon,authenticated,service_role;
