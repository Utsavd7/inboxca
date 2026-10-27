import { randomUUID } from "node:crypto";
import { states } from "@/app/(auth)/sign-up/states";
import type { Database, Json } from "@/src/db/types";
import { serverCrypto } from "@/src/lib/crypto";
import { log } from "@/src/lib/logger";
import { supabaseAdmin } from "@/src/lib/supabase";
import { sendSystemMail } from "@/src/lib/system-mail";
import { docText, docTitles, taxLines, type Doc } from "./documents";
import {
  addDays, daysBetween, formulaSchema, gstOn, indiaDay, mandateMax, methodsFor, moneyBackLastDay, overdueState, periodEnd, planPrice, prorate,
  RETRY_DAYS, rupees, serialNumber, taxSchema, withGst, type Cycle, type DocKind, type FirmPlan, type Method, type PlanFormula, type Tax,
} from "./money";
import { billingProvider, type BillingEvent, type Checkout, type PaymentProvider } from "./provider";

// Orelu's billing of firms, end to end (PLAN.md 5.14.1): AutoPay at sign up, renewals with
// Orelu's own notice, retries, the move to read only, plan changes, add-ons paid first,
// receipts and invoices, the money-back guarantee, refunds and the daily reconciliation. Every
// write here uses the server's access, because webhooks and jobs have no person signed in and
// a firm's own people may not change what they pay; each one names the firm it is for and is
// logged in activity_log. Amounts come from plan_formula and the tax settings only.

type Admin = ReturnType<typeof supabaseAdmin>;
type Payment = Database["public"]["Tables"]["payments"]["Row"];
type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];
// The firm's plan, its add-ons, the mandate's maximum, a downgrade waiting for the renewal, a
// new mandate waiting for the owner's approval and the owner's auto top-up limit (blocks a month).
export type SubPlan = FirmPlan & { version: number; maxPaise: number; next?: FirmPlan; pending?: string; pendingMax?: number; autoTopUp?: number };
// What a payment buys: its lines before GST, how it is paid (taken at the mandate's
// authorisation, debited on it, or a one time order), the period it pays for and the plan or
// add-on it brings.
// `base`: the team the plan took when one more person was bought (its own people, or the more
// the plan includes).
export type Details = { lines: { text: string; paise: number }[]; via: "auth" | "charge" | "order"; mandate?: string; period?: [string, string]; plan?: FirmPlan; add?: number; base?: number; setupPaise?: number };
export type Alert = { kind: string; ref?: string; at: string };

const json = (value: unknown) => value as NonNullable<Json>;
const planOf = (sub: Subscription) => sub.plan as unknown as SubPlan;
const detailsOf = (payment: Payment) => payment.details as unknown as Details;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mandateId = /^[A-Za-z0-9_-]{1,60}$/;
const long = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
export const span = ([from, until]: [string, string]) => `${long(from)} to ${long(addDays(until, -1))}`;
export const methodWords: Record<Method, string> = { upi: "UPI AutoPay", card: "card AutoPay", enach: "bank mandate (eNACH)" };
const stateName = (code?: string) => states.find(([state]) => state === code)?.[1];
const link = (path: string) => `${process.env.APP_BASE_URL ?? ""}${path}`;
const BILLING = "/app/settings?group=billing";
// Cashfree needs 25 hours between its pre-debit notice and the debit (Subscriptions FAQ); an
// hour more for the clock.
const NOTICE_MS = 26 * 3_600_000;

type Action = "billing.autopay_started" | "billing.autopay_on" | "billing.autopay_cancelled" | "billing.order_started" | "billing.paid" | "billing.payment_failed"
  | "billing.renewal_raised" | "billing.downgrade_set" | "billing.money_back" | "billing.refund_asked" | "billing.refunded" | "billing.refund_failed" | "billing.state" | "billing.auto_topup";
type Noted = { method?: string; cycle?: string; by?: string; payment?: string; kind?: string; reason?: string; status?: string; payments?: string[]; blocks?: number };
async function note(admin: Admin, firmId: string, actor: string | null, action: Action, details: Noted = {}) {
  await admin.from("activity_log").insert({ firm_id: firmId, actor_id: actor, action, entity_type: "firm", entity_id: firmId, details });
}

export async function billingSettings(admin: Admin = supabaseAdmin()) {
  const { data } = await admin.from("platform_settings").select("key, value").in("key", ["plan_formula", "tax", "billing"]);
  const value = (key: string) => data?.find((row) => row.key === key)?.value;
  const formula = formulaSchema.safeParse(value("plan_formula"));
  const tax = taxSchema.safeParse(value("tax"));
  return { formula: formula.success ? formula.data : null, tax: tax.success ? tax.data : null, alerts: ((value("billing") as { alerts?: Alert[] } | undefined)?.alerts ?? []) };
}

async function firmOf(admin: Admin, firmId: string) {
  const { data } = await admin.from("firms").select("id, name, gstin, state_code, status, settings").eq("id", firmId).maybeSingle();
  if (!data) return null;
  return { ...data, stateCode: data.gstin?.slice(0, 2) ?? data.state_code ?? "", address: String((data.settings as Record<string, unknown>).billing_address ?? "") };
}

async function ownerOf(admin: Admin, firmId: string) {
  const { data } = await admin.from("firm_members").select("user_id").eq("firm_id", firmId).eq("role", "owner").eq("status", "active").limit(1).maybeSingle();
  return data ? ((await admin.auth.admin.getUserById(data.user_id)).data.user?.email ?? null) : null;
}

const mail = async (to: string | null, subject: string, lines: string[]) => {
  if (to) await sendSystemMail(to, subject, [...lines, "Orelu, the team behind InboxCA"].join("\n\n")).catch(() => log.warn("billing.mail_failed"));
};

// Something an Orelu admin must look at: kept for the console (the latest 50) and emailed.
export async function alertAdmins(admin: Admin, kind: string, ref?: string) {
  const { alerts } = await billingSettings(admin);
  if (alerts.some((alert) => alert.kind === kind && alert.ref === ref)) return;
  await admin.from("platform_settings").upsert({ key: "billing", value: json({ alerts: [{ kind, ref, at: new Date().toISOString() }, ...alerts].slice(0, 50) }) });
  const { data: admins } = await admin.from("orelu_admins").select("user_id");
  for (const { user_id } of admins ?? [])
    await mail((await admin.auth.admin.getUserById(user_id)).data.user?.email ?? null, "InboxCA billing needs a look", [`Billing raised "${kind}". Open the admin console, Billing, to see it.`]);
}

