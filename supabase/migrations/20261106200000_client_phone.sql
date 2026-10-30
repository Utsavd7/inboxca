-- The client's phone number, optional, for calls and WhatsApp click to chat from the staff's
-- own phone (no API). Encrypted like the email; nothing looks a client up by phone, so there
-- is no blind index. Imported with the client list.
alter table public.clients add column if not exists phone_enc text;
grant update (phone_enc) on public.clients to authenticated;

create or replace function public.add_clients(target_firm uuid, clients jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') then
    return 0;
  end if;
  insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx, phone_enc)
  select (c ->> 'id')::uuid, target_firm, c ->> 'name', c ->> 'kind', c ->> 'email_enc', c ->> 'email_bidx', c ->> 'phone_enc'
  from jsonb_array_elements(clients) c;
  insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code, identity_hash)
  select target_firm, (c ->> 'id')::uuid, r ->> 'kind', r ->> 'number_enc', r ->> 'number_bidx', r ->> 'state_code', r ->> 'identity_hash'
  from jsonb_array_elements(clients) c, jsonb_array_elements(c -> 'registrations') r;
  -- A new client has one number of each kind.
  update public.client_registrations n set services = array(select jsonb_array_elements_text(r -> 'services'))
  from jsonb_array_elements(clients) c, jsonb_array_elements(c -> 'registrations') r
  where n.firm_id = target_firm and n.client_id = (c ->> 'id')::uuid and n.kind = r ->> 'kind'
    and jsonb_typeof(r -> 'services') = 'array' and jsonb_array_length(r -> 'services') > 0;
  return jsonb_array_length(clients);
end;
$$;
