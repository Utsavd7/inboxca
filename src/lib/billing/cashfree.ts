import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Method } from "./money";
import type { PaymentProvider, Settled } from "./provider";

// Cashfree Payment Gateway, read on 27 Oct 2026 at cashfree.com/docs (api-reference/payments/
// latest and payments/subscription):
// - Base https://sandbox.cashfree.com/pg or https://api.cashfree.com/pg; headers x-client-id,
//   x-client-secret, x-api-version, and x-idempotency-key on every write (a replay with the
//   same key returns the first answer). Amounts are rupees.
// - Subscriptions, On-Demand: one plan with plan_max_amount (POST /plans), one subscription per
//   mandate (POST /subscriptions) opened in checkout with its subscription_session_id; each
//   debit is POST /subscriptions/pay (payment_type CHARGE), and Cashfree sends the pre-debit
//   notice itself, which needs 25 hours before the debit (subscription FAQ). eNACH takes no
//   amount at authorisation (authorization_amount "always be 0 for ENACH"), so its first debit
//   is raised once the mandate is ACTIVE.
// - Orders (POST /orders) for one time payments, paid in checkout with payment_session_id;
//   refunds POST /orders/{id}/refunds and POST /subscriptions/{id}/refunds (UPI only STANDARD,
//   eNACH only INSTANT); cancelling is POST /subscriptions/{id}/manage, action CANCEL.
// - Webhooks: x-webhook-signature = Base64(HMAC-SHA256(x-webhook-timestamp + raw body, client
//   secret)); no event id in the body, but x-idempotency-key is "unique for each unique webhook
//   payload". A cancel in the payer's bank or UPI app arrives as SUBSCRIPTION_STATUS_CHANGED with
//   CUSTOMER_CANCELLED.
// - Reconciliation: POST /recon, each payment and refund with its service charge, tax and
//   settlement date.
const VERSION = "2025-01-01";
const rupees = (paise: number) => Math.round(paise) / 100;
const paise = (amount: unknown) => Math.round(Number(amount ?? 0) * 100);