// The price of a plan and what is debited for it, with GST from the start date; the first
// payment also carries the setup fee where the formula sets one.
export function quote(formula: PlanFormula, tax: Tax | null, stateCode: string, plan: FirmPlan, cycle: Cycle, day: string, first = false) {
  const price = planPrice(formula, plan, cycle);
  const setupPaise = first ? (formula.setup[price.code] ?? 0) * 100 : 0;
  const recurring = withGst(price.paise, tax, stateCode, day);
  return { price, setupPaise, recurring, first: withGst(price.paise + setupPaise, tax, stateCode, day), methods: methodsFor(recurring.total) };
}

const withPeriod = (lines: Details["lines"], period: [string, string]) => lines.map((line, at) => (at ? line : { ...line, text: `${line.text}, ${span(period)}` }));

// The owner's AutoPay: at sign up with the plan chosen, or again after it was cancelled. What
// is due is taken at authorisation (UPI AutoPay, card) or debited once the bank confirms the
// mandate (eNACH): the first payment, or a renewal already due.
export type Start = { plan?: FirmPlan; cycle?: Cycle; method: Method; phone?: string; address?: string; gstin?: string; returnUrl: string };
export async function startAutoPay(firmId: string, actor: string, input: Start): Promise<Checkout | { error: string }> {
  const provider = billingProvider();
  if (!provider) return { error: "Payments are not set up yet." };
  const admin = supabaseAdmin();
  const { formula, tax } = await billingSettings(admin);
  if (!formula) return { error: "Prices are not set up yet. Try again later." };
  const { data: sub } = await admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle();
  if (sub?.status === "active") return { error: "AutoPay is already on." };
  const plan = input.plan ?? (sub && planOf(sub));
  const cycle = input.cycle ?? (sub?.cycle as Cycle | undefined);
  const phone = input.phone ?? (sub?.phone_enc ? await serverCrypto().decrypt(firmId, `subscriptions/${firmId}/phone`, sub.phone_enc) : "");
  if (!plan || !cycle || !/^[6-9][0-9]{9}$/.test(phone)) return { error: "Enter your plan and a 10 digit mobile number." };
  const firm = (await firmOf(admin, firmId))!;
  const email = await ownerOf(admin, firmId);
  if (!email) return { error: "Only the owner sets up AutoPay." };
  const today = indiaDay(new Date());
  const { data: paid } = await admin.from("payments").select("id").eq("firm_id", firmId).eq("kind", "plan").eq("status", "done").limit(1).maybeSingle();
  // A GSTIN names the firm's state, which decides CGST and SGST or IGST.
  const priced = quote(formula, tax, input.gstin?.slice(0, 2) ?? firm.stateCode, plan, cycle, today, !paid);
  if (!priced.methods.some(({ method }) => method === input.method)) return { error: "Choose one of the ways to pay shown." };
  const maxPaise = mandateMax(priced.price.paise, input.method);
  if (priced.recurring.total > maxPaise) return { error: "This amount is above what UPI AutoPay allows. Choose the bank mandate." };
  if (input.address !== undefined || input.gstin) {
    const settings = { ...(firm.settings as Record<string, unknown>), ...(input.address !== undefined && { billing_address: input.address }) };
    const { error } = await admin.from("firms").update({ settings: json(settings), ...(input.gstin && input.gstin !== firm.gstin && { gstin: input.gstin, state_code: null }) }).eq("id", firmId);
    if (error) return { error: error.code === "23505" ? "This GSTIN is already used by another firm on InboxCA." : "Your firm's details could not be saved. Try again." };
  }
  const mandate = `ib-${randomUUID().replaceAll("-", "")}`;
  // Nothing is due while a plan is paid ahead; an earlier checkout left unfinished is dropped.
  const due = !paid ? "plan" : !sub?.paid_until || sub.paid_until <= addDays(today, 3) ? "renewal" : null;
  const period: [string, string] | undefined = due === "renewal" && sub?.paid_until ? [sub.paid_until, periodEnd(sub.paid_until, cycle)] : undefined;
  const amount = due === "plan" ? priced.first : priced.recurring;
  await admin.from("payments").update({ status: "cancelled" }).eq("firm_id", firmId).eq("status", "created").not("details->>mandate", "is", null);
  await admin.from("subscriptions").upsert({
    firm_id: firmId, mandate, cycle, method: input.method, status: "created", paid_until: sub?.paid_until ?? null,
    phone_enc: await serverCrypto().encrypt(firmId, `subscriptions/${firmId}/phone`, phone),
    plan: json({ ...(sub && planOf(sub)), ...plan, pending: undefined, pendingMax: undefined, version: formula.version, maxPaise }),
  });
  if (due) {
    const lines = [...priced.price.lines, ...(due === "plan" && priced.setupPaise ? [{ text: "One time setup of InboxCA for your firm", paise: priced.setupPaise }] : [])];
    const { error } = await admin.from("payments").insert({
      firm_id: firmId, kind: due, amount_paise: amount.total, gst_paise: amount.gst,
      details: json({ lines: period ? withPeriod(lines, period) : lines, via: input.method === "enach" ? "charge" : "auth", mandate, period, plan, setupPaise: priced.setupPaise || undefined } satisfies Details),
    });
    if (error) throw new Error(`Saving the first payment failed: ${error.code}`);
  }
  const checkout = await provider.mandate({ id: mandate, customer: provider.customer({ name: firm.name, email, phone }), maxPaise, firstPaise: due ? amount.total : 0, method: input.method, returnUrl: input.returnUrl });
  await note(admin, firmId, actor, "billing.autopay_started", { method: input.method, cycle });
  return checkout;
}

// A new mandate with a higher maximum, for a plan that has grown past the old one: the owner
// approves it once in checkout, and it replaces the old mandate when the bank confirms it.
export async function approveLimit(firmId: string, actor: string, returnUrl: string): Promise<Checkout | { error: string }> {
  const provider = billingProvider();
  const admin = supabaseAdmin();
  const [{ formula, tax }, { data: sub }, firm, email] = await Promise.all([billingSettings(admin), admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle(), firmOf(admin, firmId), ownerOf(admin, firmId)]);
  if (!provider || !formula || !sub?.method || !sub.phone_enc || !firm || !email) return { error: "AutoPay is not on for this firm." };
  const plan = planOf(sub);
  const priced = quote(formula, tax, firm.stateCode, plan.next ?? plan, sub.cycle as Cycle, indiaDay(new Date()));
  const method = priced.methods.some(({ method }) => method === sub.method) ? (sub.method as Method) : priced.methods[0].method;
  const maxPaise = mandateMax(priced.price.paise, method);
  const mandate = `ib-${randomUUID().replaceAll("-", "")}`;
  await admin.from("subscriptions").update({ plan: json({ ...plan, pending: mandate, pendingMax: maxPaise }) }).eq("firm_id", firmId);
  const phone = await serverCrypto().decrypt(firmId, `subscriptions/${firmId}/phone`, sub.phone_enc);
  const checkout = await provider.mandate({ id: mandate, customer: provider.customer({ name: firm.name, email, phone }), maxPaise, firstPaise: 0, method, returnUrl });
  await note(admin, firmId, actor, "billing.autopay_started", { method, cycle: sub.cycle });
  return checkout;
}

