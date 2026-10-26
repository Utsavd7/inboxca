-- GSTR-2B against the purchase register (PLAN.md "Less work for the firm", 26 Oct 2026): the
-- client's purchase register is read with the columns a person confirmed, remembered for the
-- client as the sales register's are, and matched invoice by invoice with the month's GSTR-2B.
-- InboxCA only lists the differences: the CA decides what to claim, and no GSTR-3B figure changes.
alter table public.clients add column if not exists purchase_mapping_enc text;

-- One match for each purchase register paper, with the GSTR-2B it was matched against. The
-- lists name suppliers' GSTINs and invoices, so they are sealed with the firm's key; the four
-- counts stay plain, so Today can find the months with differences without opening each list.
create table if not exists public.gst_matches (
  firm_id uuid not null,
  register_id uuid primary key,
  statement_id uuid not null,
  counts jsonb not null check (jsonb_typeof(counts) = 'object' and counts ?& array['matched', 'missing', 'extra', 'differ']),
  result_enc text not null,
  constraint gst_matches_register_fkey foreign key (firm_id, register_id) references public.documents (firm_id, id) on delete cascade,
  constraint gst_matches_statement_fkey foreign key (firm_id, statement_id) references public.documents (firm_id, id) on delete cascade
);
create index if not exists gst_matches_statement on public.gst_matches (firm_id, statement_id);
alter table public.gst_matches enable row level security;
revoke all on public.gst_matches from anon, authenticated;
grant select on public.gst_matches to authenticated;
-- Written by the server only. A match is seen by whoever sees its purchase register.
drop policy if exists gst_matches_select on public.gst_matches;
create policy gst_matches_select on public.gst_matches for select to authenticated
  using (exists (select 1 from public.documents d where d.firm_id = gst_matches.firm_id and d.id = gst_matches.register_id));

-- Today's GSTR-2B items for this person, on the clients they look after: a month whose current
-- purchase register differs from its current GSTR-2B, while that month's GSTR-3B (monthly, or
-- the quarter's under QRMP) is still to be filed, with its due date. Read as the person.
create or replace function public.gst_match_items(target_firm uuid)
returns table (register_id uuid, client_id uuid, client_name text, period_key text, due_on date, counts jsonb)
language sql stable set search_path = '' as $$
  select m.register_id, d.client_id, c.name, d.period_key, t.due_on, m.counts
  from public.gst_matches m
  join public.documents d on d.firm_id = m.firm_id and d.id = m.register_id and d.status = 'filed'
  join public.documents s on s.firm_id = m.firm_id and s.id = m.statement_id and s.status = 'filed'
  join public.clients c on c.firm_id = d.firm_id and c.id = d.client_id and c.archived_at is null
  cross join lateral (
    select min(t.due_on) due_on from public.tasks t
    where t.firm_id = d.firm_id and t.client_id = d.client_id and t.kind = 'compliance' and t.status <> 'filed'
      and (d.registration_id is null or t.registration_id = d.registration_id)
      and (t.code = 'GSTR3B_M' and t.period_key = d.period_key
        or t.code = 'GSTR3B_Q' and t.period_key = to_char(date_trunc('quarter', to_date(d.period_key, 'YYYY-MM')) + interval '2 months', 'YYYY-MM'))
  ) t
  where m.firm_id = target_firm and t.due_on is not null and d.period_key ~ '^\d{4}-\d{2}$'
    and (m.counts ->> 'missing')::int + (m.counts ->> 'extra')::int + (m.counts ->> 'differ')::int > 0
    and public.looks_after(target_firm, d.client_id)
  order by t.due_on
  limit 200
$$;
revoke all on function public.gst_match_items(uuid) from public, anon;
grant execute on function public.gst_match_items(uuid) to authenticated;
