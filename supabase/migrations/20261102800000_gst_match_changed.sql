-- GSTR-2B's corrected bills and notes (b2ba, cdnra): a match now also counts, as 'changed', the
-- ones the books do not show corrected yet. Today's GSTR-2B items include a month with any;
-- a match made before has no 'changed' count. Otherwise as 20261102200000_frame_speed.sql.
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
    and (m.counts ->> 'missing')::int + (m.counts ->> 'extra')::int + (m.counts ->> 'differ')::int + coalesce((m.counts ->> 'changed')::int, 0) > 0
    and ((select public.member_role(target_firm)) in ('owner', 'partner') or d.client_id in (select public.my_clients(target_firm)))
  order by t.due_on
  limit 200
$$;
revoke all on function public.gst_match_items(uuid) from public, anon;
grant execute on function public.gst_match_items(uuid) to authenticated;
