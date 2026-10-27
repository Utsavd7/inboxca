-- M11 (PLAN.md 5.14, D38 (1)): a monthly payer switches to yearly payment with one payment, the
-- yearly price for the rest of the April to March year less what is left of the month paid; the
-- cycle changes when it is paid.
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check
  check (kind in ('plan', 'renewal', 'upgrade', 'yearly', 'extra_user', 'ai_block', 'topup', 'setup', 'refund'));
-- A plan change paid after the plan, cycle or paid period it was priced on changed (two checkouts
-- paid out of order) is not applied, and goes back in full with this reason.
alter table public.payments drop constraint if exists payments_reason_check;
alter table public.payments add constraint payments_reason_check
  check (reason in ('money_back', 'duplicate', 'charge_error', 'priced_on_old_plan'));
