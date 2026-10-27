-- The nightly split firms check (D38 (6)) at any size: each client PAN or GSTIN and each
-- connected account carries identity_hash, a hash the server makes with Orelu's platform key
-- (identityHash in src/lib/crypto.ts), the same in every firm for the same PAN, mailbox or drive
-- account, unlike a firm's blind index. Nobody signed in reads it. The server writes it with each
-- number_enc and address_enc; scripts/identity-hashes.mts fills older rows, and every row again
-- when the platform key changes.
alter table public.client_registrations add column if not exists identity_hash text;
alter table public.connected_accounts add column if not exists identity_hash text;
create index if not exists client_registrations_identity on public.client_registrations (identity_hash, firm_id) where identity_hash is not null;

-- Signed in people read every column of a registration but this one, and may add it with a
-- number (Clients → Add a number); connected accounts already show only listed columns.
revoke select on public.client_registrations from authenticated;
grant select (id, firm_id, client_id, kind, number_enc, number_bidx, state_code, services) on public.client_registrations to authenticated;
grant insert (identity_hash) on public.client_registrations to authenticated;

create or replace function public.add_clients(target_firm uuid, clients jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'manager') then
    return 0;
  end if;
  insert into public.clients (id, firm_id, name, kind, email_enc, email_bidx)
  select (c ->> 'id')::uuid, target_firm, c ->> 'name', c ->> 'kind', c ->> 'email_enc', c ->> 'email_bidx'
  from jsonb_array_elements(clients) c;
  insert into public.client_registrations (firm_id, client_id, kind, number_enc, number_bidx, state_code, identity_hash)
  select target_firm, (c ->> 'id')::uuid, r ->> 'kind', r ->> 'number_enc', r ->> 'number_bidx', r ->> 'state_code', r ->> 'identity_hash'
  from jsonb_array_elements(clients) c, jsonb_array_elements(c -> 'registrations') r;
  return jsonb_array_length(clients);
end;
$$;

-- The check itself, over the hashes, so nothing is opened: pairs of firms not closed with the same
-- firm PAN (from its GSTIN), owner login, mailbox or drive account, or with at least
-- `least_clients` client PANs in common making at least `least_share` of the smaller firm's. For
-- each pair, what matched (kinds only), the client PANs in common and the smaller firm's count.
-- One value, so no row limit cuts it short. Client PANs are read from the index alone, in hash
-- order, so the pairing needs no sort: about 5 seconds for 300 firms of 10,000 clients on a
-- laptop. The API stops a statement after 8 seconds, so this one has its own limit, inside the
-- job's 120 second lease. Server only.
create or replace function public.split_firm_pairs(least_clients int, least_share numeric) returns jsonb
language sql stable set search_path = '' set statement_timeout = '100s' as $$
  with open as (select id, gstin from public.firms where status <> 'closed'),
  held as (
    select 'pan' kind, upper(substr(gstin, 3, 10)) value, id firm from open where gstin <> ''
    union select 'owner', m.user_id::text, m.firm_id from public.firm_members m join open o on o.id = m.firm_id where m.role = 'owner'
    union select a.kind, a.identity_hash, a.firm_id from public.connected_accounts a join open o on o.id = a.firm_id where a.identity_hash is not null),
  pans as not materialized (select distinct identity_hash hash, firm_id firm from public.client_registrations where identity_hash is not null),
  sizes as (select firm, count(*)::int n from pans group by firm),
  common as (select a.firm one, b.firm other, count(*)::int n from pans a join pans b on b.hash = a.hash and b.firm > a.firm group by 1, 2),
  matched as (
    select a.firm one, b.firm other, a.kind from held a join held b on b.kind = a.kind and b.value = a.value and b.firm > a.firm
    union select c.one, c.other, 'clients' from common c join open o on o.id = c.one join open p on p.id = c.other
      join sizes x on x.firm = c.one join sizes y on y.firm = c.other
      where c.n >= least_clients and c.n >= least_share * least(x.n, y.n))
  select coalesce(jsonb_agg(jsonb_build_object('firms', array[m.one, m.other], 'evidence', m.evidence, 'clients', coalesce(c.n, 0), 'smaller', least(x.n, y.n))), '[]')
  from (select one, other, array_agg(kind order by kind collate "C") evidence from matched group by 1, 2) m
    left join common c on c.one = m.one and c.other = m.other
    left join sizes x on x.firm = m.one left join sizes y on y.firm = m.other
$$;
revoke all on function public.split_firm_pairs(int, numeric) from public, anon, authenticated;
grant execute on function public.split_firm_pairs(int, numeric) to service_role;
