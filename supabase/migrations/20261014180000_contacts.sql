-- M1 step 8: contact persons (PLAN.md 5.9, 6): the people who write for a client (an
-- accountant, a director, a family member). One contact can act for several clients, so the
-- link carries what they are to that client and what they may receive from the firm. Name
-- and email are encrypted with the firm's key; the email's blind index lets InboxCA match
-- a sender (M3) and finds an existing contact instead of making a second.
-- The contact's language comes with replies (M5).

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  name_enc text not null,
  email_enc text not null,
  email_bidx text not null,
  unique (firm_id, email_bidx),
  unique (firm_id, id)
);

create table public.contact_clients (
  firm_id uuid not null,
  contact_id uuid not null,
  client_id uuid not null,
  relation text check (length(relation) <= 60),
  can_view_status boolean not null default false,
  can_receive_documents boolean not null default false,
  primary key (contact_id, client_id),
  foreign key (firm_id, contact_id) references public.contacts (firm_id, id) on delete cascade,
  foreign key (firm_id, client_id) references public.clients (firm_id, id) on delete cascade
);
create index contact_clients_client on public.contact_clients (firm_id, client_id);

alter table public.contacts enable row level security;
alter table public.contact_clients enable row level security;
revoke all on public.contacts, public.contact_clients from anon, authenticated;
grant select, insert on public.contacts to authenticated;
grant select, insert, delete on public.contact_clients to authenticated;
grant update (relation, can_view_status, can_receive_documents) on public.contact_clients to authenticated;

-- Members see contacts; a contact's links follow the client's visibility. The owner,
-- partners and managers add contacts and change links.
create policy contacts_select on public.contacts for select to authenticated
  using (public.member_role(firm_id) is not null);
create policy contacts_insert on public.contacts for insert to authenticated
  with check (public.member_role(firm_id) in ('owner', 'partner', 'manager'));
create policy contact_clients_select on public.contact_clients for select to authenticated
  using (public.can_access_client(firm_id, client_id));
create policy contact_clients_insert on public.contact_clients for insert to authenticated
  with check (public.member_role(firm_id) in ('owner', 'partner', 'manager'));
create policy contact_clients_update on public.contact_clients for update to authenticated
  using (public.member_role(firm_id) in ('owner', 'partner', 'manager'))
  with check (public.member_role(firm_id) in ('owner', 'partner', 'manager'));
create policy contact_clients_delete on public.contact_clients for delete to authenticated
  using (public.member_role(firm_id) in ('owner', 'partner', 'manager'));

create trigger contacts_logged after insert on public.contacts
  for each row execute function public.log_change('contact', 'id', 'contact');
create trigger contact_clients_logged after insert or update or delete on public.contact_clients
  for each row execute function public.log_change('contact_link', 'client_id');
