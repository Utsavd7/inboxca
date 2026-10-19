-- M7 step 2: each PC under Office only waits for the owner's approval before the server
-- sends the office proof. The browser keeps the secret; only its hash is stored here.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  name text not null check (length(name) between 1 and 80),
  kind text check (kind in ('office', 'laptop')),
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'refused')),
  unique (firm_id, id),
  check ((status = 'approved') = (kind is not null))
);

create index devices_firm_status on public.devices (firm_id, status);
alter table public.devices enable row level security;
revoke all on public.devices from anon, authenticated;
grant select on public.devices to authenticated;
grant select, insert, update, delete on public.devices to service_role;

create policy devices_select on public.devices for select to authenticated
  using (firm_id in (select public.my_firms()));
