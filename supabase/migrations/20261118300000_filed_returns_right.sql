-- A return marked filed is changed (filed no more, or what marking it filed recorded) only by
-- someone with the Mark returns filed right, as marking it filed is. Before, the policy checked
-- only the new row, so anyone without the right could set a filed return back (security audit).
alter policy tasks_filing_right on public.tasks
  using (status <> 'filed' or client_id in (select public.clients_with_right('mark_filed')));
