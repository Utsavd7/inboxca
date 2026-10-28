import { randomUUID } from "node:crypto";
import { states } from "@/app/(auth)/sign-up/states";
import type { Database, Json } from "@/src/db/types";
import { serverCrypto } from "@/src/lib/crypto";
import { log } from "@/src/lib/logger";
import { supabaseAdmin } from "@/src/lib/supabase";
import { sendSystemMail } from "@/src/lib/system-mail";
import { docText, docTitles, taxLines, type Doc } from "./documents";
import {
  addDays, daysBetween, financialYear, formulaSchema, GB, gstOn, indiaDay, mandateMax, methodsFor, moneyBackLastDay, newPlanYear, overdueState, periodEnd, planFit, planPrice, prorate,
  RETRY_DAYS, rupees, serialNumber, sizedByWork, taxSchema, toYearly, withGst, type Cycle, type DocKind, type FirmPlan, type Method, type PlanFormula, type Tax,
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
// the plan includes). `basis`: what a plan change was priced on (basisOf); for a renewal, the move
// down waiting when it was raised (waitingOf). `priced`: a renewal's plan when it was raised (basisOf).
// `unsure`: a debit or refund whose answer was lost, asked again with the same id (raise, sendRefund).
// `stale`: a plan change paid after what it was priced on changed, given back in full (settle).
export type Details = { lines: { text: string; paise: number }[]; via: "auth" | "charge" | "order"; mandate?: string; period?: [string, string]; plan?: FirmPlan; add?: number; base?: number; setupPaise?: number; basis?: string; priced?: string; unsure?: true; stale?: true };
export type Alert = { kind: string; ref?: string; at: string };

const json = (value: unknown) => value as NonNullable<Json>;
const planOf = (sub: Subscription) => sub.plan as unknown as SubPlan;
const detailsOf = (payment: Payment) => payment.details as unknown as Details;
// What a move up, a switch to yearly payment, one more person or one more AI block is priced on:
// the plan's priced parts, the cycle and the paid period. One that arrives after any of them
// changed (two checkouts paid out of order) is not applied and goes back in full.
const basisOf = (sub: Subscription) => {
  const plan = planOf(sub);
  return JSON.stringify([sub.cycle, sub.paid_until, plan.clients, plan.practice, plan.people, plan.aiBlocks ?? 0, plan.returns ?? null]);
};
const waitingOf = (plan: SubPlan) => JSON.stringify(plan.next ?? null);
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
  | "billing.renewal_raised" | "billing.downgrade_set" | "billing.money_back" | "billing.refund_asked" | "billing.refunded" | "billing.refund_failed" | "billing.state" | "billing.auto_topup" | "billing.moved_up";
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
type Firm = NonNullable<Awaited<ReturnType<typeof firmOf>>>;

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

// The firm's two measures against its plan, from the owner's meters (5.14, D38).
export async function fitOf(admin: Admin, firmId: string, formula: PlanFormula, sub: Pick<Subscription, "plan" | "cycle">, day: string) {
  const { data } = await admin.rpc("firm_usage", { target_firm: firmId, today: day });
  const used = data?.[0];
  return used ? planFit(formula, sub.plan as unknown as SubPlan, sub.cycle as Cycle, { returns: used.returns_so_far, returnsByMarch: used.returns_this_year, bytes: Number(used.workspace_bytes), bytesByMarch: Number(used.workspace_by_march) }, day) : null;
}

// The work of the plan year a renewal ends, in returns a year: measured to the day before a yearly
// payer's renewal, or to 31 March for a monthly payer, and never past today.
type Renewing = Pick<Subscription, "plan" | "cycle" | "paid_until">;
async function yearWork(admin: Admin, firmId: string, formula: PlanFormula, sub: Renewing, today: string) {
  const end = sub.cycle === "yearly" ? addDays(sub.paid_until!, -1) : `${sub.paid_until!.slice(0, 4)}-03-31`;
  return (await fitOf(admin, firmId, formula, sub, end < today ? end : today))?.measured ?? null;
}

// The plan a renewal is for: a move down the owner chose, or the plan as it is. At a new plan year
// the floor the meters moved the plan up to comes down to the work the year measured (never up:
// that is the move up, with its own notice), but never so far that the firm lands on a smaller
// plan it did not choose (5.14).
async function renewalPlan(admin: Admin, firmId: string, formula: PlanFormula, sub: Renewing, today: string): Promise<FirmPlan> {
  const plan = sub.plan as unknown as SubPlan;
  const base = plan.next ?? plan;
  if (base.returns === undefined || !newPlanYear(sub.cycle as Cycle, sub.paid_until!)) return base;
  const reset = { ...base, returns: Math.min(base.returns, (await yearWork(admin, firmId, formula, sub, today)) ?? base.returns) };
  return plan.next || planPrice(formula, reset, sub.cycle as Cycle).paise === planPrice(formula, base, sub.cycle as Cycle).paise ? reset : base;
}

// The move down (5.14): from 30 days before a renewal that starts a new plan year until it is
// raised, the plan the year's work fits, when it costs less than the plan now. The owner is offered
// it on one card and by one email, and it applies at that renewal only when the owner accepts.
export async function moveDownFit(admin: Admin, firmId: string, formula: PlanFormula, sub: Renewing, today: string) {
  const plan = sub.plan as unknown as SubPlan;
  const ahead = sub.paid_until ? daysBetween(today, sub.paid_until) : 0;
  if (plan.next || ahead <= 3 || ahead > 30 || !newPlanYear(sub.cycle as Cycle, sub.paid_until!)) return null;
  const measured = await yearWork(admin, firmId, formula, sub, today);
  const down = measured === null ? null : sizedByWork(formula, plan, measured);
  return down && planPrice(formula, down, sub.cycle as Cycle).paise < planPrice(formula, plan, sub.cycle as Cycle).paise ? { plan: down, on: sub.paid_until! } : null;
}

// A move to a bigger plan or a switch to yearly payment raised on the mandate and not taken yet.
export const movingUp = async (admin: Admin, firmId: string) =>
  (await admin.from("payments").select("kind, amount_paise, due_at").eq("firm_id", firmId).in("kind", ["upgrade", "yearly"]).eq("status", "created").eq("details->>via", "charge").limit(1).maybeSingle()).data;

const withPeriod = (lines: Details["lines"], period: [string, string]) => lines.map((line, at) => (at ? line : { ...line, text: `${line.text}, ${span(period)}` }));

// What the payer's bank shows for a debit, the same on every try of it.
const remarks = (payment: Payment) =>
  payment.kind === "renewal" ? `InboxCA plan, ${span(detailsOf(payment).period!)}` : payment.kind === "plan" ? "InboxCA plan" : payment.kind === "topup" ? "InboxCA AI top-up" : detailsOf(payment).lines[0].text;

// A debit on the mandate, raised with the payment's own id, which the provider takes as its
// idempotency key. One the provider turned down is cancelled, as nothing was taken. Any other
// failure (a timeout, a lost answer) may have been carried out: the payment stays created and
// marked unsure, so its webhook still lands, the admins are told, and the daily run raises it
// again with the same id and date (raiseAgain), which the provider answers as the first time.
async function raise(admin: Admin, provider: PaymentProvider, mandate: string, payment: Payment) {
  const details = detailsOf(payment);
  try {
    await provider.charge({ mandate, id: payment.id, paise: payment.amount_paise, at: new Date(payment.due_at!), note: remarks(payment) });
  } catch (problem) {
    if ((problem as { refused?: boolean }).refused) await admin.from("payments").update({ status: "cancelled" }).eq("id", payment.id).eq("status", "created");
    else {
      await admin.from("payments").update({ details: json({ ...details, unsure: true }) }).eq("id", payment.id);
      await alertAdmins(admin, "charge_unsure", payment.id);
    }
    throw problem;
  }
  if (details.unsure) await admin.from("payments").update({ details: json({ ...details, unsure: undefined }) }).eq("id", payment.id);
}

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
// upgrade's difference for the rest of the paid period (to a plan the owner chose, or to the one
// the meters say fits), a monthly payer's switch to yearly payment, one more person, one more AI
// block a month, or a one time AI top-up. The switch is debited on the mandate within its maximum
// (`due`: nothing to open), and paid in checkout above it.
export type Buy = { kind: "renewal" } | { kind: "upgrade"; plan: FirmPlan } | { kind: "fit" } | { kind: "yearly" } | { kind: "extra_user" } | { kind: "ai_block" } | { kind: "topup" };
export async function buy(firmId: string, actor: string, what: Buy, returnUrl: string): Promise<Checkout | { error: string } | { due: string }> {
  const provider = billingProvider();
  const admin = supabaseAdmin();
  const [{ formula, tax }, { data: sub }, firm, email] = await Promise.all([billingSettings(admin), admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle(), firmOf(admin, firmId), ownerOf(admin, firmId)]);
  if (!provider || !formula || !sub?.paid_until || !sub.phone_enc || !firm || !email) return { error: "Set up AutoPay first." };
  const today = indiaDay(new Date());
  const cycle = sub.cycle as Cycle;
  const plan = planOf(sub);
  if (what.kind === "fit") {
    const fit = await fitOf(admin, firmId, formula, sub, today);
    if (!fit?.notice) return { error: "Your plan fits your firm's work." };
    what = fit.yearly ? { kind: "yearly" } : { kind: "upgrade", plan: fit.next };
  }
  if ((what.kind === "upgrade" || what.kind === "yearly") && (await movingUp(admin, firmId))) return { error: "A change to your plan is on its way already. Its payment is shown in Settings, Billing." };
  const current = planPrice(formula, plan, cycle);
  let lines: Details["lines"];
  let details: Partial<Details> = {};
  if (what.kind === "renewal") {
    if (sub.paid_until > addDays(today, 3)) return { error: "Your plan is paid until then already." };
    const period: [string, string] = [sub.paid_until, periodEnd(sub.paid_until, cycle)];
    const next = await renewalPlan(admin, firmId, formula, sub, today);
    lines = withPeriod(planPrice(formula, next, cycle).lines, period);
    details = { period, plan: next, basis: waitingOf(plan), priced: basisOf(sub) };
  } else if (what.kind === "topup") {
    if (await blocksThisMonth(admin, firmId, plan, today) >= current.blockCap) return { error: "Your plan has all the extra AI it can take this month. Move to a bigger plan for more." };
    lines = [{ text: `AI top-up of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits, good for 12 months`, paise: formula.aiBlock.price * 100 }];
    details = { add: 1 };
  } else if (what.kind === "yearly") {
    if (cycle === "yearly") return { error: "Your plan is paid yearly already." };
    // As for the automatic move up: never in the days a renewal may be raised.
    if (sub.paid_until <= addDays(today, 6)) return { error: `Your plan renews on ${long(sub.paid_until)}. Switch to yearly payment after that.` };
    const year = toYearly(formula, plan, today, sub.paid_until);
    lines = [{ text: `InboxCA ${current.name} plan, yearly, ${long(today)} to ${long(addDays(year.until, -1))}, less what is left of the month paid`, paise: year.paise }];
    details = { period: [sub.paid_until, year.until], basis: basisOf(sub) };
  } else {
    if (sub.paid_until <= today) return { error: "Pay for your plan first." };
    const team = Math.max(plan.people, current.people);
    // A plan the owner chose keeps the work the meters measured.
    const next = what.kind === "upgrade" ? { ...what.plan, returns: what.plan.returns ?? plan.returns } : what.kind === "extra_user" ? { ...plan, people: team + 1 } : { ...plan, aiBlocks: (plan.aiBlocks ?? 0) + 1 };
    if (what.kind === "ai_block" && (await blocksThisMonth(admin, firmId, plan, today)) >= current.blockCap) return { error: "Your plan has all the extra AI it can take. Move to a bigger plan for more." };
    const moved = planPrice(formula, next, cycle);
    if (moved.paise <= current.paise) return { error: "That is not more than your plan now. Choose it as a change at renewal." };
    const until = addDays(sub.paid_until, -1);
    const words = what.kind === "upgrade" ? `Move to the ${moved.name} plan` : what.kind === "extra_user" ? "One more person in the team" : `One more AI block of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits a month`;
    lines = [{ text: `${words}, ${long(today)} to ${long(until)}`, paise: prorate(moved.paise - current.paise, today, sub.paid_until, cycle) }];
    details = { ...(what.kind === "upgrade" ? { plan: next } : what.kind === "extra_user" ? { add: 1, base: team } : { add: 1 }), basis: basisOf(sub) };
    if (!lines[0].paise) return { error: "Your plan renews today. Make the change at renewal." };
  }
  const amount = withGst(lines.reduce((sum, line) => sum + line.paise, 0), tax, firm.stateCode, today);
  if (what.kind === "yearly" && sub.status === "active" && sub.mandate && amount.total <= plan.maxPaise) {
    const at = new Date(Date.now() + NOTICE_MS);
    const { data: debit, error } = await admin.from("payments").insert({ firm_id: firmId, kind: "yearly", amount_paise: amount.total, gst_paise: amount.gst, due_at: at.toISOString(), details: json({ ...details, lines, via: "charge" } satisfies Details) }).select("*").single();
    if (error) throw new Error(`Saving the debit failed: ${error.code}`);
    await raise(admin, provider, sub.mandate, debit);
    await note(admin, firmId, actor, "billing.order_started", { payment: debit.id, kind: what.kind });
    // Orelu's own notice, as for a renewal (RBI E-mandate Framework 2026, para 6).
    await mail(email, `InboxCA: ${rupees(amount.total)} will be taken on ${long(indiaDay(at))}`, [
      `Orelu (InboxCA) will take ${rupees(amount.total)} from your ${methodWords[sub.method as Method]} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })}, for ${firm.name}'s switch to yearly payment: ${lines[0].text}.`,
      `AutoPay reference: ${sub.mandate}.`,
      `To stop it, turn AutoPay off in Settings, Billing before then: ${link(BILLING)}`,
    ]);
    return { due: at.toISOString() };
  }
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
  const lines = [{ text: `AI top-up of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits, good for 12 months`, paise: formula.aiBlock.price * 100 }];
  const amount = withGst(lines[0].paise, tax, firm.stateCode, today);
  if (amount.total > plan.maxPaise) return false;
  const at = new Date(Date.now() + NOTICE_MS);
  const { data: row } = await admin.from("payments").insert({ firm_id: firmId, kind: "topup", amount_paise: amount.total, gst_paise: amount.gst, due_at: at.toISOString(), details: json({ lines, via: "charge", add: 1 } satisfies Details) }).select("*").single();
  if (!row) return false;
  // Not raised again here when it fails: an unsure one is the daily run's (raiseAgain).
  if (!(await raise(admin, provider, sub.mandate, row).then(() => true, () => false))) return false;
  await note(admin, firmId, null, "billing.auto_topup", { payment: row.id, blocks: 1 });
  await mail(await ownerOf(admin, firmId), "InboxCA: an AI top-up is on its way", [`Your firm used 90% of its AI credits, so InboxCA will take ${rupees(amount.total)} from your ${methodWords[sub.method as Method]} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })} for ${formula.aiBlock.credits.toLocaleString("en-IN")} more credits, good for 12 months.`, `Turn auto top-up off in Settings, Billing: ${link(BILLING)}`]);
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
// "fit": the move down the year's work fits (moveDownFit), worked out here again.
export async function setDowngrade(firmId: string, actor: string, chosen: FirmPlan | "fit" | null) {
  const admin = supabaseAdmin();
  const { data: sub } = await admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle();
  if (!sub) return "Set up AutoPay first.";
  const { formula } = chosen === "fit" ? await billingSettings(admin) : { formula: null };
  const fit = formula && (await moveDownFit(admin, firmId, formula, sub, indiaDay(new Date())));
  if (chosen === "fit" && !fit) return "Your plan is the one your firm's work fits.";
  const plan = fit ? fit.plan : (chosen as FirmPlan | null);
  if (plan) {
    const { count } = await admin.from("firm_members").select("user_id", { count: "exact", head: true }).eq("firm_id", firmId).in("status", ["active", "invited"]);
    if (plan.people < (count ?? 1)) return `Your firm has ${count} people. Remove people in People first, or keep a team of ${count}.`;
  }
  const rest = { ...planOf(sub), next: undefined };
  // Never below the work the meters measured (5.14): the move down that fits carries the year's.
  await admin.from("subscriptions").update({ plan: json(plan ? { ...rest, next: fit ? plan : { ...plan, returns: rest.returns } } : rest) }).eq("firm_id", firmId);
  await note(admin, firmId, actor, "billing.downgrade_set");
  return null;
}

export async function setAutoTopUp(firmId: string, blocks: number, actor: string | null = null) {
  const admin = supabaseAdmin();
  const { data: sub } = await admin.from("subscriptions").select("plan").eq("firm_id", firmId).maybeSingle();
  if (!sub) return false;
  await admin.from("subscriptions").update({ plan: json({ ...(sub.plan as object), autoTopUp: blocks }) }).eq("firm_id", firmId);
  await note(admin, firmId, actor, "billing.auto_topup", { blocks });
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
      // eNACH takes nothing at authorisation: its first debit is raised now, after the notice. If
      // that fails the admins are told, and the daily run raises it again (raiseAgain).
      const at = new Date(Date.now() + NOTICE_MS);
      await admin.from("payments").update({ due_at: at.toISOString() }).eq("id", payment.id);
      try {
        await raise(admin, billingProvider()!, event.mandate, { ...payment, due_at: at.toISOString() });
      } catch {
        await alertAdmins(admin, "first_debit_failed", sub.firm_id);
        continue;
      }
      await mail(await ownerOf(admin, sub.firm_id), "InboxCA: your bank confirmed AutoPay", [`Your bank mandate is confirmed. InboxCA will take ${rupees(payment.amount_paise)} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })}, and your firm starts as soon as it is paid.`]);
    }
  }
}