// One time payments, paid before anything is added (5.14.1): an overdue renewal paid now, an
// upgrade's difference for the rest of the paid period, one more person, one more AI block a
// month, or a one time AI top-up.
export type Buy = { kind: "renewal" } | { kind: "upgrade"; plan: FirmPlan } | { kind: "extra_user" } | { kind: "ai_block" } | { kind: "topup" };
export async function buy(firmId: string, actor: string, what: Buy, returnUrl: string): Promise<Checkout | { error: string }> {
  const provider = billingProvider();
  const admin = supabaseAdmin();
  const [{ formula, tax }, { data: sub }, firm, email] = await Promise.all([billingSettings(admin), admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle(), firmOf(admin, firmId), ownerOf(admin, firmId)]);
  if (!provider || !formula || !sub?.paid_until || !sub.phone_enc || !firm || !email) return { error: "Set up AutoPay first." };
  const today = indiaDay(new Date());
  const cycle = sub.cycle as Cycle;
  const plan = planOf(sub);
  const current = planPrice(formula, plan, cycle);
  let lines: Details["lines"];
  let details: Partial<Details> = {};
  if (what.kind === "renewal") {
    if (sub.paid_until > addDays(today, 3)) return { error: "Your plan is paid until then already." };
    const period: [string, string] = [sub.paid_until, periodEnd(sub.paid_until, cycle)];
    lines = withPeriod(planPrice(formula, plan.next ?? plan, cycle).lines, period);
    details = { period, plan: plan.next ?? plan };
  } else if (what.kind === "topup") {
    if (await blocksThisMonth(admin, firmId, plan, today) >= current.blockCap) return { error: "Your plan has all the extra AI it can take this month. Move to a bigger plan for more." };
    lines = [{ text: `AI top-up of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits for this month`, paise: formula.aiBlock.price * 100 }];
    details = { add: 1 };
  } else {
    if (sub.paid_until <= today) return { error: "Pay for your plan first." };
    const team = Math.max(plan.people, current.people);
    const next = what.kind === "upgrade" ? what.plan : what.kind === "extra_user" ? { ...plan, people: team + 1 } : { ...plan, aiBlocks: (plan.aiBlocks ?? 0) + 1 };
    if (what.kind === "ai_block" && (await blocksThisMonth(admin, firmId, plan, today)) >= current.blockCap) return { error: "Your plan has all the extra AI it can take. Move to a bigger plan for more." };
    const moved = planPrice(formula, next, cycle);
    if (moved.paise <= current.paise) return { error: "That is not more than your plan now. Choose it as a change at renewal." };
    const until = addDays(sub.paid_until, -1);
    const words = what.kind === "upgrade" ? `Move to the ${moved.name} plan` : what.kind === "extra_user" ? "One more person in the team" : `One more AI block of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits a month`;
    lines = [{ text: `${words}, ${long(today)} to ${long(until)}`, paise: prorate(moved.paise - current.paise, today, sub.paid_until, cycle) }];
    details = what.kind === "upgrade" ? { plan: what.plan } : what.kind === "extra_user" ? { add: 1, base: team } : { add: 1 };
    if (!lines[0].paise) return { error: "Your plan renews today. Make the change at renewal." };
  }
  const amount = withGst(lines.reduce((sum, line) => sum + line.paise, 0), tax, firm.stateCode, today);
  const { data: row, error } = await admin.from("payments").insert({ firm_id: firmId, kind: what.kind, amount_paise: amount.total, gst_paise: amount.gst, details: json({ ...details, lines, via: "order" } satisfies Details) }).select("id").single();
  if (error) throw new Error(`Saving the order failed: ${error.code}`);
  const phone = await serverCrypto().decrypt(firmId, `subscriptions/${firmId}/phone`, sub.phone_enc);
  const checkout = await provider.order({ id: row.id, customer: { ...provider.customer({ name: firm.name, email, phone }), id: firmId.replaceAll("-", "") }, paise: amount.total, returnUrl, note: lines[0].text });
  await note(admin, firmId, actor, "billing.order_started", { payment: row.id, kind: what.kind });
  return checkout;
}

// AI blocks a month and one time top-ups count together against the plan's cap (5.14).
async function blocksThisMonth(admin: Admin, firmId: string, plan: SubPlan, today: string) {
  const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("firm_id", firmId).eq("kind", "topup").eq("status", "done").gte("created_at", `${today.slice(0, 8)}01T00:00:00+05:30`);
  return (plan.aiBlocks ?? 0) + (count ?? 0);
}

// Auto top-up (off by default): one top-up block debited on the mandate after the pre-debit
// notice, never above the owner's monthly limit or the plan's cap. The AI credit meter calls it
// at 90% once AI credits are metered (5.18).
export async function autoTopUp(firmId: string) {
  const provider = billingProvider();
  const admin = supabaseAdmin();
  const [{ formula, tax }, { data: sub }, firm] = await Promise.all([billingSettings(admin), admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle(), firmOf(admin, firmId)]);
  if (!provider || !formula || !firm || sub?.status !== "active" || !sub.mandate) return false;
  const plan = planOf(sub);
  const today = indiaDay(new Date());
  const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("firm_id", firmId).eq("kind", "topup").in("status", ["created", "done"]).gte("created_at", `${today.slice(0, 8)}01T00:00:00+05:30`);
  if ((count ?? 0) >= (plan.autoTopUp ?? 0) || (plan.aiBlocks ?? 0) + (count ?? 0) >= planPrice(formula, plan, sub.cycle as Cycle).blockCap) return false;
  const lines = [{ text: `AI top-up of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits for this month`, paise: formula.aiBlock.price * 100 }];
  const amount = withGst(lines[0].paise, tax, firm.stateCode, today);
  if (amount.total > plan.maxPaise) return false;
  const at = new Date(Date.now() + NOTICE_MS);
  const { data: row } = await admin.from("payments").insert({ firm_id: firmId, kind: "topup", amount_paise: amount.total, gst_paise: amount.gst, due_at: at.toISOString(), details: json({ lines, via: "charge", add: 1 } satisfies Details) }).select("id").single();
  if (!row) return false;
  await provider.charge({ mandate: sub.mandate, id: row.id, paise: amount.total, at, note: "InboxCA AI top-up" });
  await note(admin, firmId, null, "billing.auto_topup", { payment: row.id, blocks: 1 });
  await mail(await ownerOf(admin, firmId), "InboxCA: an AI top-up is on its way", [`Your firm used 90% of its AI credits, so InboxCA will take ${rupees(amount.total)} from your ${methodWords[sub.method as Method]} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })} for ${formula.aiBlock.credits.toLocaleString("en-IN")} more credits this month.`, `Turn auto top-up off in Settings, Billing: ${link(BILLING)}`]);
  return true;
}

