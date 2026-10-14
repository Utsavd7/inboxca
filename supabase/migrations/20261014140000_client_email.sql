-- M1 step 4: the client's email address, optional. InboxCA works from email, so the
-- sender's address is how it first knows a client. Encrypted like the numbers, with a blind
-- index to match a sender; not unique, since one person often writes for several clients
-- (a family, a group of businesses).
alter table public.clients add column email_enc text, add column email_bidx text;
create index clients_email on public.clients (firm_id, email_bidx) where email_bidx is not null;
grant update (email_enc, email_bidx) on public.clients to authenticated;

create or replace function public.add_clients(target_firm uuid, clients jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') then
    return 0;
  end if;
  insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx)
  select (c ->> 'id')::uuid, target_firm, c ->> 'name', c ->> 'kind', c ->> 'email_enc', c ->> 'email_bidx'
  from jsonb_array_elements(clients) c;
  insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code)
  select target_firm, (c ->> 'id')::uuid, r ->> 'kind', r ->> 'number_enc', r ->> 'number_bidx', r ->> 'state_code'
  from jsonb_array_elements(clients) c, jsonb_array_elements(c -> 'registrations') r;
  return jsonb_array_length(clients);
end;
$$;