// A payment captured: what it buys is added now, and not before (5.14.1). The payment's change to
// done and what it buys are one transaction (public.pay), so a failure part way changes nothing
// and the provider's retry of the webhook applies it all; a retry after that finishes what
// follows (settle).
type Grants = { details?: Details; subscription?: { from?: string; paid_until?: string; plan?: SubPlan; cycle?: Cycle }; activate?: string[] };
async function paid(admin: Admin, id: string, ref?: string) {
  const { data: payment } = await admin.from("payments").select("*").eq("id", id).neq("kind", "refund").maybeSingle();
  if (!payment || payment.status === "cancelled") return landedAfterMoneyBack(admin, id, ref);
  if (payment.status === "done") return settle(admin, payment);
  const firmId = payment.firm_id;
  const details = detailsOf(payment);
  const { data: sub } = await admin.from("subscriptions").select("*").eq("firm_id", firmId).maybeSingle();
  const today = indiaDay(new Date());
  const email = await ownerOf(admin, firmId);
  const stale = !!sub && !!details.basis && payment.kind !== "renewal" && details.basis !== basisOf(sub);
  // A plan change priced on what has changed since is not applied: it goes back in full (settle).
  let grants: Grants = stale ? { details: { ...details, stale: true } } : {};
  let grown = false;
  if (sub) {
    const plan = planOf(sub);
    if (payment.kind === "plan") {
      const period: [string, string] = [today, periodEnd(today, sub.cycle as Cycle)];
      grants = { details: { ...details, period, lines: withPeriod(details.lines, period) }, subscription: { paid_until: period[1] }, activate: ["pending"] };
    }
    if (payment.kind === "renewal" && details.period) {
      // The plan it was priced on. A move down set after it was raised waits for the next renewal; a
      // plan grown since (a move up, a person or an AI block paid in between) stays, never shrunk.
      grown = !!details.priced && details.priced !== basisOf(sub);
      const rest = { ...plan, next: grown || (details.basis !== undefined && details.basis !== waitingOf(plan)) ? plan.next : undefined };
      grants = { subscription: { from: details.period[0], paid_until: details.period[1], plan: details.plan && !grown ? { ...rest, ...details.plan } : rest }, activate: ["grace", "read_only"] };
    }
    if (!stale && payment.kind === "upgrade" && details.plan) grants = { subscription: { plan: { ...plan, ...details.plan } } };
    if (!stale && payment.kind === "yearly" && details.period) grants = { subscription: { cycle: "yearly", paid_until: details.period[1] } };
    if (!stale && payment.kind === "extra_user") grants = { subscription: { plan: { ...plan, people: Math.max(plan.people, details.base ?? 0) + (details.add ?? 1) } } };
    if (!stale && payment.kind === "ai_block") grants = { subscription: { plan: { ...plan, aiBlocks: (plan.aiBlocks ?? 0) + (details.add ?? 1) } } };
  }
  const { data, error } = await admin.rpc("pay", { payment_id: id, grants: json(grants), ...(ref && { ref }) });
  if (error) throw new Error(`Recording a payment failed: ${error.code}`);
  // Null: another delivery of the same webhook recorded it first.
  const done = data as { moved: boolean; started: string | null } | null;
  if (!done) return;
  if (done.started) await mail(email, `InboxCA is ready for ${done.started}`, [`Your first payment is in and ${done.started} is ready on InboxCA.`, `Sign in to start: ${link("/sign-in")}`, `Changed your mind? Cancel by ${long(moneyBackLastDay(today))} in Settings, Billing and get this payment back in full.`]);
  if (sub && payment.kind === "renewal" && details.period) {
    if (!done.moved) await alertAdmins(admin, "paid_twice", id);
    else {
      // Any other debit raised for the same period is called off.
      const { data: others } = await admin.from("payments").update({ status: "cancelled" }).eq("firm_id", firmId).eq("kind", "renewal").eq("status", "created").eq("details->period->>0", details.period[0]).select("id, details");
      for (const other of others ?? []) if (sub.mandate && detailsOf(other as Payment).via === "charge") await billingProvider()?.cancelCharge({ mandate: sub.mandate, id: other.id }).catch(() => log.warn("billing.charge_cancel_failed"));
      // What was added after it was raised; the admins collect it when it cannot be saved.
      if (grown && details.plan) await addedSince(admin, { ...sub, paid_until: details.period[1] }, details.plan).catch(() => alertAdmins(admin, "added_above_limit", firmId));
    }
  }
  await note(admin, firmId, null, "billing.paid", { payment: id, kind: payment.kind });
  await settle(admin, { ...payment, status: "done", provider_ref: ref ?? null, details: json(grants.details ?? details) });
}