// The owner turns AutoPay off (also from the bank or UPI app, which arrives as a webhook): the
// next debit is not taken and the plan runs to the end of what is paid.
export async function stopAutoPay(firmId: string, actor: string | null, by: "owner" | "bank" | "money_back" | "closed" = "owner") {
  const admin = supabaseAdmin();
  const { data: sub } = await admin.from("subscriptions").update({ status: "cancelled" }).eq("firm_id", firmId).neq("status", "cancelled").select("*").maybeSingle();
  if (!sub) return false;
  const { data: open } = await admin.from("payments").update({ status: "cancelled" }).eq("firm_id", firmId).eq("status", "created").neq("kind", "refund").select("id, details");
  const provider = billingProvider();
  if (provider && sub.mandate && by !== "bank") {
    for (const payment of open ?? []) if (detailsOf(payment as Payment).via === "charge") await provider.cancelCharge({ mandate: sub.mandate, id: payment.id }).catch(() => log.warn("billing.charge_cancel_failed"));
    await provider.cancelMandate(sub.mandate).catch(() => alertAdmins(admin, "mandate_cancel_failed", firmId));
  }
  await note(admin, firmId, actor, "billing.autopay_cancelled", { by });
  if (by === "owner" || by === "bank")
    await mail(await ownerOf(admin, firmId), "InboxCA: AutoPay is off", [`AutoPay for your InboxCA plan is off${by === "bank" ? ", as you cancelled it in your bank or UPI app" : ""}. Nothing more will be taken.`, sub.paid_until ? `Your plan is paid until ${long(addDays(sub.paid_until, -1))}. To keep InboxCA after that, turn AutoPay on again in Settings, Billing: ${link(BILLING)}` : `Turn it on again in Settings, Billing: ${link(BILLING)}`]);
  return true;
}

// A smaller plan, from the next renewal (5.14.1 Plan changes); never below the people active now.
export async function setDowngrade(firmId: string, actor: string, plan: FirmPlan | null) {
  const admin = supabaseAdmin();
  const { data: sub } = await admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle();
  if (!sub) return "Set up AutoPay first.";
  if (plan) {
    const { count } = await admin.from("firm_members").select("user_id", { count: "exact", head: true }).eq("firm_id", firmId).in("status", ["active", "invited"]);
    if (plan.people < (count ?? 1)) return `Your firm has ${count} people. Remove people in People first, or keep a team of ${count}.`;
  }
  const rest = { ...planOf(sub), next: undefined };
  await admin.from("subscriptions").update({ plan: json(plan ? { ...rest, next: plan } : rest) }).eq("firm_id", firmId);
  await note(admin, firmId, actor, "billing.downgrade_set");
  return null;
}

export async function setAutoTopUp(firmId: string, blocks: number) {
  const admin = supabaseAdmin();
  const { data: sub } = await admin.from("subscriptions").select("plan").eq("firm_id", firmId).maybeSingle();
  if (!sub) return false;
  await admin.from("subscriptions").update({ plan: json({ ...(sub.plan as object), autoTopUp: blocks }) }).eq("firm_id", firmId);
  await note(admin, firmId, null, "billing.auto_topup", { blocks });
  return true;
}

// How many people the plan's team takes, or null when no paid plan limits it (billing off, a
// pilot, a mandate not yet authorised). Deactivating a person frees the place at once.
export async function teamSize(firmId: string) {
  if (!billingProvider()) return null;
  const admin = supabaseAdmin();
  const [{ formula }, { data: sub }] = await Promise.all([billingSettings(admin), admin.from("subscriptions").select("plan, cycle, paid_until").eq("firm_id", firmId).maybeSingle()]);
  if (!formula || !sub?.paid_until) return null;
  const plan = sub.plan as unknown as SubPlan;
  return Math.max(plan.people, planPrice(formula, plan, sub.cycle as Cycle).people);
}

