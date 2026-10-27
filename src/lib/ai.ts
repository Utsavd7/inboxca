import { createHmac } from "node:crypto";
import { z } from "zod";
import { alertAdmins } from "./billing/billing";
import { formulaSchema, planPrice, planSchema, type Cycle } from "./billing/money";
import { todayInIndia } from "./calendar";
import { log } from "./logger";
import { supabaseAdmin } from "./supabase";

// Paid AI stays off until an AI key is added to the server (PLAN.md D29, M9): with no key
// nothing is called and nothing is billed, and the buttons that need it say so.
export const aiReady = () => !!process.env.OPENAI_API_KEY;

export type AiReason = "reply_draft" | "email_draft";
// From 90% of the month's credits automatic work pauses, keeping the last 10% for sorting emails
// and notices and for what a person starts (5.18): automatic extraction and AI-written reminders
// are true here. At 100% all AI stops. A reason also needs its credits and tokens in
// plan_formula.ai.reasons, or it is never called.
const stopsAt90: Record<AiReason, boolean> = { reply_draft: false, email_draft: false };

// The admin's AI figures in plan_formula (5.18): what a credit is worth in rupees, the provider's
// dollar prices a million tokens [input, output] by model, the rupees a dollar, and for each
// reason the most credits it may take, the most tokens it may write and its reasoning effort.
const figuresSchema = z.object({
  rupeesPerCredit: z.number().positive(),
  usdInr: z.number().positive(),
  prices: z.record(z.string(), z.tuple([z.number().nonnegative(), z.number().nonnegative()])),
  reasons: z.record(z.string(), z.object({ credits: z.number().int().positive(), tokens: z.number().int().positive(), effort: z.enum(["minimal", "low", "medium", "high"]).optional() })),
});
type Admin = ReturnType<typeof supabaseAdmin>;

// The firm's monthly AI credits: its plan's with the AI blocks it pays for, or the smallest
// plan's before one is paid (as for downloads); null when the admin has not set the figures.
async function planOf(admin: Admin, firmId: string) {
  const [{ data: setting }, { data: sub }] = await Promise.all([
    admin.from("platform_settings").select("value").eq("key", "plan_formula").maybeSingle(),
    admin.from("subscriptions").select("plan, cycle").eq("firm_id", firmId).maybeSingle(),
  ]);
  const formula = formulaSchema.safeParse(setting?.value);
  const figures = figuresSchema.safeParse((setting?.value as { ai?: unknown } | undefined)?.ai);
  if (!formula.success || !figures.success) return null;
  const plan = planSchema.safeParse(sub?.plan);
  const monthly = plan.success ? planPrice(formula.data, plan.data, sub!.cycle as Cycle).aiCredits + plan.data.aiBlocks * formula.data.aiBlock.credits : formula.data.plans[0].aiCredits;
  return { monthly, block: formula.data.aiBlock.credits, figures: figures.data };
}

// This India month's AI credits (plan, rollover and top-ups) and what is used, for the owner.
export async function aiCredits(firmId: string) {
  const admin = supabaseAdmin();
  const plan = await planOf(admin, firmId);
  if (!plan) return null;
  const { data, error } = await admin.rpc("ai_credits", { target_firm: firmId, monthly: plan.monthly, block: plan.block });
  return error ? null : (data?.[0] ?? null);
}

// The cache (D29): an answer kept in this server's memory for a day, under a hash keyed by the
// server and made with the firm's id, so one firm's answer is never another's. The database keeps
// only the hash.
const DAY = 86_400_000;
const cache = new Map<string, { text: string; until: number }>();
const hashOf = (firmId: string, reason: string, instructions: string, input: string) =>
  createHmac("sha256", createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "").update("ai cache").digest()).update([firmId, reason, instructions, input].join("\n")).digest("base64url").slice(0, 22);
const base = () => (process.env.MAIL_ALLOW_LOCAL === "1" && process.env.OPENAI_TEST_URL ? process.env.OPENAI_TEST_URL : "https://api.openai.com");
type Usage = { input_tokens: number; output_tokens: number };
type Answer = { usage?: Usage; output?: { content?: { type: string; text?: string }[] }[] };

// The one place the app calls the AI provider. Every call names its firm and reason: an answer in
// the cache costs nothing; otherwise the most the call may take is reserved first, and with no
// reservation (credits used, automatic work past 90%, a reason with no figures) nothing is called
// and the answer is null, so the caller falls back to rules or templates. After the call the
// reservation settles to what the provider reported, never above it; a call that fails costs
// nothing. The owner is told at 80% and 100%, auto top-up runs from 90%, and Orelu's admins are
// told when a firm sends the same thing to AI twice. The provider keeps nothing (store off). What
// comes back is only a suggestion a person reviews; AI never sends.
export async function askAi(firmId: string, reason: AiReason, instructions: string, input: string) {
  if (!aiReady()) return null;
  const admin = supabaseAdmin();
  const hash = hashOf(firmId, reason, instructions, input);
  const kept = cache.get(hash);
  if (kept && kept.until > Date.now()) {
    await admin.from("ai_ledger").insert({ firm_id: firmId, reason, credits: 0, cost: 0, hash });
    return kept.text;
  }
  const plan = await planOf(admin, firmId);
  const rule = plan?.figures.reasons[reason];
  if (!plan || !rule) {
    log.warn("ai.no_figures", { reason });
    return null;
  }
  const share = stopsAt90[reason] === false ? 1 : 0.9;
  const { data, error } = await admin.rpc("ai_reserve", { target_firm: firmId, monthly: plan.monthly, block: plan.block, why: reason, want: rule.credits, share, digest: hash });
  const held = data?.[0];
  if (error || !held) {
    log.warn("ai.not_reserved", { code: error?.code });
    return null;
  }
  const month = todayInIndia().slice(0, 7);
  // Once a month for each figure of credits, so a top-up paid can be told about again.
  const queue = (kind: string, key: string) => admin.from("jobs").upsert({ firm_id: firmId, kind, entity_type: "firm", entity_id: firmId, idempotency_key: `${key}:${firmId}:${month}:${held.available}` }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  const stage = !held.ticket && held.used + rule.credits > held.available ? "ai_100" : held.used >= 0.8 * held.available ? "ai_80" : null;
  if (stage) await queue("usage_alert", `usage_alert:${stage}`);
  if (!held.ticket || held.used >= 0.9 * held.available) await queue("ai_topup", "ai_topup");
  if (!held.ticket) return null;
  if (held.again) await alertAdmins(admin, "ai_repeated", firmId);

  const model = process.env.AI_AGENT_MODEL || "gpt-5-mini";
  const response = await fetch(`${base()}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions, input, store: false, max_output_tokens: rule.tokens, ...(rule.effort && { reasoning: { effort: rule.effort } }), metadata: { reason } }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  const answer = response?.ok ? ((await response.json().catch(() => null)) as Answer | null) : null;
  const usage = answer?.usage;
  if (!usage) {
    await admin.from("ai_ledger").delete().eq("id", held.ticket);
    return null;
  }
  const price = plan.figures.prices[model];
  const cost = price ? ((usage.input_tokens * price[0] + usage.output_tokens * price[1]) / 1e6) * plan.figures.usdInr : null;
  const credits = cost === null ? rule.credits : Math.min(rule.credits, Math.max(1, Math.ceil(cost / plan.figures.rupeesPerCredit - 1e-9)));
  await admin.from("ai_ledger").update({ credits, cost }).eq("id", held.ticket);
  const text = answer.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text ?? null;
  if (text) {
    cache.set(hash, { text, until: Date.now() + DAY });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  return text;
}
