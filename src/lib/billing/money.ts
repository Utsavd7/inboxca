import { z } from "zod";
import { estimate, type Formula, type Practice } from "@/src/lib/estimate";

// Orelu's own charges to firms (PLAN.md 5.14, 5.14.1, D32): every amount the server debits,
// worked out from platform_settings.plan_formula and platform_settings.tax only. Pure
// functions, so the sign up step, the Billing page, renewals and every receipt agree. Money
// is in paise; the formula's prices are rupees a month or a year before GST, as the business
// plan writes them.

const slabs = z.array(z.tuple([z.number().positive().nullable().transform((upTo) => upTo ?? Infinity), z.number().nonnegative()]));
export const formulaSchema = z.object({
  version: z.number().int().positive(),
  plans: z.array(z.object({ code: z.string(), name: z.string(), monthly: z.number().int().positive(), yearly: z.number().int().positive(), maxReturns: z.number().int().positive(), people: z.number().int().positive(), aiCredits: z.number().int().positive(), blockCap: z.number().int().nonnegative() })).min(1),
  practices: z.array(z.tuple([z.enum(["salaried", "mixed", "gst"]), z.string(), z.number().positive()])),
  extraPerson: z.number().int().positive(),
  custom: z.object({ base: z.number(), floor: z.number(), ending: z.number(), returnsPerStep: z.number(), includedSteps: z.number(), includedPeople: z.number(), aiCredits: z.number(), aiPerStep: z.number(), yearlyMonths: z.number().int().positive(), yearlyAdd: z.number(), workSlabs: slabs, peopleSlabs: slabs, blockShare: z.number().min(0).max(1) }),
  aiBlock: z.object({ credits: z.number().int().positive(), price: z.number().int().positive() }),
  // The one time setup fee by plan code, in rupees; empty until the business plan sets it.
  setup: z.record(z.string(), z.number().int().positive()).default({}),
  growthCushion: z.number().min(0).max(1),
  fitEnforced: z.boolean(),
});
export type PlanFormula = z.infer<typeof formulaSchema>;

// What a firm's plan is made of: its two answers and its team, as at sign up (5.14), the
// AI blocks bought every month, and the work the meters moved it up to (returns a year).
export const planSchema = z.object({
  clients: z.number().int().min(1).max(100_000),
  practice: z.enum(["salaried", "mixed", "gst"]),
  people: z.number().int().min(1).max(1000),
  aiBlocks: z.number().int().min(0).default(0),
  returns: z.number().int().min(0).optional(),
});
export type FirmPlan = z.infer<typeof planSchema>;
export type Cycle = "monthly" | "yearly";
export type Method = "upi" | "card" | "enach";

const paise = (rupees: number) => Math.round(rupees * 100);

// The plan a firm's answers name and its price before GST for one cycle, line by line. Extra
// people and AI blocks on a yearly plan join it at the yearly multiple (5.14).
export function planPrice(formula: PlanFormula, plan: FirmPlan, cycle: Cycle) {
  const fit = estimate(plan.clients, plan.practice as Practice, plan.people, formula as unknown as Formula, plan.returns);
  const months = cycle === "monthly" ? 1 : formula.custom.yearlyMonths;
  const preset = fit.custom ? null : formula.plans[fit.index];
  const name = preset?.name ?? "Custom";
  const cap = preset ? preset.blockCap : Math.floor((formula.custom.blockShare * (fit.aiCredits ?? 0)) / formula.aiBlock.credits);
  const lines = [{ text: `InboxCA ${name} plan, ${cycle}`, paise: paise(cycle === "monthly" ? fit.monthly : fit.yearly) }];
  if (!fit.custom && fit.extraPeople) lines.push({ text: `${fit.extraPeople} more ${fit.extraPeople === 1 ? "person" : "people"} in the team`, paise: paise(fit.extraCost * months) });
  if (plan.aiBlocks) lines.push({ text: `${plan.aiBlocks} more AI ${plan.aiBlocks === 1 ? "block" : "blocks"} of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits a month`, paise: paise(plan.aiBlocks * formula.aiBlock.price * months) });
  return { code: preset?.code ?? "custom", name, lines, paise: lines.reduce((sum, line) => sum + line.paise, 0), people: preset?.people ?? formula.custom.includedPeople, blockCap: cap, aiCredits: preset?.aiCredits ?? fit.aiCredits ?? 0 };
}