// A verified webhook, applied once: each change is made only from the state it expects, so a
// replay or an event that arrives late changes nothing.
export async function applyEvent(event: BillingEvent) {
  const admin = supabaseAdmin();
  if (event.type === "payment") {
    if (!uuid.test(event.payment)) return;
    if (event.status === "done") return paid(admin, event.payment, event.ref);
    if (event.status === "failed") return failed(admin, event.payment, event.reason);
    await admin.from("payments").update({ status: "cancelled" }).eq("id", event.payment).eq("status", "created");
    return;
  }
  if (event.type === "refund") {
    if (!uuid.test(event.refund)) return;
    return event.status === "done" ? refunded(admin, event.refund, event.ref) : refundFailed(admin, event.refund);
  }
  if (!mandateId.test(event.mandate)) return;
  const { data: sub } = await admin.from("subscriptions").select("*").or(`mandate.eq.${event.mandate},plan->>pending.eq.${event.mandate}`).maybeSingle();
  if (!sub) return;
  const plan = planOf(sub);
  if (event.status === "cancelled") {
    if (sub.mandate === event.mandate) await stopAutoPay(sub.firm_id, null, "bank");
    else await admin.from("subscriptions").update({ plan: json({ ...plan, pending: undefined, pendingMax: undefined }) }).eq("firm_id", sub.firm_id).eq("plan->>pending", event.mandate);
    return;
  }
  if (plan.pending === event.mandate) {
    // The higher limit the owner approved replaces the old mandate.
    const { data: moved } = await admin.from("subscriptions").update({ mandate: event.mandate, status: "active", method: event.method ?? sub.method, plan: json({ ...plan, pending: undefined, pendingMax: undefined, maxPaise: plan.pendingMax ?? plan.maxPaise }) })
      .eq("firm_id", sub.firm_id).eq("plan->>pending", event.mandate).select("firm_id").maybeSingle();
    if (moved && sub.mandate && sub.status === "active") await billingProvider()?.cancelMandate(sub.mandate).catch(() => alertAdmins(admin, "mandate_cancel_failed", sub.firm_id));
    if (moved) await note(admin, sub.firm_id, null, "billing.autopay_on", { method: event.method ?? sub.method ?? undefined });
    return;
  }
  const method = (event.method ?? sub.method) as Method;
  const { data: on } = await admin.from("subscriptions").update({ status: "active", method }).eq("firm_id", sub.firm_id).eq("mandate", event.mandate).eq("status", "created").select("mandate").maybeSingle();
  if (!on) return;
  await note(admin, sub.firm_id, null, "billing.autopay_on", { method });
  const { data: first } = await admin.from("payments").select("*").eq("firm_id", sub.firm_id).eq("status", "created").eq("details->>mandate", event.mandate);
  for (const payment of first ?? []) {
    if (detailsOf(payment).via === "auth") await paid(admin, payment.id, event.ref);
    else {
      // eNACH takes nothing at authorisation: its first debit is raised now, after the notice.
      const at = new Date(Date.now() + NOTICE_MS);
      await admin.from("payments").update({ due_at: at.toISOString() }).eq("id", payment.id);
      await billingProvider()?.charge({ mandate: event.mandate, id: payment.id, paise: payment.amount_paise, at, note: "InboxCA plan" });
      await mail(await ownerOf(admin, sub.firm_id), "InboxCA: your bank confirmed AutoPay", [`Your bank mandate is confirmed. InboxCA will take ${rupees(payment.amount_paise)} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })}, and your firm starts as soon as it is paid.`]);
    }
  }
}

// A payment captured: what it buys is added now, and not before (5.14.1).
async function paid(admin: Admin, id: string, ref?: string) {
  const { data: payment } = await admin.from("payments").update({ status: "done", provider_ref: ref ?? null }).eq("id", id).neq("kind", "refund").in("status", ["created", "failed"]).select("*").maybeSingle();
  if (!payment) return;
  const firmId = payment.firm_id;
  const details = detailsOf(payment);
  const { data: sub } = await admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle();
  const today = indiaDay(new Date());
  const email = await ownerOf(admin, firmId);
  if (sub) {
    const plan = planOf(sub);
    if (payment.kind === "plan") {
      const period: [string, string] = [today, periodEnd(today, sub.cycle as Cycle)];
      await admin.from("payments").update({ details: json({ ...details, period, lines: withPeriod(details.lines, period) }) }).eq("id", id);
      await admin.from("subscriptions").update({ paid_until: period[1] }).eq("firm_id", firmId);
      const { data: started } = await admin.from("firms").update({ status: "active" }).eq("id", firmId).eq("status", "pending").select("name").maybeSingle();
      if (started) await mail(email, `InboxCA is ready for ${started.name}`, [`Your first payment is in and ${started.name} is ready on InboxCA.`, `Sign in to start: ${link("/sign-in")}`, `Changed your mind? Cancel by ${long(moneyBackLastDay(today))} in Settings, Billing and get this payment back in full.`]);
    }
    if (payment.kind === "renewal" && details.period) {
      const rest = { ...plan, next: undefined };
      const { data: moved } = await admin.from("subscriptions").update({ paid_until: details.period[1], plan: json(details.plan ? { ...rest, ...details.plan } : rest) }).eq("firm_id", firmId).eq("paid_until", details.period[0]).select("mandate").maybeSingle();
      if (!moved) await alertAdmins(admin, "paid_twice", id);
      else {
        await admin.from("firms").update({ status: "active" }).eq("id", firmId).in("status", ["grace", "read_only"]);
        // Any other debit raised for the same period is called off.
        const { data: others } = await admin.from("payments").update({ status: "cancelled" }).eq("firm_id", firmId).eq("kind", "renewal").eq("status", "created").eq("details->period->>0", details.period[0]).select("id, details");
        for (const other of others ?? []) if (moved.mandate && detailsOf(other as Payment).via === "charge") await billingProvider()?.cancelCharge({ mandate: moved.mandate, id: other.id }).catch(() => log.warn("billing.charge_cancel_failed"));
      }
    }
    if (payment.kind === "upgrade" && details.plan) await admin.from("subscriptions").update({ plan: json({ ...plan, ...details.plan }) }).eq("firm_id", firmId);
    if (payment.kind === "extra_user") await admin.from("subscriptions").update({ plan: json({ ...plan, people: Math.max(plan.people, details.base ?? 0) + (details.add ?? 1) }) }).eq("firm_id", firmId);
    if (payment.kind === "ai_block") await admin.from("subscriptions").update({ plan: json({ ...plan, aiBlocks: (plan.aiBlocks ?? 0) + (details.add ?? 1) }) }).eq("firm_id", firmId);
  }
  await note(admin, firmId, null, "billing.paid", { payment: id, kind: payment.kind });
  await issue(admin, id);
}

async function failed(admin: Admin, id: string, reason?: string) {
  const { data: payment } = await admin.from("payments").update({ status: "failed" }).eq("id", id).neq("kind", "refund").eq("status", "created").select("*").maybeSingle();
  if (!payment) return;
  await note(admin, payment.firm_id, null, "billing.payment_failed", { payment: id, kind: payment.kind });
  if (payment.kind !== "renewal") return;
  const { data: sub } = await admin.from("subscriptions").select("method, paid_until").eq("firm_id", payment.firm_id).maybeSingle();
  const today = indiaDay(new Date());
  if (sub?.paid_until && sub.paid_until <= today) await admin.from("firms").update({ status: "grace" }).eq("id", payment.firm_id).eq("status", "active");
  const late = sub?.paid_until ? daysBetween(sub.paid_until, today) : 0;
  const retry = sub?.method !== "upi" && RETRY_DAYS.find((day) => day > late);
  await mail(await ownerOf(admin, payment.firm_id), "InboxCA: your payment did not go through", [
    `The payment of ${rupees(payment.amount_paise)} for your InboxCA plan did not go through${reason ? ` (${reason.slice(0, 120)})` : ""}.`,
    retry && sub?.paid_until ? `InboxCA will try again on ${long(addDays(sub.paid_until, retry))}.` : "",
    `Pay now in Settings, Billing: ${link(BILLING)}`,
    "Everything keeps working for 7 days. After that your firm can only view until the plan is paid.",
  ].filter(Boolean));
}