// What follows a payment, on every delivery of its webhook until it is all done: its receipt or
// invoice, and the full refund of a plan change priced on a plan that changed since.
async function settle(admin: Admin, payment: Payment) {
  await issue(admin, payment.id);
  const provider = billingProvider();
  if (!detailsOf(payment).stale || !provider) return;
  const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("refund_of", payment.id);
  if (count) return;
  const { data: sub } = await admin.from("subscriptions").select("mandate, method").eq("firm_id", payment.firm_id).maybeSingle();
  await note(admin, payment.firm_id, null, "billing.refund_asked", { payment: (await refund(admin, provider, payment, payment.amount_paise, "priced_on_old_plan", sub)) ?? undefined, reason: "priced_on_old_plan" });
}

// A debit or order the money back called off that is taken all the same (D33): it is recorded
// with its receipt or invoice, adds nothing, and goes back in full with the money back's credit
// note or refund receipt.
async function landedAfterMoneyBack(admin: Admin, id: string, ref?: string) {
  const provider = billingProvider();
  const { data: called } = await admin.from("payments").select("firm_id").eq("id", id).eq("status", "cancelled").neq("kind", "refund").maybeSingle();
  if (!called || !provider || !["refunding", "refunded"].includes((await moneyBack(called.firm_id, indiaDay(new Date()), admin)).state)) return;
  const { data: landed } = await admin.from("payments").update({ status: "done", provider_ref: ref ?? null }).eq("id", id).eq("status", "cancelled").select("*").maybeSingle();
  if (!landed) return;
  await note(admin, landed.firm_id, null, "billing.paid", { payment: id, kind: landed.kind });
  await issue(admin, id);
  const { data: sub } = await admin.from("subscriptions").select("mandate, method").eq("firm_id", landed.firm_id).maybeSingle();
  await refund(admin, provider, landed, landed.amount_paise, "money_back", sub);
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
  // A move to a bigger plan in the 14 days, chosen or automatic, or to yearly payment, goes back
  // with the plan; a move still being debited was called off with AutoPay, and goes back if it is
  // taken all the same.
  const back = window.rows.filter((row) => row.status === "done" && ["plan", "upgrade", "yearly", "extra_user", "ai_block", "topup"].includes(row.kind) && indiaDay(new Date(row.created_at)) <= window.lastDay);
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

async function refund(admin: Admin, provider: PaymentProvider, of: Payment, amount: number, reason: "money_back" | "duplicate" | "charge_error" | "priced_on_old_plan", sub?: { mandate: string | null; method: string | null } | null) {
  if (amount <= 0) return null;
  const gst = Math.round((of.gst_paise * amount) / of.amount_paise);
  const { data: row, error } = await admin.from("payments").insert({ firm_id: of.firm_id, kind: "refund", refund_of: of.id, reason, amount_paise: amount, gst_paise: gst, details: json({ lines: [], via: detailsOf(of).via } satisfies Details) }).select("*").single();
  if (error) throw new Error(`Saving the refund failed: ${error.code}`);
  if ((await sendRefund(admin, provider, row, of, sub)) === false)
    await admin.from("jobs").insert({ firm_id: row.firm_id, kind: "billing_refund", entity_type: "payment", entity_id: row.id, run_at: new Date(Date.now() + 3_600_000).toISOString(), idempotency_key: `billing_refund:${row.id}:unsure` });
  return row.id;
}

// A refund asked of the provider with its own id as the idempotency key. One turned down has
// failed (refundFailed tries again with a new id). One whose answer was lost stays created and
// unsure, the admins are told, and it is asked again with the same id (retryRefund): false then.
async function sendRefund(admin: Admin, provider: PaymentProvider, row: Payment, of: Payment, sub?: { mandate: string | null; method: string | null } | null) {
  const details = detailsOf(row);
  try {
    await provider.refund({ id: row.id, of: { id: of.id, ref: of.provider_ref, kind: detailsOf(of).via, mandate: detailsOf(of).mandate ?? sub?.mandate ?? null, method: (sub?.method as Method | null) ?? null }, paise: row.amount_paise, note: row.reason === "money_back" ? "InboxCA money back" : "InboxCA refund" });
  } catch (problem) {
    if ((problem as { refused?: boolean }).refused) return void (await refundFailed(admin, row.id));
    await admin.from("payments").update({ details: json({ ...details, unsure: true }) }).eq("id", row.id);
    await alertAdmins(admin, "refund_unsure", row.id);
    return false;
  }
  if (details.unsure) await admin.from("payments").update({ details: json({ ...details, unsure: undefined }) }).eq("id", row.id);
  return true;
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
// that only the admin alert stays. An unsure one is asked again with its own id: false while it
// stays unsure, for the job to try again.
export async function retryRefund(id: string) {
  const admin = supabaseAdmin();
  const provider = billingProvider();
  const { data: failedRow } = await admin.from("payments").select("*").eq("id", id).eq("kind", "refund").in("status", ["created", "failed"]).maybeSingle();
  if (!failedRow || !provider) return;
  if (failedRow.status === "created") {
    const [{ data: of }, { data: sub }] = await Promise.all([admin.from("payments").select("*").eq("id", failedRow.refund_of!).single(), admin.from("subscriptions").select("mandate, method").eq("firm_id", failedRow.firm_id).maybeSingle()]);
    return detailsOf(failedRow).unsure && of ? sendRefund(admin, provider, failedRow, of, sub) : undefined;
  }
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
  if (sub?.status === "active" && sub.mandate) await raiseAgain(admin, provider, firm, sub, now);
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
    const next = await renewalPlan(admin, firmId, formula, sub, today);
    const period: [string, string] = [due, periodEnd(due, sub.cycle as Cycle)];
    const priced = quote(formula, tax, firm.stateCode, next, sub.cycle as Cycle, due < today ? today : due);
    if (priced.recurring.total > plan.maxPaise) {
      await mail(email, "InboxCA: approve your new AutoPay limit", [`Your plan now costs ${rupees(priced.recurring.total)}, more than the ${rupees(plan.maxPaise)} your AutoPay allows. Approve the new limit once in Settings, Billing, or pay now: ${link(BILLING)}`]);
    } else {
      const at = new Date(Math.max(Date.parse(`${due}T10:00:00+05:30`), now.getTime() + NOTICE_MS));
      const { data: row, error } = await admin.from("payments").insert({ firm_id: firmId, kind: "renewal", amount_paise: priced.recurring.total, gst_paise: priced.recurring.gst, due_at: at.toISOString(), details: json({ lines: withPeriod(priced.price.lines, period), via: "charge", period, plan: next, basis: waitingOf(plan), priced: basisOf(sub) } satisfies Details) }).select("*").single();
      if (error) throw new Error(`Saving the renewal failed: ${error.code}`);
      await raise(admin, provider, sub.mandate, row);
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
  if (firm.status === "active") await fitDay(admin, provider, formula, tax, firm, sub, email, now);
  if (firm.status === "active") await downDay(admin, formula, tax, firm, sub, email, today);
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

// The daily run's second try at debits that did not reach the provider. One whose answer was lost
// is raised again with the same id and date (raise), so it is never taken twice. A pending firm's
// first eNACH debit that was turned down is raised again as a new one after the notice, at most 3
// times. Orelu's own notice goes once each is raised.
async function raiseAgain(admin: Admin, provider: PaymentProvider, firm: Firm, sub: Subscription, now: Date) {
  const { data: open } = await admin.from("payments").select("*").eq("firm_id", firm.id).eq("status", "created").eq("details->>via", "charge");
  const again = (open ?? []).filter((row) => detailsOf(row).unsure);
  if (firm.status === "pending" && !open?.some((row) => row.kind === "plan")) {
    const { data: refused } = await admin.from("payments").select("*").eq("firm_id", firm.id).eq("kind", "plan").eq("status", "cancelled").eq("details->>mandate", sub.mandate!).order("created_at");
    const first = refused?.at(-1);
    if (first && refused!.length < 3) {
      const { data: row, error } = await admin.from("payments").insert({ firm_id: firm.id, kind: "plan", amount_paise: first.amount_paise, gst_paise: first.gst_paise, due_at: new Date(now.getTime() + NOTICE_MS).toISOString(), details: json({ ...detailsOf(first), unsure: undefined }) }).select("*").single();
      if (error) throw new Error(`Saving the first debit failed: ${error.code}`);
      again.push(row);
    }
  }
  const email = again.length ? await ownerOf(admin, firm.id) : null;
  for (const row of again) {
    try {
      await raise(admin, provider, sub.mandate!, row);
    } catch {
      continue;
    }
    const at = new Date(row.due_at!);
    await note(admin, firm.id, null, row.kind === "renewal" ? "billing.renewal_raised" : "billing.order_started", row.kind === "renewal" ? { payment: row.id } : { payment: row.id, kind: row.kind });
    // Orelu's own notice, as for a renewal (RBI E-mandate Framework 2026, para 6).
    await mail(email, `InboxCA: ${rupees(row.amount_paise)} will be taken on ${long(indiaDay(at))}`, [
      `Orelu (InboxCA) will take ${rupees(row.amount_paise)} from your ${methodWords[sub.method as Method]} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })}, for ${firm.name}: ${remarks(row)}.`,
      `AutoPay reference: ${sub.mandate}.`,
      `To stop it, turn AutoPay off in Settings, Billing before then: ${link(BILLING)}`,
    ]);
  }
}

// The plan fit, in the daily run (5.14, D38). The owner is told once a year for each measure that
// reaches 80% of the plan or is on course to pass it. With plan_formula.fitEnforced on (off until
// the plan sizes are measured), a firm past its plan and its growth cushion moves to the plan that
// fits: the difference for the rest of the period is debited on the mandate after Orelu's notice
// 3 days before, taken before the next renewal is raised, and never above the mandate's maximum.
// Above it the owner approves once, by paying the same amount in Settings, Billing. A monthly payer
// whose year fits its plan is offered yearly payment instead, and is never moved up.
async function fitDay(admin: Admin, provider: PaymentProvider, formula: PlanFormula, tax: Tax | null, firm: Firm, sub: Subscription, email: string | null, now: Date) {
  const today = indiaDay(now);
  const fit = await fitOf(admin, firm.id, formula, sub, today);
  if (!fit?.notice) return;
  const cycle = sub.cycle as Cycle;
  const plan = planOf(sub);
  const current = planPrice(formula, plan, cycle);
  const moved = planPrice(formula, fit.next, cycle);
  const per = `${cycle === "monthly" ? "a month" : "a year"}${gstOn(tax, today) ? " with GST" : ""}`;
  const year = financialYear(today);
  const yearly = fit.yearly && toYearly(formula, plan, today, sub.paid_until!);
  for (const measure of fit.measures.filter((m) => m.notice)) {
    // Once a year for each measure: the row is the record that the owner was told.
    const { data: first } = await admin.from("requests").upsert({ firm_id: firm.id, kind: "alert", entity_type: `plan_fit_${measure.measure}_${year}`, entity_id: firm.id, reason_code: "plan_upgrade_suggested", status: "done" }, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true }).select("id");
    if (!first?.length) continue;
    const figure = (value: number) => (measure.measure === "returns" ? `${Math.round(value).toLocaleString("en-IN")} returns` : `${(value / GB).toFixed(1)} GB of InboxCA storage`);
    await mail(email, `InboxCA: ${firm.name} is close to its plan's ${measure.measure === "returns" ? "returns" : "InboxCA storage"}`, [
      `${firm.name} has ${figure(measure.used)} ${measure.measure === "returns" ? "due so far" : "used"} this year, ${Math.round((100 * measure.used) / measure.earned)}% of the ${figure(measure.earned)} its ${current.name} plan gives ${cycle === "monthly" ? "by this month, as a plan paid monthly gives a twelfth of the year each month" : "a year"}. At this pace it reaches about ${figure(measure.byMarch)} by March.`,
      ...(yearly ? [
        `Its year still fits the ${current.name} plan, so it needs no bigger plan. Paid yearly, the plan gives the whole year's returns and InboxCA storage at once: ${rupees(withGst(yearly.paise, tax, firm.stateCode, today).total)}${gstOn(tax, today) ? " with GST" : ""} now pays for the plan until ${long(addDays(yearly.until, -1))}, less what is left of the month paid.`,
        `Switch to yearly payment in Settings, Billing: ${link(BILLING)}`,
      ] : [
        `The ${moved.name} plan fits your firm's work: ${rupees(withGst(moved.paise, tax, firm.stateCode, today).total)} ${per}.`,
        formula.fitEnforced ? "When your firm passes its plan, InboxCA moves it to the plan that fits and takes the difference for the rest of the period, with a notice 3 days before." : "Nothing changes until you choose.",
        `Move up in Settings, Billing: ${link(BILLING)}`,
      ]),
    ]);
  }
  if (yearly || !formula.fitEnforced || !fit.over || moved.paise <= current.paise || sub.status !== "active" || !sub.mandate || !sub.paid_until || sub.paid_until <= addDays(today, 6)) return;
  // Not again within a week of a move raised, ordered or failed.
  const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("firm_id", firm.id).in("kind", ["upgrade", "yearly"]).in("status", ["created", "failed"]).gte("created_at", new Date(now.getTime() - 7 * 86_400_000).toISOString());
  if (count) return;
  const until = addDays(sub.paid_until, -1);
  const lines = [{ text: `Move to the ${moved.name} plan, ${long(today)} to ${long(until)}`, paise: prorate(moved.paise - current.paise, today, sub.paid_until, cycle) }];
  const amount = withGst(lines[0].paise, tax, firm.stateCode, today);
  if (amount.total > plan.maxPaise) {
    const { data: asked } = await admin.from("requests").update({ details: json({ approve: today }) }).eq("kind", "alert").eq("entity_id", firm.id).like("entity_type", `plan_fit_%_${year}`).is("details->approve", null).select("id");
    if (asked?.length) await mail(email, "InboxCA: approve the move to a bigger plan", [`${firm.name}'s work has passed its ${current.name} plan. The ${moved.name} plan costs ${rupees(amount.total)} more for the rest of this period, above the ${rupees(plan.maxPaise)} your AutoPay allows, so InboxCA needs your OK once.`, `Pay it in Settings, Billing: ${link(BILLING)}`, "Your work, filings and reminders carry on meanwhile."]);
    return;
  }
  const at = new Date(now.getTime() + 3 * 86_400_000);
  const { data: row, error } = await admin.from("payments").insert({ firm_id: firm.id, kind: "upgrade", amount_paise: amount.total, gst_paise: amount.gst, due_at: at.toISOString(), details: json({ lines, via: "charge", plan: fit.next, basis: basisOf(sub) } satisfies Details) }).select("*").single();
  if (error) throw new Error(`Saving the move up failed: ${error.code}`);
  await raise(admin, provider, sub.mandate, row);
  await note(admin, firm.id, null, "billing.moved_up", { payment: row.id });
  // Orelu's own notice, as for a renewal (RBI E-mandate Framework 2026, para 6).
  await mail(email, `InboxCA: ${rupees(amount.total)} will be taken on ${long(indiaDay(at))}`, [
    `${firm.name}'s work has passed its ${current.name} plan, so it moves to the ${moved.name} plan, ${rupees(withGst(moved.paise, tax, firm.stateCode, today).total)} ${per}. Orelu (InboxCA) will take ${rupees(amount.total)} from your ${methodWords[sub.method as Method]} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })}, the difference for ${long(today)} to ${long(until)}.`,
    `AutoPay reference: ${sub.mandate}.`,
    `To stop it, turn AutoPay off in Settings, Billing before then: ${link(BILLING)}`,
  ]);
}

// The move down, emailed once for each renewal that starts a new plan year (5.14); the owner's card
// on Today and in Settings, Billing offers the same plan and price.
async function downDay(admin: Admin, formula: PlanFormula, tax: Tax | null, firm: Firm, sub: Subscription, email: string | null, today: string) {
  const down = await moveDownFit(admin, firm.id, formula, sub, today);
  if (!down) return;
  const { data: first } = await admin.from("requests").upsert({ firm_id: firm.id, kind: "alert", entity_type: `plan_down_${down.on}`, entity_id: firm.id, reason_code: "plan_down_suggested", status: "done" }, { onConflict: "kind,entity_type,entity_id", ignoreDuplicates: true }).select("id");
  if (!first?.length) return;
  const cycle = sub.cycle as Cycle;
  const [now, then] = [planPrice(formula, planOf(sub), cycle), planPrice(formula, down.plan, cycle)];
  const price = (paise: number) => `${rupees(withGst(paise, tax, firm.stateCode, down.on).total)} ${cycle === "monthly" ? "a month" : "a year"}${gstOn(tax, down.on) ? " with GST" : ""}`;
  await mail(email, `InboxCA: ${firm.name} fits a smaller plan`, [
    `${firm.name}'s work this year fits the ${then.name} plan, ${price(then.paise)}, in place of the ${now.name} plan, ${price(now.paise)}.`,
    `To move down at your renewal on ${long(down.on)}, choose Move down in Settings, Billing by ${long(addDays(down.on, -4))}: ${link(BILLING)}`,
    "Nothing changes unless you choose.",
  ]);
}

// What a plan grown after its renewal was raised added, for the new period: pro-rated as a move up,
// with GST, debited on the mandate after the notice and within its maximum. Above it, or with
// AutoPay off, the owner is asked to approve a new limit and Orelu's admins collect it.
async function addedSince(admin: Admin, sub: Subscription, priced: FirmPlan) {
  const [provider, { formula, tax }, firm, email] = [billingProvider(), await billingSettings(admin), await firmOf(admin, sub.firm_id), await ownerOf(admin, sub.firm_id)];
  if (!provider || !formula || !firm || !sub.paid_until) return;
  const cycle = sub.cycle as Cycle;
  const today = indiaDay(new Date());
  const now = planPrice(formula, planOf(sub), cycle);
  const lines = [{ text: `Added to your ${now.name} plan, ${long(today)} to ${long(addDays(sub.paid_until, -1))}`, paise: prorate(now.paise - planPrice(formula, priced, cycle).paise, today, sub.paid_until, cycle) }];
  if (lines[0].paise <= 0) return;
  const amount = withGst(lines[0].paise, tax, firm.stateCode, today);
  if (sub.status !== "active" || !sub.mandate || amount.total > planOf(sub).maxPaise) {
    await alertAdmins(admin, "added_above_limit", sub.firm_id);
    return void (await mail(email, "InboxCA: approve your new AutoPay limit", [`${firm.name}'s plan grew after its renewal was raised. What was added costs ${rupees(amount.total)} for ${long(today)} to ${long(addDays(sub.paid_until, -1))}, more than your AutoPay allows. Approve the new limit once in Settings, Billing: ${link(BILLING)}`]));
  }
  const at = new Date(Date.now() + NOTICE_MS);
  const { data: row, error } = await admin.from("payments").insert({ firm_id: sub.firm_id, kind: "upgrade", amount_paise: amount.total, gst_paise: amount.gst, due_at: at.toISOString(), details: json({ lines, via: "charge" } satisfies Details) }).select("*").single();
  if (error) throw new Error(`Saving what was added failed: ${error.code}`);
  try {
    await raise(admin, provider, sub.mandate, row);
  } catch (problem) {
    // Turned down: the admins collect it. Unsure: the daily run raises it again (raiseAgain).
    if ((problem as { refused?: boolean }).refused) await alertAdmins(admin, "added_above_limit", sub.firm_id);
    return;
  }
  await note(admin, sub.firm_id, null, "billing.moved_up", { payment: row.id });
  // Orelu's own notice, as for a renewal (RBI E-mandate Framework 2026, para 6).
  await mail(email, `InboxCA: ${rupees(amount.total)} will be taken on ${long(indiaDay(at))}`, [
    `Orelu (InboxCA) will take ${rupees(amount.total)} from your ${methodWords[sub.method as Method]} on ${at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })}, for what was added to ${firm.name}'s plan after its renewal was raised: ${lines[0].text}.`,
    `AutoPay reference: ${sub.mandate}.`,
    `To stop it, turn AutoPay off in Settings, Billing before then: ${link(BILLING)}`,
  ]);
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
