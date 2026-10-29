import type { Method } from "./money";
import { cashfree } from "./cashfree";

// The payment provider behind Orelu's billing (PLAN.md 5.14.1, provider decision of 27 Oct
// 2026): Cashfree first; a Razorpay adapter can implement the same interface later. Orelu keeps
// only its own ids and the provider's payment reference, never card or bank details; the
// provider's hosted checkout collects them.
export type Customer = { name: string; email: string; phone: string };
// What the browser hands the provider's checkout script to open the hosted page.
export type Checkout = { session: string; kind: "mandate" | "order" };

// A webhook, verified and reduced to what billing acts on. `key` is the provider's own
// identity for the event, so a replay is recognised.
export type BillingEvent =
  | { key: string; type: "mandate"; mandate: string; status: "active" | "cancelled"; method?: Method; ref?: string }
  | { key: string; type: "payment"; payment: string; status: "done" | "failed" | "cancelled"; ref?: string; reason?: string }
  | { key: string; type: "refund"; refund: string; status: "done" | "failed"; ref?: string };

// One line of the provider's reconciliation: a payment or refund, its fee and when it settled.
export type Settled = { id?: string; ref?: string; refund: boolean; paise: number; feePaise: number; feeTaxPaise: number; settledAt?: string };

export interface PaymentProvider {
  // The customer the provider needs: Cashfree takes it inline with each mandate and order.
  customer(details: Customer): Customer;
  // A mandate with a maximum amount, authorised by the owner in checkout; firstPaise is taken
  // at authorisation where the method allows it (UPI AutoPay, card), else raised once active.
  mandate(input: { id: string; customer: Customer; maxPaise: number; firstPaise: number; method: Method; returnUrl: string }): Promise<Checkout>;
  // A debit on an active mandate, due at `at`; the provider sends the pre-debit notice. Writes
  // take Orelu's id as their idempotency key, so the same call again never moves money twice. A
  // write the provider turned down throws an error with `refused: true`; any other throw (a
  // timeout, a lost answer) may have been carried out, and is tried again with the same id.
  charge(input: { mandate: string; id: string; paise: number; at: Date; note: string }): Promise<void>;
  cancelCharge(input: { mandate: string; id: string }): Promise<void>;
  // A one time payment for exactly this amount.
  order(input: { id: string; customer: Customer & { id: string }; paise: number; returnUrl: string; note: string }): Promise<Checkout>;
  // A refund of a payment in full or in part, with its own id as the idempotency key.
  // `of.kind`: taken at the mandate's authorisation, debited on it, or paid as an order.
  refund(input: { id: string; of: { id: string; ref: string | null; kind: "auth" | "charge" | "order"; mandate: string | null; method: Method | null }; paise: number; note: string }): Promise<void>;
  cancelMandate(mandate: string): Promise<void>;
  verify(raw: string, headers: Headers): boolean;
  parse(raw: string, headers: Headers): BillingEvent | null;
  settlements(from: Date, to: Date): Promise<Settled[]>;
  // The checkout script the browser loads, and the mode it opens in.
  script: string;
  mode: "sandbox" | "production";
}

// Off until Orelu's Cashfree keys are set (CASHFREE_APP_ID and CASHFREE_SECRET_KEY): then
// firms sign up and work as before, with no payment, and Settings, Billing says so.
export const billingReady = () => !!process.env.CASHFREE_APP_ID && !!process.env.CASHFREE_SECRET_KEY;
export const billingProvider = (): PaymentProvider | null => (billingReady() ? cashfree() : null);