async function refunded(admin: Admin, id: string, ref?: string) {
  const { data: refund } = await admin.from("payments").update({ status: "done", provider_ref: ref ?? null }).eq("id", id).eq("kind", "refund").in("status", ["created", "failed"]).select("firm_id").maybeSingle();
  if (!refund) return;
  await note(admin, refund.firm_id, null, "billing.refunded", { payment: id });
  await issue(admin, id);
}

async function refundFailed(admin: Admin, id: string) {
  const { data: refund } = await admin.from("payments").update({ status: "failed" }).eq("id", id).eq("kind", "refund").eq("status", "created").select("firm_id").maybeSingle();
  if (!refund) return;
  await note(admin, refund.firm_id, null, "billing.refund_failed", { payment: id });
  await alertAdmins(admin, "refund_failed", id);
  await admin.from("jobs").insert({ firm_id: refund.firm_id, kind: "billing_refund", entity_type: "payment", entity_id: id, run_at: new Date(Date.now() + 3_600_000).toISOString(), idempotency_key: `billing_refund:${id}` });
}

// The receipt, tax invoice, credit note or refund receipt of a done payment, numbered once and
// emailed to the owner. Without Orelu's tax details it waits, and the daily run tries again.
export async function issue(admin: Admin, id: string) {
  const { data: payment } = await admin.from("payments").select("*").eq("id", id).maybeSingle();
  if (!payment || payment.doc || payment.status !== "done") return;
  const [{ tax }, firm, { data: sub }] = await Promise.all([billingSettings(admin), firmOf(admin, payment.firm_id), admin.from("subscriptions").select("method").eq("firm_id", payment.firm_id).maybeSingle()]);
  if (!tax || !firm) return void (await alertAdmins(admin, "tax_details_missing"));
  const day = indiaDay(new Date());
  const of = payment.refund_of ? ((await admin.from("payments").select("doc").eq("id", payment.refund_of).maybeSingle()).data?.doc as Doc | null) : null;
  const kind: DocKind = payment.kind === "refund" ? (of?.kind === "invoice" ? "credit" : "refund") : payment.gst_paise ? "invoice" : "receipt";
  const via = detailsOf(payment).via;
  const doc: Omit<Doc, "no"> = {
    kind, date: day,
    seller: { name: tax.legalName, address: tax.address, pan: tax.pan, ...(gstOn(tax, day) && { gstin: tax.gstin }), stateCode: tax.stateCode, state: stateName(tax.stateCode) },
    buyer: of?.buyer ?? { name: firm.name, address: firm.address, ...(firm.gstin && { gstin: firm.gstin }), stateCode: firm.stateCode, state: stateName(firm.stateCode) },
    lines: payment.kind === "refund" ? [{ text: `Money given back for ${of?.no ?? "your payment"}`, paise: payment.amount_paise - payment.gst_paise }] : detailsOf(payment).lines,
    taxable: payment.amount_paise - payment.gst_paise,
    ...taxLines(payment.gst_paise, of ? !of.igst : tax.stateCode === firm.stateCode),
    ...(payment.gst_paise && { rate: of?.rate ?? tax.rate, sac: of?.sac ?? tax.sac }),
    total: payment.amount_paise,
    ...(payment.kind !== "refund" && { paidBy: via === "order" ? "online payment" : methodWords[(sub?.method ?? "upi") as Method] }),
    ...(of && { of: { no: of.no, date: of.date } }),
    ...(payment.reason && { reason: payment.reason }),
    ...(kind === "credit" && tax.signatory && { signatory: tax.signatory }),
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const prefix = serialNumber(kind, day, 1).slice(0, -6);
    const { data: last } = await admin.from("payments").select("no:doc->>no").like("doc->>no", `${prefix}/%`).order("doc->>no", { ascending: false }).limit(1).maybeSingle();
    const no = serialNumber(kind, day, (last ? Number(String(last.no).split("/")[2]) : 0) + 1);
    const { data: saved, error } = await admin.from("payments").update({ doc: json({ ...doc, no }) }).eq("id", id).is("doc", null).select("id").maybeSingle();
    if (error?.code === "23505") continue;
    if (error) throw new Error(`Numbering a document failed: ${error.code}`);
    if (saved) await mail(await ownerOf(admin, payment.firm_id), `InboxCA ${docTitles[kind].toLowerCase()} ${no}`, [docText({ ...doc, no }, link(`/app/settings/billing/${id}`))]);
    return;
  }
}

// The money-back guarantee (D33): within 14 days of the first payment, once per firm, checked
// against guarantee_claims by its PAN, GSTIN, mailbox and owner email.
async function identities(admin: Admin, firmId: string) {
  const [firm, email, { data: mailbox }] = await Promise.all([firmOf(admin, firmId), ownerOf(admin, firmId), admin.from("connected_accounts").select("id, address_enc").eq("firm_id", firmId).eq("kind", "mail").maybeSingle()]);
  const address = mailbox ? await serverCrypto().decrypt(firmId, `accounts/${mailbox.id}/address`, mailbox.address_enc).catch(() => "") : "";
  return [firm?.gstin && `gstin:${firm.gstin}`, firm?.gstin && `pan:${firm.gstin.slice(2, 12)}`, email && `email:${email}`, address && `email:${address}`].filter((value): value is string => !!value);
}

export async function moneyBack(firmId: string, today = indiaDay(new Date()), admin: Admin = supabaseAdmin()) {
  const { data: rows } = await admin.from("payments").select("*").eq("firm_id", firmId).order("created_at");
  const first = rows?.find((row) => row.kind === "plan" && row.status === "done");
  const claimed = (rows ?? []).filter((row) => row.kind === "refund" && row.reason === "money_back");
  if (!first) return { state: "none" as const };
  const lastDay = moneyBackLastDay(detailsOf(first).period?.[0] ?? indiaDay(new Date(first.created_at)));
  if (claimed.length) return { state: claimed.every((row) => row.status === "done") ? ("refunded" as const) : ("refunding" as const), lastDay, rows: rows ?? [] };
  if (today > lastDay) return { state: "late" as const, lastDay };
  if (!(await admin.rpc("money_back_claim", { identities: await identities(admin, firmId), claim: false })).data) return { state: "used" as const, lastDay };
  return { state: "open" as const, lastDay, rows: rows ?? [] };
}

