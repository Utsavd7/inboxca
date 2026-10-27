-- M0 (PLAN.md D5, D32, D33, 5.14.1): Orelu's own billing of firms. A provider neutral core
-- (src/lib/billing) with Cashfree as its first provider: one AutoPay mandate per firm with a
-- maximum amount, each debit raised by Orelu, one time orders for upgrades and add-ons, and
-- refunds. Written by the server only (webhooks, the billing job, the owner's and admins'
-- actions); the owner reads the firm's own rows.

-- The firm's plan and its mandate. `mandate` is Orelu's own id for the mandate at the provider,
-- so no provider id needs keeping; `plan` holds the firm's answers and add-ons (clients,
-- practice, people, aiBlocks), the mandate's maximum (maxPaise), a downgrade waiting for the
-- renewal (next) and a new mandate waiting for the owner's approval (pending). What a plan
-- includes and costs is read from plan_formula, never stored again. paid_until is the day the
-- next debit is due. The owner's mobile number, which the provider asks for, is sealed with the
-- firm's key.
create table if not exists public.subscriptions (
  firm_id uuid primary key references public.firms (id) on delete cascade,
  mandate text unique check (mandate ~ '^[A-Za-z0-9_-]{1,60}$'),
  cycle text not null check (cycle in ('monthly', 'yearly')),
  method text check (method in ('upi', 'card', 'enach')),
  status text not null default 'created' check (status in ('created', 'active', 'cancelled')),
  paid_until date,
  phone_enc text,
  plan jsonb not null check (jsonb_typeof(plan) = 'object')
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;
grant select (firm_id, cycle, method, status, paid_until, plan) on public.subscriptions to authenticated;
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.member_role(firm_id) = 'owner');

-- Every amount taken or given back. The row's id is also Orelu's id for the order, debit or
-- refund at the provider, so a replayed webhook finds the same row. Money in paise; the amount
-- includes gst_paise. `details` is what the payment buys (the plan, the period it pays for, the
-- add-on); `doc` is the receipt, tax invoice, credit note or refund receipt exactly as issued.
-- No foreign key to firms: Orelu's own accounts keep every document it issued after a firm's
-- data is deleted (delete_firm removes only the tables that point at firms).
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  kind text not null check (kind in ('plan', 'renewal', 'upgrade', 'extra_user', 'ai_block', 'topup', 'setup', 'refund')),
  amount_paise int not null check (amount_paise > 0),
  gst_paise int not null default 0 check (gst_paise >= 0),
  fee_paise int,
  fee_tax_paise int,
  provider_ref text,
  refund_of uuid,
  reason text check (reason in ('money_back', 'duplicate', 'charge_error')),
  status text not null default 'created' check (status in ('created', 'done', 'failed', 'cancelled')),
  due_at timestamptz,
  details jsonb not null default '{}',
  doc jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (firm_id, id),
  foreign key (firm_id, refund_of) references public.payments (firm_id, id),
  check ((kind = 'refund') = (refund_of is not null and reason is not null))
);
create index if not exists payments_firm on public.payments (firm_id, created_at desc);
create unique index if not exists payments_doc_no on public.payments ((doc ->> 'no')) where doc is not null;
create index if not exists payments_open on public.payments (status, due_at) where status = 'created';
alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;
grant select (id, firm_id, kind, amount_paise, gst_paise, refund_of, reason, status, due_at, doc, created_at) on public.payments to authenticated;
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (public.member_role(firm_id) = 'owner');

-- The money-back guarantee once per firm (D33): keyed hashes of the firm's PAN, GSTIN, mailbox
-- address and owner email, and nothing else, kept after the firm's data is deleted for this
-- purpose only.
create table if not exists public.guarantee_claims (
  identity_hash text primary key,
  claimed_at timestamptz not null default now()
);
alter table public.guarantee_claims enable row level security;
revoke all on public.guarantee_claims from anon, authenticated;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'guarantee_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'guarantee_key', 'Keys the hashes in guarantee_claims');
  end if;
end $$;

