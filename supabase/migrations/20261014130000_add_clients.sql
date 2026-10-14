-- M1 step 3: clients are added in batches, so an import of 500 is one call. Replaces
-- add_client; the form adds a batch of one. Same rules: the owner, a partner or a manager;
-- the app encrypts the numbers and chooses each id; the trigger logs every client and number.
-- clients: [{"id", "name", "kind", "registrations": [{"kind", "number_enc", "number_bidx", "state_code"}]}]
drop function public.add_client(uuid, uuid, text, text, jsonb);

create function public.add_clients(target_firm uuid, clients jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') then
    return 0;
  end if;
  insert into public.clients (id, firm_id, name, kind)
  select (c ->> 'id')::uuid, target_firm, c ->> 'name', c ->> 'kind' from jsonb_array_elements(clients) c;
  insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code)
  select target_firm, (c ->> 'id')::uuid, r ->> 'kind', r ->> 'number_enc', r ->> 'number_bidx', r ->> 'state_code'
  from jsonb_array_elements(clients) c, jsonb_array_elements(c -> 'registrations') r;
  return jsonb_array_length(clients);
end;
$$;
revoke all on function public.add_clients(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.add_clients(uuid, jsonb) to authenticated;