// The owner's Cancel and get my money back, after the 2 step code: the claim is recorded, the
// mandate cancelled and each payment of the window refunded with its own id, so pressing twice
// refunds once. The setup fee stays once the first import of past files has started.
export async function claimMoneyBack(firmId: string, actor: string) {
  const admin = supabaseAdmin();
  const provider = billingProvider();
  const window = await moneyBack(firmId, indiaDay(new Date()), admin);
  if (window.state === "refunding" || window.state === "refunded") return null;
  if (window.state !== "open" || !provider) return window.state === "late" ? `The 14 days ended on ${long(window.lastDay)}.` : window.state === "used" ? "This firm, its GSTIN, PAN or email already had its money back once." : "There is no payment to give back.";
  if (!(await admin.rpc("money_back_claim", { identities: await identities(admin, firmId), claim: true })).data) return "This firm, its GSTIN, PAN or email already had its money back once.";
  const { data: sub } = await admin.from("subscriptions").select("mandate, method").eq("firm_id", firmId).maybeSingle();
  await stopAutoPay(firmId, actor, "money_back");
  const { count: imported } = await admin.from("requests").select("id", { count: "exact", head: true }).eq("firm_id", firmId).eq("kind", "import");
  const back = window.rows.filter((row) => row.status === "done" && ["plan", "extra_user", "ai_block", "topup"].includes(row.kind) && indiaDay(new Date(row.created_at)) <= window.lastDay);
  const refunds: string[] = [];
  for (const row of back) {
    const setup = row.kind === "plan" && imported ? (detailsOf(row).setupPaise ?? 0) : 0;
    const setupWithGst = setup ? setup + Math.round((row.gst_paise * setup) / (row.amount_paise - row.gst_paise)) : 0;
    refunds.push((await refund(admin, provider, row, row.amount_paise - setupWithGst, "money_back", sub)) ?? "");
  }
  await admin.from("firms").update({ status: "read_only" }).eq("id", firmId).in("status", ["active", "grace"]);
  await note(admin, firmId, actor, "billing.money_back", { payments: refunds.filter(Boolean) });
  await mail(await ownerOf(admin, firmId), "InboxCA: your money is on its way back", ["Your InboxCA plan is cancelled and your payment is being given back to the way you paid. Banks usually take 5 to 7 working days.", `Your firm can still view everything and download its client list, records and activity log for 30 days, in Settings, Your data: ${link("/app/settings?group=data")}. Then InboxCA deletes your firm's data. Papers in your drive stay where they are.`]);
  return null;
}

async function refund(admin: Admin, provider: PaymentProvider, of: Payment, amount: number, reason: "money_back" | "duplicate" | "charge_error", sub?: { mandate: string | null; method: string | null } | null) {
  if (amount <= 0) return null;
  const gst = Math.round((of.gst_paise * amount) / of.amount_paise);
  const { data: row, error } = await admin.from("payments").insert({ firm_id: of.firm_id, kind: "refund", refund_of: of.id, reason, amount_paise: amount, gst_paise: gst, details: json({ lines: [], via: detailsOf(of).via } satisfies Details) }).select("id").single();
  if (error) throw new Error(`Saving the refund failed: ${error.code}`);
  try {
    await provider.refund({ id: row.id, of: { id: of.id, ref: of.provider_ref, kind: detailsOf(of).via, mandate: detailsOf(of).mandate ?? sub?.mandate ?? null, method: (sub?.method as Method | null) ?? null }, paise: amount, note: reason === "money_back" ? "InboxCA money back" : "InboxCA refund" });
  } catch {
    await refundFailed(admin, row.id);
  }
  return row.id;
}

// An Orelu admin gives back a payment taken twice or in error, in full, from the console.
export async function adminRefund(paymentId: string, actor: string, reason: "duplicate" | "charge_error") {
  const admin = supabaseAdmin();
  const provider = billingProvider();
  const { data: of } = await admin.from("payments").select("*").eq("id", paymentId).eq("status", "done").neq("kind", "refund").maybeSingle();
  if (!of || !provider) return false;
  const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("refund_of", paymentId).in("status", ["created", "done"]);
  if (count) return false;
  const { data: sub } = await admin.from("subscriptions").select("mandate, method").eq("firm_id", of.firm_id).maybeSingle();
  const id = await refund(admin, provider, of, of.amount_paise, reason, sub);
  await note(admin, of.firm_id, actor, "billing.refund_asked", { payment: id ?? undefined, reason });
  return true;
}

// A failed refund, tried again an hour later with a new refund id, at most three times; after
// that only the admin alert stays.
export async function retryRefund(id: string) {
  const admin = supabaseAdmin();
  const provider = billingProvider();
  const { data: failedRow } = await admin.from("payments").select("*").eq("id", id).eq("kind", "refund").eq("status", "failed").maybeSingle();
  if (!failedRow || !provider) return;
  const { data: tries } = await admin.from("payments").select("status").eq("refund_of", failedRow.refund_of!).eq("reason", failedRow.reason!);
  if ((tries ?? []).some((row) => row.status !== "failed") || (tries?.length ?? 0) >= 3) return;
  const [{ data: of }, { data: sub }] = await Promise.all([admin.from("payments").select("*").eq("id", failedRow.refund_of!).single(), admin.from("subscriptions").select("mandate, method").eq("firm_id", failedRow.firm_id).maybeSingle()]);
  if (of) await refund(admin, provider, of, failedRow.amount_paise, failedRow.reason as "money_back", sub);
}

