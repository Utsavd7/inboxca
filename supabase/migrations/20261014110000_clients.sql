-- M1 step 1: the client register (PLAN.md 6). Client names stay plain for listing (8.4);
-- registration numbers (PAN, GSTIN, TAN, CIN, LLPIN) are encrypted with the firm's key,
-- with a blind index to find a client by number and to refuse the same number twice.
-- Columns arrive with the step that uses them: stage (leads, M9), archiving, branch and
-- group, email and notes come later.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  kind text not null check (kind in ('individual', 'business', 'tax_audit', 'company', 'llp', 'trust')),
  unique (firm_id, id)
);
create index clients_firm_name on public.clients (firm_id, name);

-- One row per number. A GSTIN starts with the state code, kept for the calendar (M2).
create table public.client_registrations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  client_id uuid not null,
  kind text not null check (kind in ('pan', 'gstin', 'tan', 'cin', 'llpin')),
  number_enc text not null,
  number_bidx text not null,
  state_code text check (state_code ~ '^[0-9]{2}$'),
  foreign key (firm_id, client_id) references public.clients (firm_id, id) on delete cascade,
  unique (firm_id, kind, number_bidx)
);
create index client_registrations_client on public.client_registrations (firm_id, client_id);

alter table public.clients enable row level security;
alter table public.client_registrations enable row level security;
revoke all on public.clients, public.client_registrations from anon, authenticated;
grant select on public.clients, public.client_registrations to authenticated;

-- Every employee sees every client by default (open visibility, 5.9); restricted
-- visibility arrives with client assignment.
create policy clients_select on public.clients for select to authenticated
  using (public.member_role(firm_id) is not null);
create policy registrations_select on public.client_registrations for select to authenticated
  using (public.member_role(firm_id) is not null);

-- Adding a client: the owner, a partner or a manager (staff view only, 5.17.2). The app
-- encrypts the numbers, so it chooses the client's id (the encryption is bound to it).
-- One statement adds the client, its numbers and the log line.
create function public.add_client(target_firm uuid, client uuid, client_name text, client_kind text, registrations jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') then
    return false;
  end if;
  insert into public.clients (id, firm_id, name, kind) values (client, target_firm, client_name, client_kind);
  insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code)
  select target_firm, client, r ->> 'kind', r ->> 'number_enc', r ->> 'number_bidx', r ->> 'state_code'
  from jsonb_array_elements(registrations) r;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
  values (target_firm, (select auth.uid()), 'client.added', 'client', client);
  return true;
end;
$$;
revoke all on function public.add_client(uuid, uuid, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.add_client(uuid, uuid, text, text, jsonb) to authenticated;
