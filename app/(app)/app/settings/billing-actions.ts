"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { approveLimit, buy, claimMoneyBack, setAutoTopUp, setDowngrade, startAutoPay, stopAutoPay, type Buy } from "@/src/lib/billing/billing";
import { planSchema, type Method } from "@/src/lib/billing/money";
import { billingProvider } from "@/src/lib/billing/provider";
import { currentMember } from "@/src/lib/member";
import { withinLimit } from "@/src/lib/rate-limit";
import { supabaseServer } from "@/src/lib/supabase";

// The owner's billing (PLAN.md 5.14.1). Each action is the owner's alone and works while the firm
// is read only, so a plan can always be paid; amounts are worked out on the server only.
export type CheckoutState = { error?: string; session?: string; kind?: "mandate" | "order"; script?: string; mode?: string };

async function owner() {
  const { userId, membership } = await currentMember();
  if (membership?.role !== "owner") return null;
  return { userId, firmId: membership.firmId };
}
const returnUrl = async () => `${(await headers()).get("origin") ?? process.env.APP_BASE_URL ?? ""}/api/billing/return`;
const planIn = (form: FormData) => planSchema.safeParse({ clients: Number(form.get("clients")), practice: form.get("practice"), people: Number(form.get("people")), aiBlocks: 0 });
const opened = (checkout: { session: string; kind: "mandate" | "order" } | { error: string }): CheckoutState => {
  if ("error" in checkout) return { error: checkout.error };
  const provider = billingProvider()!;
  return { ...checkout, script: provider.script, mode: provider.mode };
};

// Sign up's last step, or AutoPay turned on again: the plan, the way to pay, and the details
// receipts and invoices need.
export async function startCheckout(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const me = await owner();
  if (!me) return { error: "Only the owner sets up AutoPay." };
  const method = z.enum(["upi", "card", "enach"]).safeParse(form.get("method"));
  if (!method.success) return { error: "Choose how to pay." };
  const again = form.get("again") === "yes";
  const plan = planIn(form);
  if (!again && !plan.success) return { error: "Enter your clients, kind of practice and team size." };
  const phone = String(form.get("phone") ?? "").replace(/\D/g, "").slice(-10);
  const address = String(form.get("address") ?? "").trim();
  const gstin = String(form.get("gstin") ?? "").trim().toUpperCase();
  if (!again && (address.length < 5 || address.length > 300)) return { error: "Enter your firm's address, as it should show on receipts." };
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return { error: "Check the GSTIN: 15 letters and numbers, or leave it empty." };
  const cycle = form.get("cycle") === "yearly" ? "yearly" : "monthly";
  return opened(await startAutoPay(me.firmId, me.userId, {
    method: method.data as Method, returnUrl: await returnUrl(),
    ...(!again && { plan: plan.data, cycle, address, phone, ...(gstin && { gstin }) }),
    ...(again && phone && { phone }),
  }));
}

// A one time payment: pay now, move up, one more person, one more AI block, an AI top-up.
export async function buyCheckout(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const me = await owner();
  if (!me) return { error: "Only the owner pays for the plan." };
  const kind = z.enum(["renewal", "upgrade", "extra_user", "ai_block", "topup"]).safeParse(form.get("kind"));
  if (!kind.success) return { error: "Choose what to pay for." };
  let what: Buy;
  if (kind.data === "upgrade") {
    const plan = planIn(form);
    if (!plan.success) return { error: "Enter your clients, kind of practice and team size." };
    what = { kind: "upgrade", plan: { ...plan.data, aiBlocks: Number(form.get("aiBlocks")) || 0 } };
  } else what = { kind: kind.data };
  return opened(await buy(me.firmId, me.userId, what, await returnUrl()));
}

export async function approveCheckout(): Promise<CheckoutState> {
  const me = await owner();
  if (!me) return { error: "Only the owner approves AutoPay." };
  return opened(await approveLimit(me.firmId, me.userId, await returnUrl()));
}

export async function turnOffAutoPay() {
  const me = await owner();
  if (!me) redirect("/app");
  await stopAutoPay(me.firmId, me.userId, "owner");
  redirect("/app/settings?group=billing&saved=autopay_off");
}

// A smaller plan from the next renewal, or that change taken back.
export async function moveDown(form: FormData) {
  const me = await owner();
  if (!me) redirect("/app");
  const plan = form.get("undo") === "yes" ? null : planIn(form);
  if (plan && !plan.success) redirect("/app/settings?group=billing&error=plan#change");
  const problem = await setDowngrade(me.firmId, me.userId, plan ? { ...plan.data!, aiBlocks: Number(form.get("aiBlocks")) || 0 } : null);
  if (problem) redirect("/app/settings?group=billing&error=down#change");
  redirect(`/app/settings?group=billing&saved=${plan ? "down" : "down_undone"}`);
}

export async function saveAutoTopUp(form: FormData) {
  const me = await owner();
  if (!me) redirect("/app");
  await setAutoTopUp(me.firmId, Math.max(0, Math.min(25, Number(form.get("blocks")) || 0)), me.userId);
  revalidatePath("/app/settings");
  redirect("/app/settings?group=billing&saved=topup#addons");
}

// Cancel and get my money back (D33): the owner confirms with the 2 step code, then the server
// checks the window and the once per firm rule and gives the money back.
export type MoneyBackState = { error?: string };
export async function moneyBackAction(_prev: MoneyBackState, form: FormData): Promise<MoneyBackState> {
  const me = await owner();
  if (!me) return { error: "Only the owner can cancel the plan." };
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6 digit code from your authenticator app." };
  if (!(await withinLimit("twoStep", me.userId))) return { error: "Too many tries. Wait an hour, then try again." };
  const supabase = await supabaseServer();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  const { error } = factor ? await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code }) : { error: true };
  if (error) return { error: "That code did not work. Codes change every 30 seconds; try the new one." };
  const problem = await claimMoneyBack(me.firmId, me.userId);
  if (problem) return { error: problem };
  redirect("/app/settings?group=billing&saved=money_back");
}