// The plan fit (5.14, D38): the firm's two yearly measures, used so far and projected to March,
// against its plan. A plan's InboxCA storage is its returns at the formula's rate (returnsPerStep
// returns to a GB). Monthly payers earn the year's allowance a twelfth a month, unused amounts
// carried forward within the year; yearly payers have it all at once. The owner is told when a
// measure reaches 80% of what is earned, or its projection passes the plan; the firm is past its
// plan above the growth cushion. The plan that fits takes the projection, or what a monthly payer
// used so far at a full year's pace, and is always bigger than the plan now.
export const GB = 1024 ** 3;
export type Measured = { returns: number; returnsByMarch: number; bytes: number; bytesByMarch: number };
// Months of the April to March year begun by this day: April 1, March 12.
export const monthsBegun = (day: string) => ((Number(day.slice(5, 7)) + 8) % 12) + 1;
export function planFit(formula: PlanFormula, plan: FirmPlan, cycle: Cycle, usage: Measured, day: string) {
  const fit = estimate(plan.clients, plan.practice as Practice, plan.people, formula as unknown as Formula, plan.returns);
  const returns = fit.custom ? fit.storageGb * formula.custom.returnsPerStep : formula.plans[fit.index].maxReturns;
  const share = cycle === "yearly" ? 1 : monthsBegun(day) / 12;
  const measures = ([["returns", usage.returns, usage.returnsByMarch, returns], ["storage", usage.bytes, usage.bytesByMarch, (returns / formula.custom.returnsPerStep) * GB]] as const).map(([measure, used, byMarch, allowance]) => {
    const earned = allowance * share;
    return { measure, used, byMarch, allowance, earned, notice: used >= 0.8 * earned || byMarch > allowance, over: used > earned * (1 + formula.growthCushion), need: (Math.max(byMarch, used / share) / allowance) * returns };
  });
  return { measures, notice: measures.some((m) => m.notice), over: measures.some((m) => m.over), next: { ...plan, returns: Math.ceil(Math.max(returns + 1, ...measures.map((m) => m.need))) } };
}

// Orelu's tax details, from the admin console only (D32): never typed in code. GST is charged
// from gstFrom once a GSTIN, its state, the SAC (HSN for services, CGST rule 46(g)) and the
// rate are all set.
export const taxSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  address: z.string().trim().min(5).max(400),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional(),
  stateCode: z.string().regex(/^[0-9]{2}$/).optional(),
  sac: z.string().regex(/^[0-9]{4,8}$/).optional(),
  rate: z.number().positive().max(28).optional(),
  gstFrom: z.iso.date().optional(),
  // Who signs a credit note for Orelu (CGST rule 53(1A)(i)).
  signatory: z.string().trim().min(2).max(120).optional(),
  // Orelu's turnover across all its products this financial year, entered by the team (D32).
  turnover: z.record(z.string().regex(/^[0-9]{4}-[0-9]{2}$/), z.number().int().nonnegative()).default({}),
});
export type Tax = z.infer<typeof taxSchema>;

// Is a document dated on this day a tax invoice? Only with every GST detail set and from the
// GST start date; before that it is a payment receipt that says Orelu is not GST registered.
export const gstOn = (tax: Tax | null, day: string): tax is Tax & Required<Pick<Tax, "gstin" | "stateCode" | "sac" | "rate" | "gstFrom">> =>
  !!tax?.gstin && !!tax.stateCode && !!tax.sac && !!tax.rate && !!tax.gstFrom && day >= tax.gstFrom;

// GST on a taxable amount: CGST and SGST, half the rate each, when the firm is in Orelu's state;
// IGST at the full rate otherwise (the place of supply is the firm's state).
export function gstSplit(taxablePaise: number, rate: number, sameState: boolean) {
  if (sameState) {
    const half = Math.round((taxablePaise * rate) / 200);
    return { cgst: half, sgst: half, igst: 0, total: half * 2 };
  }
  const igst = Math.round((taxablePaise * rate) / 100);
  return { cgst: 0, sgst: 0, igst, total: igst };
}

// The amount actually debited: the price, with GST from the GST start date.
export function withGst(taxablePaise: number, tax: Tax | null, firmState: string, day: string) {
  if (!gstOn(tax, day)) return { taxable: taxablePaise, gst: 0, total: taxablePaise };
  const { total } = gstSplit(taxablePaise, tax.rate, tax.stateCode === firmState);
  return { taxable: taxablePaise, gst: total, total: taxablePaise + total };
}

