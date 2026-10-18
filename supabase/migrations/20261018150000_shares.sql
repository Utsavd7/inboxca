-- M4 step 9: documents sent out to a client (PLAN.md 5.10, 8.6). Every send is a row: the
-- document, who it went to (a contact, or the client's own registered address when there
-- is none), and a secure link that works for 7 days and 5 downloads. Only the hash of the
-- link's token is kept; the text of the email is not.
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  contact_id uuid,
  link_token_hash text not null unique,
  link_expires_at timestamptz not null,
  downloads int not null default 0 check (downloads between 0 and 5),
  foreign key (firm_id, contact_id) references public.contacts (firm_id, id) on delete cascade
);
create index shares_document on public.shares (document_id);
alter table public.shares enable row level security;
revoke all on public.shares from anon, authenticated;
grant select (id, firm_id, document_id, contact_id, link_expires_at, downloads) on public.shares to authenticated;
-- Written by the server only; a send follows its document's visibility.
create policy shares_select on public.shares for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.can_access_client(d.firm_id, d.client_id)));

-- Counts one download of a current link and hands back what it is for, or nothing once the
-- link has expired or been used 5 times. Only the server calls this.
create function public.use_share(token_hash text)
returns table (firm_id uuid, document_id uuid) language sql security definer set search_path = '' as $$
  update public.shares s set downloads = s.downloads + 1
  where s.link_token_hash = token_hash and s.link_expires_at > now() and s.downloads < 5
  returning s.firm_id, s.document_id
$$;
revoke all on function public.use_share(text) from public, anon, authenticated;
grant execute on function public.use_share(text) to service_role;