// Once a day for each firm with a plan (PLAN.md 5.14.1): its documents still to number, the
// renewal raised 3 days ahead with Orelu's own notice (Cashfree's notice and debit follow at
// least 25 hours later), Orelu's retries of failed eNACH and card debits on days 1, 3 and 6, and
// the move to grace, read only and closing.
export async function dailyBilling(firmId: string, now = new Date()) {
  const provider = billingProvider();
  const admin = supabaseAdmin();
  const today = indiaDay(now);
  const [{ formula, tax }, firm, { data: sub }] = await Promise.all([billingSettings(admin), firmOf(admin, firmId), admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle()]);
  if (!provider || !formula || !firm) return;
  if (firm.status === "closed") {
    if (sub && sub.status !== "cancelled") await stopAutoPay(firmId, null, "closed");
    return;
  }
  const { data: unnumbered } = await admin.from("payments").select("id").eq("firm_id", firmId).eq("status", "done").is("doc", null);
  for (const { id } of unnumbered ?? []) await issue(admin, id);
  const back = await moneyBack(firmId, today, admin);
  if (back.state === "refunding" || back.state === "refunded") {
    const refundedOn = back.rows.find((row) => row.kind === "refund" && row.reason === "money_back")?.created_at;
    if (firm.status === "read_only" && refundedOn && daysBetween(indiaDay(new Date(refundedOn)), today) >= 30) await admin.rpc("close_unpaid", { target_firm: firmId, why: "money_back" });
    return;
  }
  if (!sub?.paid_until || firm.status === "pending") return;
  const due = sub.paid_until;
  const email = await ownerOf(admin, firmId);
  const { data: tried } = await admin.from("payments").select("status").eq("firm_id", firmId).eq("kind", "renewal").eq("details->period->>0", due).in("status", ["created", "done", "failed"]);
  const waiting = (tried ?? []).some((row) => row.status !== "failed");
  const plan = planOf(sub);
  const ahead = daysBetween(today, due);
  const late = -ahead;
  // The renewal once, from 3 days ahead; after a failed eNACH or card debit, again on days 1, 3
  // and 6 (Cashfree retries UPI AutoPay itself).
  if (sub.status === "active" && sub.mandate && !waiting && ((ahead >= 0 && ahead <= 3 && !tried?.length) || (sub.method !== "upi" && RETRY_DAYS.includes(late)))) {
    const next = plan.next ?? plan;
    const period: [string, string] = [due, periodEnd(due, sub.cycle as Cycle)];
    const priced = quote(formula, tax, firm.stateCode, next, sub.cycle as Cycle, due < today ? today : due);
    if (priced.recurring.total > plan.maxPaise) {
      await mail(email, "InboxCA: approve your new AutoPay limit", [`Your plan now costs ${rupees(priced.recurring.total)}, more than the ${rupees(plan.maxPaise)} your AutoPay allows. Approve the new limit once in Settings, Billing, or pay now: ${link(BILLING)}`]);
    } else {
      const at = new Date(Math.max(Date.parse(`${due}T10:00:00+05:30`), now.getTime() + NOTICE_MS));
      const { data: row, error } = await admin.from("payments").insert({ firm_id: firmId, kind: "renewal", amount_paise: priced.recurring.total, gst_paise: priced.recurring.gst, due_at: at.toISOString(), details: json({ lines: withPeriod(priced.price.lines, period), via: "charge", period, plan: next } satisfies Details) }).select("id").single();
      if (error) throw new Error(`Saving the renewal failed: ${error.code}`);
      try {
        await provider.charge({ mandate: sub.mandate, id: row.id, paise: priced.recurring.total, at, note: `InboxCA plan, ${span(period)}` });
      } catch (problem) {
        await admin.from("payments").update({ status: "cancelled" }).eq("id", row.id);
        throw problem;
      }
      await note(admin, firmId, null, "billing.renewal_raised", { payment: row.id });
      // Orelu's own notice (RBI E-mandate Framework 2026, para 6: merchant, amount, date and time,
      // mandate reference and reason, and how to opt out), besides the provider's.
      await mail(email, `InboxCA: ${rupees(priced.recurring.total)} will be taken on ${long(indiaDay(at))}`, [
        `${late > 0 ? "We will try again: " : ""}Orelu (InboxCA) will take ${rupees(priced.recurring.total)} from your ${methodWords[sub.method as Method]} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })}, for ${firm.name}'s InboxCA plan, ${span(period)}.`,
        `AutoPay reference: ${sub.mandate}.`,
        `To stop it, turn AutoPay off in Settings, Billing before then: ${link(BILLING)}`,
      ]);
    }
  }
  const status = overdueState(due, today);
  if (status === firm.status || !["active", "grace", "read_only"].includes(firm.status)) return;
  // A debit still on its way keeps the firm as it is until it fails.
  if (status === "grace" && waiting) return;
  if (status === "closed") {
    const { data: closed } = await admin.rpc("close_unpaid", { target_firm: firmId, why: "unpaid" });
    if (closed) await mail(email, "InboxCA: your firm is closed", [`Your InboxCA plan was not paid for 30 days, so your team can no longer sign in. You can still sign in and download your data until ${long(addDays(today, 30))}; then InboxCA deletes your firm's data. Papers in your drive stay where they are.`]);
    return;
  }
  await admin.from("firms").update({ status }).eq("id", firmId).eq("status", firm.status);
  await note(admin, firmId, null, "billing.state", { status });
  if (status === "read_only") await mail(email, "InboxCA: your firm can only view now", [`Your InboxCA plan has not been paid since ${long(due)}, so your team can view but not change anything, and InboxCA has paused its work. Client emails wait in your mailbox.`, `Pay now in Settings, Billing to start again: ${link(BILLING)}`, `If it is not paid by ${long(addDays(due, 30))}, your firm closes and its InboxCA data is deleted 30 days later.`]);
}

// Once a day for Orelu: every payment and refund the provider reports for the last 3 days is
// matched with Orelu's own, its fee kept for the margin view; anything that does not match, and
// any payment not settled within 7 days, alerts the admins.
export async function reconcile(now = new Date()) {
  const provider = billingProvider();
  if (!provider) return;
  const admin = supabaseAdmin();
  for (const line of await provider.settlements(new Date(now.getTime() - 3 * 86_400_000), now)) {
    const query = admin.from("payments").select("id, amount_paise, status, kind");
    const { data: ours } = line.id && uuid.test(line.id) ? await query.eq("id", line.id).maybeSingle() : line.ref ? await query.eq("provider_ref", line.ref).neq("kind", "refund").maybeSingle() : { data: null };
    if (!ours || ours.status !== "done" || ours.amount_paise !== line.paise || (ours.kind === "refund") !== line.refund) {
      await alertAdmins(admin, ours ? "amount_or_state_differs" : "unknown_at_provider", ours?.id ?? line.ref ?? line.id);
      if (!ours) continue;
    }
    await admin.from("payments").update({ fee_paise: line.feePaise, fee_tax_paise: line.feeTaxPaise, ...(line.settledAt && { settled_at: new Date(line.settledAt).toISOString() }) }).eq("id", ours.id);
  }
  const { data: unsettled } = await admin.from("payments").select("id").eq("status", "done").neq("kind", "refund").is("settled_at", null).lt("created_at", new Date(now.getTime() - 7 * 86_400_000).toISOString()).limit(20);
  for (const { id } of unsettled ?? []) await alertAdmins(admin, "not_settled", id);
}