// Tests point it at a fake on this machine (as Dropbox's), never in a deployment.
const base = () => (process.env.MAIL_ALLOW_LOCAL === "1" && process.env.CASHFREE_TEST_URL ? process.env.CASHFREE_TEST_URL : process.env.CASHFREE_ENV === "production" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com");

async function call(path: string, body: unknown, idempotency?: string, method = "POST") {
  const response = await fetch(`${base()}/pg${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-client-id": process.env.CASHFREE_APP_ID ?? "",
      "x-client-secret": process.env.CASHFREE_SECRET_KEY ?? "",
      "x-api-version": VERSION,
      ...(idempotency && { "x-idempotency-key": idempotency }),
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  // The code and status only: an answer may name the customer.
  const code = String(answer.code ?? "error").slice(0, 40);
  if (!response.ok) throw new Error(`cashfree_${response.status}_${code}`);
  return answer;
}

const methodOf = (details: { payment_method?: Record<string, unknown> | null; payment_group?: string | null } | undefined): Method | undefined => {
  const named = [...Object.keys(details?.payment_method ?? {}), details?.payment_group ?? ""].join(" ");
  return /enach|pnach|nach/.test(named) ? "enach" : /upi/.test(named) ? "upi" : /card/.test(named) ? "card" : undefined;
};

const hook = z.object({
  type: z.string(),
  data: z.object({
    subscription_details: z.object({ subscription_id: z.string(), subscription_status: z.string() }).partial().optional(),
    authorization_details: z.object({ payment_id: z.string().nullable(), payment_group: z.string().nullable(), payment_method: z.record(z.string(), z.unknown()).nullable() }).partial().optional(),
    payment_id: z.string().optional(),
    cf_payment_id: z.union([z.string(), z.number()]).optional(),
    payment_type: z.string().optional(),
    failure_details: z.object({ failure_reason: z.string().nullable() }).partial().nullable().optional(),
    order: z.object({ order_id: z.string() }).partial().optional(),
    payment: z.object({ cf_payment_id: z.union([z.string(), z.number()]), payment_status: z.string() }).partial().optional(),
    error_details: z.object({ error_reason: z.string().nullable() }).partial().nullable().optional(),
    refund: z.object({ refund_id: z.string(), cf_refund_id: z.union([z.string(), z.number()]), refund_status: z.string() }).partial().optional(),
    refund_id: z.string().optional(),
    cf_refund_id: z.union([z.string(), z.number()]).optional(),
    refund_status: z.string().optional(),
  }).passthrough(),
});

const recon = z.object({
  cursor: z.string().nullable().optional(),
  data: z.array(z.object({
    event_details: z.object({ event_type: z.string().nullable(), event_status: z.string().nullable(), event_amount: z.number().nullable(), event_service_charge: z.number().nullable(), event_service_tax: z.number().nullable() }).partial(),
    order_details: z.object({ order_id: z.string().nullable() }).partial().nullable().optional(),
    payment_details: z.object({ cf_payment_id: z.union([z.string(), z.number()]).nullable() }).partial().nullable().optional(),
    refund_details: z.object({ refund_id: z.string().nullable() }).partial().nullable().optional(),
    settlement_details: z.object({ settlement_date: z.string().nullable() }).partial().nullable().optional(),
  }).passthrough()).default([]),
});

export function cashfree(): PaymentProvider {
  return {
    customer: (details) => ({ ...details, phone: details.phone.replace(/\D/g, "").slice(-10) }),

    async mandate({ id, customer, maxPaise, firstPaise, method, returnUrl }) {
      await call("/plans", { plan_id: `plan-${id}`, plan_name: "InboxCA plan", plan_type: "ON_DEMAND", plan_currency: "INR", plan_max_amount: rupees(maxPaise), plan_note: "Orelu never debits more than this without asking you" }, `plan-${id}`);
      const answer = await call("/subscriptions", {
        subscription_id: id,
        customer_details: { customer_name: customer.name.slice(0, 100), customer_email: customer.email, customer_phone: customer.phone },
        plan_details: { plan_id: `plan-${id}` },
        // With nothing due (a new mandate for a plan already paid), ₹1 is taken and given back at once.
        authorization_details: { authorization_amount: method === "enach" ? 0 : rupees(firstPaise || 100), authorization_amount_refund: !firstPaise, payment_methods: [method] },
        subscription_meta: { return_url: returnUrl },
        subscription_tags: { psp_note: "InboxCA by Orelu" },
      }, id);
      return { session: String(answer.subscription_session_id ?? ""), kind: "mandate" };
    },

    async charge({ mandate, id, paise: amount, at, note }) {
      await call("/subscriptions/pay", { subscription_id: mandate, payment_id: id, payment_type: "CHARGE", payment_amount: rupees(amount), payment_schedule_date: at.toISOString(), payment_remarks: note.slice(0, 100) }, id);
    },

    async cancelCharge({ mandate, id }) {
      await call(`/subscriptions/${encodeURIComponent(mandate)}/payments/${encodeURIComponent(id)}/manage`, { subscription_id: mandate, payment_id: id, action: "CANCEL" }, `cancel-${id}`);
    },

    async order({ id, customer, paise: amount, returnUrl, note }) {
      const answer = await call("/orders", {
        order_id: id, order_amount: rupees(amount), order_currency: "INR", order_note: note.slice(0, 200),
        customer_details: { customer_id: customer.id, customer_name: customer.name.slice(0, 100), customer_email: customer.email, customer_phone: customer.phone },
        order_meta: { return_url: returnUrl },
      }, id);
      return { session: String(answer.payment_session_id ?? ""), kind: "order" };
    },

    async refund({ id, of, paise: amount, note }) {
      if (of.kind === "order") {
        await call(`/orders/${encodeURIComponent(of.id)}/refunds`, { refund_id: id, refund_amount: rupees(amount), refund_note: note.slice(0, 100), refund_speed: "STANDARD" }, id);
        return;
      }
      // A debit on the mandate is Orelu's payment id; the amount taken at authorisation is the
      // provider's, kept as its reference.
      await call(`/subscriptions/${encodeURIComponent(of.mandate ?? "")}/refunds`, {
        subscription_id: of.mandate, payment_id: of.kind === "auth" ? of.ref : of.id, refund_id: id, refund_amount: rupees(amount),
        refund_note: note.slice(0, 100), refund_speed: of.method === "enach" ? "INSTANT" : "STANDARD",
      }, id);
    },

    async cancelMandate(mandate) {
      await call(`/subscriptions/${encodeURIComponent(mandate)}/manage`, { subscription_id: mandate, action: "CANCEL" }, `cancel-${mandate}`);
    },

    verify(raw, headers) {
      const signature = headers.get("x-webhook-signature") ?? "";
      const timestamp = headers.get("x-webhook-timestamp") ?? "";
      const secret = process.env.CASHFREE_SECRET_KEY;
      if (!secret || !signature || !timestamp) return false;
      const expected = createHmac("sha256", secret).update(timestamp + raw).digest();
      const given = Buffer.from(signature, "base64");
      return given.length === expected.length && timingSafeEqual(given, expected);
    },

    parse(raw, headers) {
      const parsed = hook.safeParse(JSON.parse(raw));
      if (!parsed.success) return null;
      const { type, data } = parsed.data;
      const key = headers.get("x-idempotency-key") || createHash("sha256").update(raw).digest("hex");
      const ref = (value: unknown) => (value === undefined || value === null ? undefined : String(value));
      if (type === "SUBSCRIPTION_STATUS_CHANGED" || type === "SUBSCRIPTION_AUTH_STATUS") {
        const mandate = data.subscription_details?.subscription_id;
        const status = data.subscription_details?.subscription_status ?? "";
        if (!mandate) return null;
        if (status === "ACTIVE") return { key, type: "mandate", mandate, status: "active", method: methodOf(data.authorization_details), ref: ref(data.authorization_details?.payment_id) };
        if (["CUSTOMER_CANCELLED", "CANCELLED", "EXPIRED", "CARD_EXPIRED", "LINK_EXPIRED", "COMPLETED"].includes(status)) return { key, type: "mandate", mandate, status: "cancelled" };
        return null;
      }
      if (type.startsWith("SUBSCRIPTION_PAYMENT_") && data.payment_id && data.payment_type !== "AUTH") {
        const status = type === "SUBSCRIPTION_PAYMENT_SUCCESS" ? "done" : type === "SUBSCRIPTION_PAYMENT_FAILED" ? "failed" : type === "SUBSCRIPTION_PAYMENT_CANCELLED" ? "cancelled" : null;
        return status && { key, type: "payment", payment: data.payment_id, status, ref: ref(data.cf_payment_id), reason: data.failure_details?.failure_reason ?? undefined };
      }
      if ((type === "PAYMENT_SUCCESS_WEBHOOK" || type === "PAYMENT_FAILED_WEBHOOK") && data.order?.order_id)
        return { key, type: "payment", payment: data.order.order_id, status: type === "PAYMENT_SUCCESS_WEBHOOK" ? "done" : "failed", ref: ref(data.payment?.cf_payment_id), reason: data.error_details?.error_reason ?? undefined };
      const refund = type === "REFUND_STATUS_WEBHOOK" ? data.refund : type === "SUBSCRIPTION_REFUND_STATUS" ? { refund_id: data.refund_id, cf_refund_id: data.cf_refund_id, refund_status: data.refund_status } : null;
      if (refund?.refund_id) {
        const status = refund.refund_status === "SUCCESS" ? "done" : ["FAILED", "CANCEL", "CANCELLED", "REJECTED"].includes(refund.refund_status ?? "") ? "failed" : null;
        return status && { key, type: "refund", refund: refund.refund_id, status, ref: ref(refund.cf_refund_id) };
      }
      return null;
    },

    async settlements(from, to) {
      const lines: Settled[] = [];
      let cursor: string | null = null;
      do {
        const page = recon.parse(await call("/recon", { pagination: { limit: 1000, cursor }, filters: { start_date: from.toISOString(), end_date: to.toISOString() } }));
        for (const event of page.data) {
          const kind = event.event_details.event_type;
          if (event.event_details.event_status !== "SUCCESS" || (kind !== "PAYMENT" && kind !== "REFUND")) continue;
          lines.push({
            id: (kind === "REFUND" ? event.refund_details?.refund_id : event.order_details?.order_id) ?? undefined,
            ref: event.payment_details?.cf_payment_id ? String(event.payment_details.cf_payment_id) : undefined,
            refund: kind === "REFUND", paise: paise(event.event_details.event_amount), feePaise: paise(event.event_details.event_service_charge), feeTaxPaise: paise(event.event_details.event_service_tax),
            settledAt: event.settlement_details?.settlement_date ?? undefined,
          });
        }
        cursor = page.data.length ? page.cursor ?? null : null;
      } while (cursor);
      return lines;
    },

    script: `${process.env.MAIL_ALLOW_LOCAL === "1" && process.env.CASHFREE_TEST_URL ? process.env.CASHFREE_TEST_URL : "https://sdk.cashfree.com"}/js/v3/cashfree.js`,
    mode: process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
  };
}
