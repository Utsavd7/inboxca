-- M9 and M11 (PLAN.md 5.18, D26, D29): every AI call reserves credits before it is made and
-- settles to what the provider reported after, against the firm's India month. One row a call:
-- its reason, its credits (the reservation, then the settled amount), the provider's cost in
-- rupees beside them (null when the model has no price set), and a keyed hash of what was sent,
-- made with the firm's id so the same text in two firms hashes apart. The hash keys the cache
-- and finds the same email or paper sent to AI twice. A call answered from the cache is a row of
-- 0 credits. Never a prompt or an answer (D6). Server only.
create table if not exists public.ai_ledger (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  at timestamptz not null default now(),
  reason text not null check (length(reason) between 1 and 40),
  credits int not null check (credits >= 0),
  cost numeric,
  hash text not null
);
create index if not exists ai_ledger_firm on public.ai_ledger (firm_id, at);
alter table public.ai_ledger enable row level security;
revoke all on public.ai_ledger from anon, authenticated;

-- The firm's AI credits this India month (5.18): its plan's monthly credits with the AI blocks it
-- pays for (`monthly`, worked out by the server from plan_formula), `block` credits for each
-- top-up paid this month, and what it left unused of last month's, at today's plan, rolled over
-- for one month up to one month's credits, so the balance stays within twice the allowance. A
-- month's own credits are spent before what rolled into it. Server only.
create or replace function public.ai_credits(target_firm uuid, monthly int, block int)
returns table (available int, used int)
language sql stable security definer set search_path = '' as $$
  with month as (
    select date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as since,
      (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month') at time zone 'Asia/Kolkata' as before
  )
  select (monthly + block * topups.now + case when f.created_at < m.since then least(greatest(monthly + block * topups.last - spent.last, 0), monthly) else 0 end)::int,
    spent.now
  from month m
  join public.firms f on f.id = target_firm
  cross join lateral (select coalesce(sum(l.credits) filter (where l.at >= m.since), 0)::int as now, coalesce(sum(l.credits) filter (where l.at < m.since), 0)::int as last
    from public.ai_ledger l where l.firm_id = target_firm and l.at >= m.before) spent
  cross join lateral (select count(*) filter (where p.created_at >= m.since)::int as now, count(*) filter (where p.created_at < m.since)::int as last
    from public.payments p where p.firm_id = target_firm and p.kind = 'topup' and p.status = 'done' and p.created_at >= m.before) topups
$$;

-- Reserves `want` credits for one AI call, or none: one reservation at a time for a firm, and only
-- while its use this month stays within `share` of its credits (1, or 0.9 for automatic work,
-- which pauses at 90%). Returns the reservation (null when refused), whether the firm already sent
-- the same thing to AI this month, and the month's credits and use after it. Server only.
create or replace function public.ai_reserve(target_firm uuid, monthly int, block int, why text, want int, share numeric, digest text)
returns table (ticket bigint, again boolean, available int, used int)
language plpgsql volatile security definer set search_path = '' as $$
declare
  credit record;
  made bigint;
  since timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_ledger:' || target_firm, 0));
  select c.available, c.used into credit from public.ai_credits(target_firm, monthly, block) c;
  if credit.available is null or want < 1 or credit.used + want > credit.available * share then
    return query select null::bigint, false, credit.available, credit.used;
    return;
  end if;
  insert into public.ai_ledger (firm_id, reason, credits, hash) values (target_firm, why, want, digest) returning id into made;
  return query select made, exists (select 1 from public.ai_ledger e where e.firm_id = target_firm and e.at >= since and e.hash = digest and e.credits > 0 and e.id <> made),
    credit.available, credit.used + want;
end;
$$;
revoke all on function public.ai_credits(uuid, int, int), public.ai_reserve(uuid, int, int, text, int, numeric, text) from public, anon, authenticated;
grant execute on function public.ai_credits(uuid, int, int), public.ai_reserve(uuid, int, int, text, int, numeric, text) to service_role;

-- The AI efficiency report (D29) for Orelu admins, over the last 30 days: calls by reason and by
-- firm, how many the cache answered with no AI, and calls that sent the same email or paper as an
-- earlier call of the firm (avoidable). Counts, credits and cost only.
create or replace function public.admin_ai_report() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return (
    with recent as (
      select l.firm_id, l.reason, l.credits, l.cost,
        l.credits > 0 and count(*) filter (where l.credits > 0) over (partition by l.firm_id, l.hash order by l.id) > 1 as again
      from public.ai_ledger l where l.at > now() - interval '30 days'
    )
    select jsonb_build_object(
      'reasons', (select coalesce(jsonb_agg(r order by r.credits desc), '[]') from (
        select reason, count(*) filter (where credits > 0)::int calls, count(*) filter (where credits = 0)::int hits, count(*) filter (where again)::int again,
          sum(credits)::int credits, sum(cost) cost
        from recent group by reason) r),
      'firms', (select coalesce(jsonb_agg(f order by f.credits desc), '[]') from (
        select r.firm_id id, f.name, count(*) filter (where r.credits > 0)::int calls, count(*) filter (where r.credits = 0)::int hits,
          count(*) filter (where r.again)::int again, sum(r.credits)::int credits, sum(r.cost) cost
        from recent r join public.firms f on f.id = r.firm_id group by r.firm_id, f.name order by 6 desc limit 100) f))
  );
end;
$$;
revoke all on function public.admin_ai_report() from public, anon;
grant execute on function public.admin_ai_report() to authenticated;

-- The admin's AI figures, in plan_formula (5.18): a credit is ₹0.05 of model cost; OpenAI's
-- standard prices a million tokens in US dollars, [input, output] (developers.openai.com/api/docs/pricing,
-- read 27 Oct 2026), and the rupees a dollar (95.27, open.er-api.com, 27 Oct 2026), to turn what a
-- call used into credits; and for each reason the most credits it may take (5.18's table: an AI
-- reply 6) and the most tokens it may write, reasoning included. A reason not listed here is never
-- called. Added once; later values are the admin's.
update public.platform_settings set value = value || '{"ai": {"rupeesPerCredit": 0.05, "usdInr": 95.27,
  "prices": {"gpt-5-mini": [0.25, 2], "gpt-5-nano": [0.05, 0.4]},
  "reasons": {"reply_draft": {"credits": 6, "tokens": 1500, "effort": "low"}, "email_draft": {"credits": 6, "tokens": 1500, "effort": "low"}}}}'::jsonb
where key = 'plan_formula' and not value ? 'ai';