-- Was the guarantee used by any of these identities? With claim, records them all and answers
-- whether this is the first claim, in one statement, so two presses refund once.
create or replace function public.money_back_claim(identities text[], claim boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  key bytea := convert_to((select decrypted_secret from vault.decrypted_secrets where name = 'guarantee_key'), 'utf8');
  hashes text[] := (select array_agg(distinct encode(extensions.hmac(convert_to(lower(btrim(i)), 'utf8'), key, 'sha256'), 'hex'))
    from unnest(identities) i where btrim(coalesce(i, '')) <> '');
  added int;
begin
  if hashes is null then return false; end if;
  if exists (select 1 from public.guarantee_claims where identity_hash = any(hashes)) then return false; end if;
  if not claim then return true; end if;
  insert into public.guarantee_claims (identity_hash) select unnest(hashes) on conflict do nothing;
  get diagnostics added = row_count;
  return added = array_length(hashes, 1);
end;
$$;
revoke all on function public.money_back_claim(text[], boolean) from public, anon, authenticated;
grant execute on function public.money_back_claim(text[], boolean) to service_role;

-- The pricing formula (PLAN.md 5.14), versioned, with the values of the business plan that the
-- site's price list shows (content/plans.ts; tests/db/billing.test.ts keeps the two equal).
-- Prices are rupees before GST; a null slab bound means "and above". Set once: a later version
-- is the admin's.
insert into public.platform_settings (key, value) values ('plan_formula', '{
  "version": 1,
  "plans": [
    {"code": "solo", "name": "Solo", "monthly": 1499, "yearly": 16499, "maxReturns": 800, "people": 1, "aiCredits": 4000, "blockCap": 1},
    {"code": "growth", "name": "Growth", "monthly": 3499, "yearly": 38499, "maxReturns": 2000, "people": 10, "aiCredits": 10000, "blockCap": 3},
    {"code": "scale", "name": "Scale", "monthly": 7499, "yearly": 82499, "maxReturns": 4000, "people": 20, "aiCredits": 24000, "blockCap": 8},
    {"code": "enterprise", "name": "Enterprise", "monthly": 15499, "yearly": 170499, "maxReturns": 8000, "people": 40, "aiCredits": 60000, "blockCap": 3}
  ],
  "practices": [["salaried", "Mostly salaried", 2], ["mixed", "Mixed", 11.428571428571429], ["gst", "Mostly GST and audit", 18]],
  "extraPerson": 399,
  "custom": {"base": 15499, "floor": 16499, "ending": 499, "returnsPerStep": 200, "includedSteps": 40, "includedPeople": 40,
    "workSlabs": [[80, 305], [null, 275]], "peopleSlabs": [[60, 399], [100, 349], [null, 299]],
    "aiCredits": 60000, "aiPerStep": 1500, "yearlyMonths": 11, "yearlyAdd": 10, "blockShare": 0.25},
  "aiBlock": {"credits": 4000, "price": 399},
  "setup": {},
  "growthCushion": 0.1,
  "fitEnforced": false
}') on conflict (key) do nothing;

-- The admin console's billing view: the latest payments and refunds, refunds by month and
-- reason against new firms that month (an alert above 10%), Orelu's tax settings and the
-- billing alerts the reconciliation and refunds raised.
create or replace function public.admin_billing() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'payments', (select coalesce(jsonb_agg(p order by p.at desc), '[]') from (
      select p.id, f.name firm, p.kind, p.amount_paise amount, p.gst_paise gst, p.fee_paise fee, p.status, p.reason, p.created_at as at, p.doc ->> 'no' as no,
        p.kind <> 'refund' and p.status = 'done' and not exists (select 1 from public.payments r where r.refund_of = p.id and r.status in ('created', 'done')) refundable
      from public.payments p left join public.firms f on f.id = p.firm_id order by p.created_at desc limit 100) p),
    'months', (select coalesce(jsonb_agg(m order by m.month desc), '[]') from (
      select to_char(date_trunc('month', p.created_at at time zone 'Asia/Kolkata'), 'YYYY-MM') as month,
        count(*) filter (where p.kind = 'plan' and p.status = 'done')::int new_firms,
        count(*) filter (where p.kind = 'refund' and p.status <> 'failed')::int refunds,
        count(*) filter (where p.kind = 'refund' and p.reason = 'money_back' and p.status <> 'failed')::int money_back,
        count(*) filter (where p.kind = 'refund' and p.reason = 'duplicate' and p.status <> 'failed')::int duplicate,
        count(*) filter (where p.kind = 'refund' and p.reason = 'charge_error' and p.status <> 'failed')::int charge_error,
        coalesce(sum(p.amount_paise) filter (where p.kind = 'refund' and p.status = 'done'), 0)::bigint refunded
      from public.payments p group by 1 order by 1 desc limit 12) m),
    'tax', coalesce((select value from public.platform_settings where key = 'tax'), '{}'),
    'alerts', coalesce((select value -> 'alerts' from public.platform_settings where key = 'billing'), '[]'));
