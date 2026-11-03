-- The one time setup fee by plan, in rupees before GST (D5, business plan of 3 Nov 2026): the AI
-- cost of one month of the plan's credits, with GST and the payment fee, plus 20%. A Custom firm
-- pays Enterprise's rate for each of its credits (setupFee in src/lib/billing/money.ts).
update public.platform_settings set value = value || '{"setup": {"solo": 290, "growth": 730, "scale": 1750, "enterprise": 4370}}'::jsonb
where key = 'plan_formula';