// RBI, Digital Payments E-mandate Framework, 2026 (Master Direction, 21 Apr 2026, rbi.org.in id
// 13374): recurring debits up to ₹15,000 a transaction need no additional factor of
// authentication (AFA) after the first (para 8(a)); registration and the first debit need AFA
// (paras 4, 5). Cashfree's Subscriptions FAQ (cashfree.com/docs/payments/subscription/faq, read
// 27 Oct 2026): UPI AutoPay up to ₹15,000 without AFA and ₹1,00,000 with it; eNACH up to
// ₹1,00,00,000.
export const NO_AFA_PAISE = 15_000_00;
export const UPI_MAX_PAISE = 1_00_000_00;
export const ENACH_MAX_PAISE = 1_00_00_000_00;

// The AutoPay methods offered for a debit of this size, the first being the default. Above
// ₹15,000 the bank mandate (eNACH) leads, as card and UPI debits then need the owner's
// approval each time.
export function methodsFor(debitPaise: number): { method: Method; approveEach: boolean }[] {
  if (debitPaise <= NO_AFA_PAISE) return [{ method: "upi", approveEach: false }, { method: "card", approveEach: false }, { method: "enach", approveEach: false }];
  return [
    ...(debitPaise <= ENACH_MAX_PAISE ? [{ method: "enach" as const, approveEach: false }] : []),
    ...(debitPaise <= UPI_MAX_PAISE ? [{ method: "upi" as const, approveEach: true }] : []),
    { method: "card" as const, approveEach: true },
  ];
}

// The mandate's maximum: twice the plan's price (5.14.1 Plan changes), so a plan change or GST
// starting needs no new approval; never above what the method allows.
export const mandateMax = (pricePaise: number, method: Method) => Math.min(2 * pricePaise, method === "upi" ? UPI_MAX_PAISE : ENACH_MAX_PAISE);

// Dates are India dates, YYYY-MM-DD.
export const indiaDay = (at: Date) => at.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export function addMonths(day: string, months: number) {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}
export const periodEnd = (start: string, cycle: Cycle) => addMonths(start, cycle === "monthly" ? 1 : 12);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

// What is left of a price for the rest of a paid period, from today to its end: an upgrade's
// difference and an add-on bought mid period are paid this way, at once (5.14.1).
export function prorate(pricePaise: number, today: string, paidUntil: string, cycle: Cycle) {
  const start = addMonths(paidUntil, cycle === "monthly" ? -1 : -12);
  const left = Math.max(0, Math.min(daysBetween(today, paidUntil), daysBetween(start, paidUntil)));
  return Math.round((pricePaise * left) / daysBetween(start, paidUntil));
}

// After a debit due on paidUntil is not paid: days 0 to 7 everything works with a banner,
// days 8 to 30 the firm is read only, after day 30 it is closed and its data deleted 30 days
// later (5.14.1 Failed payments).
export function overdueState(paidUntil: string, today: string): "active" | "grace" | "read_only" | "closed" {
  const late = daysBetween(paidUntil, today);
  return late < 0 ? "active" : late <= 7 ? "grace" : late <= 30 ? "read_only" : "closed";
}
// Orelu's own retries of a failed eNACH or card debit (Cashfree retries only UPI AutoPay).
export const RETRY_DAYS = [1, 3, 6];

// The money-back window (D33): 14 days from the firm's first successful payment, the last day
// shown as a date.
export const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
export const moneyBackLastDay = (firstPaid: string) => addDays(firstPaid, 14);

// The financial year a day falls in, "2026-27".
export function financialYear(day: string) {
  const [year, month] = day.split("-").map(Number);
  const starts = month >= 4 ? year : year - 1;
  return `${starts}-${String((starts + 1) % 100).padStart(2, "0")}`;
}

// The document a payment or refund makes, and its series. CGST rules 46(b) and 53(1A)(c): a
// consecutive serial number of at most sixteen characters (letters, numbers, "-" and "/"),
// unique for a financial year.
export const series = { receipt: "RCT", invoice: "INV", credit: "CN", refund: "RFD" } as const;
export type DocKind = keyof typeof series;
export function serialNumber(kind: DocKind, day: string, n: number) {
  const number = `${series[kind]}/${financialYear(day).slice(2)}/${String(n).padStart(5, "0")}`;
  if (!/^[A-Z0-9/-]{1,16}$/.test(number)) throw new Error("A serial number is at most 16 characters");
  return number;
}
export const rupees = (amountPaise: number) => `₹${(amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: amountPaise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