end;
$$;

-- Orelu's tax details for receipts and invoices (D32), checked by the app before saving.
create or replace function public.admin_set_tax(tax jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  insert into public.platform_settings (key, value) values ('tax', tax)
  on conflict (key) do update set value = excluded.value;
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'admin.tax_saved', 'platform', jsonb_build_object('registered', tax ? 'gstin', 'from', tax ->> 'gstFrom'));
  return true;
end;
$$;

-- A pilot (PLAN.md M0 "admin override for pilots"): an Orelu admin starts a pending firm
-- without a payment.
create or replace function public.admin_pilot(target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  update public.firms set status = 'active' where id = target and status = 'pending';
  if not found then return false; end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
  values (target, (select auth.uid()), 'billing.pilot', 'firm', target);
  return true;
end;
$$;
revoke all on function public.admin_billing(), public.admin_set_tax(jsonb), public.admin_pilot(uuid) from public, anon;
grant execute on function public.admin_billing(), public.admin_set_tax(jsonb), public.admin_pilot(uuid) to authenticated;

-- Thirty days into read only, unpaid or after the money back (5.14.1): the firm closes as when
-- its owner closes it (close_firm), so the owner can still sign in and download its data for 30
-- days, and then InboxCA deletes it. The firm's drive is never touched. Server only.
create or replace function public.close_unpaid(target_firm uuid, why text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if why not in ('unpaid', 'money_back') then raise exception 'Unknown reason' using errcode = '22023'; end if;
  update public.firms set status = 'closed' where id = target_firm and status in ('grace', 'read_only');
  if not found then return false; end if;
  update public.firm_members set status = 'deactivated' where firm_id = target_firm and role <> 'owner';
  delete from public.connected_accounts where firm_id = target_firm;
  update public.jobs set state = 'cancelled' where firm_id = target_firm and state = 'pending';
  delete from auth.sessions s using public.firm_members m
  where m.firm_id = target_firm and s.user_id = m.user_id and m.role <> 'owner';
  insert into public.activity_log (firm_id, action, entity_type, entity_id, details)
    values (target_firm, 'firm.closed', 'firm', target_firm, jsonb_build_object('reason', why));
  insert into public.jobs (kind, entity_type, entity_id, run_at, idempotency_key)
    values ('delete_firm', 'firm', target_firm, now() + interval '30 days', 'delete_firm:' || target_firm)
  on conflict (idempotency_key) do nothing;
  return true;
end;
$$;
revoke all on function public.close_unpaid(uuid, text) from public, anon, authenticated;
grant execute on function public.close_unpaid(uuid, text) to service_role;

-- Once a day at 08:00 India time: each firm with a plan, or behind on one, gets its billing run
-- (notices, renewals, retries, the move to read only), and Orelu one reconciliation run.
create or replace function private.queue_billing() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
    select f.id, 'billing', 'firm', f.id, 'billing:' || f.id || ':' || (now() at time zone 'Asia/Kolkata')::date
    from public.firms f
    where f.status in ('grace', 'read_only') or exists (select 1 from public.subscriptions s where s.firm_id = f.id)
  on conflict (idempotency_key) do nothing;
  insert into public.jobs (kind, entity_type, idempotency_key)
    values ('billing_reconcile', 'platform', 'billing_reconcile:' || (now() at time zone 'Asia/Kolkata')::date)
  on conflict (idempotency_key) do nothing;
$$;
revoke all on function private.queue_billing() from public, anon, authenticated, service_role;
select cron.schedule('billing', '30 2 * * *', 'select private.queue_billing()');
