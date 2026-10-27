-- PLAN.md 5.18, the AI credits migration's open points: a top-up lasts 12 months from when it is
-- bought, not only that month, and two runaway guards for automatic AI. Server only, as before.
drop function if exists public.ai_reserve(uuid, int, int, text, int, numeric, text);
drop function if exists public.ai_credits(uuid, int, int);

-- The firm's AI credits this India month and what is used: its plan's monthly credits with its AI
-- blocks (`monthly`, from plan_formula), what it left unused of last month's own credits, rolled
-- over for one month (so at most twice the allowance), and its top-ups (`block` credits each),
-- each good for 12 months from its payment. Credits are spent in that order: the month's own,
-- then rolled over, then top-ups oldest first. Worked out a day at a time from the month before
-- the firm's first top-up, so a top-up that ran out of time keeps what it had not given. `topups`
-- lists what is left of each live one and when it ends, oldest first.
create or replace function public.ai_credits(target_firm uuid, monthly int, block int)
returns table (available int, used int, topups jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  zone constant text := 'Asia/Kolkata';
  this_month constant timestamp := date_trunc('month', now() at time zone zone);
  made timestamp;
  bought timestamp[];
  balance int[];
  spending record;
  month timestamp;
  own int;
  spent int := 0;
  drawn int := 0;
  over int;
  take int;
  i int;
begin
  select f.created_at at time zone zone into made from public.firms f where f.id = target_firm;
  if made is null then return; end if;
  select coalesce(array_agg(p.created_at at time zone zone order by p.created_at), '{}'), coalesce(array_agg(block order by p.created_at), '{}') into bought, balance
  from public.payments p where p.firm_id = target_firm and p.kind = 'topup' and p.status = 'done';
  for spending in
    select date_trunc('day', l.at at time zone zone) as day, sum(l.credits)::int as credits from public.ai_ledger l
    where l.firm_id = target_firm and l.at >= (date_trunc('month', least(bought[1], this_month)) - interval '1 month') at time zone zone
    group by 1 order by 1
  loop
    if month is distinct from date_trunc('month', spending.day) then
      own := monthly + case when made < date_trunc('month', spending.day) then greatest(monthly - case when month = date_trunc('month', spending.day) - interval '1 month' then spent else 0 end, 0) else 0 end;
      month := date_trunc('month', spending.day);
      spent := 0;
      drawn := 0;
    end if;
    over := greatest(spent + spending.credits - own, 0) - greatest(spent - own, 0);
    spent := spent + spending.credits;
    i := 1;
    while over > 0 and i <= cardinality(bought) loop
      if bought[i] < spending.day + interval '1 day' and bought[i] + interval '12 months' > spending.day then
        take := least(balance[i], over);
        balance[i] := balance[i] - take;
        over := over - take;
        drawn := drawn + take;
      end if;
      i := i + 1;
    end loop;
  end loop;
  if month is distinct from this_month then
    own := monthly + case when made < this_month then greatest(monthly - case when month = this_month - interval '1 month' then spent else 0 end, 0) else 0 end;
    spent := 0;
    drawn := 0;
  end if;
  return query select (own + drawn + coalesce(sum(t.credits), 0))::int, spent,
    coalesce(jsonb_agg(jsonb_build_object('left', t.credits, 'until', (t.bought_at + interval '12 months') at time zone zone) order by t.bought_at), '[]')
  from unnest(bought, balance) t(bought_at, credits)
  where t.credits > 0 and t.bought_at + interval '12 months' > now() at time zone zone;
end;
$$;

-- Reserves `want` credits for one AI call, or none: one reservation at a time for a firm, and only
-- while its use this month stays within `share` of its credits (1, or 0.9 for automatic work,
-- which pauses at 90%). Automatic work also pauses for the rest of the India day (`paused`) once
-- the firm has used more than `day_share` of its monthly credits today (5.18: 20%), or once the
-- settled cost of all firms' AI today reaches `cap` rupees (AI_GLOBAL_DAILY_CAP_USD); a person's
-- own press passes neither. Returns the reservation (null when refused), whether the firm already
-- sent the same thing to AI this month, and the month's credits and use after it. Server only.
create or replace function public.ai_reserve(target_firm uuid, monthly int, block int, why text, want int, share numeric, digest text, day_share numeric default null, cap numeric default null)
returns table (ticket bigint, again boolean, available int, used int, paused text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  credit record;
  made bigint;
  since timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_ledger:' || target_firm, 0));
  select c.available, c.used into credit from public.ai_credits(target_firm, monthly, block) c;
  if credit.available is null or want < 1 or credit.used + want > credit.available * share then
    return query select null::bigint, false, credit.available, credit.used, null::text;
    return;
  end if;
  if day_share is not null and (select coalesce(sum(l.credits), 0) from public.ai_ledger l where l.firm_id = target_firm and l.at >= today) > day_share * monthly then
    return query select null::bigint, false, credit.available, credit.used, 'firm';
    return;
  end if;
  if cap is not null and (select coalesce(sum(l.cost), 0) from public.ai_ledger l where l.at >= today) >= cap then
    return query select null::bigint, false, credit.available, credit.used, 'platform';
    return;
  end if;
  insert into public.ai_ledger (firm_id, reason, credits, hash) values (target_firm, why, want, digest) returning id into made;
  return query select made, exists (select 1 from public.ai_ledger e where e.firm_id = target_firm and e.at >= since and e.hash = digest and e.credits > 0 and e.id <> made),
    credit.available, credit.used + want, null::text;
end;
$$;
revoke all on function public.ai_credits(uuid, int, int), public.ai_reserve(uuid, int, int, text, int, numeric, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.ai_credits(uuid, int, int), public.ai_reserve(uuid, int, int, text, int, numeric, text, numeric, numeric) to service_role;

-- The day's cost across firms, for the Orelu-wide cap.
create index if not exists ai_ledger_at on public.ai_ledger (at);
