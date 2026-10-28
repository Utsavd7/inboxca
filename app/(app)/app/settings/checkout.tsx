"use client";
import { startTransition, useActionState, useEffect, type ReactNode } from "react";
import type { CheckoutState } from "./billing-actions";

type CashfreeCheckout = {
  subscriptionsCheckout: (options: { subsSessionId: string; redirectTarget: string }) => Promise<{ error?: unknown }>;
  checkout: (options: { paymentSessionId: string; redirectTarget: string }) => Promise<{ error?: unknown }>;
};
declare global {
  interface Window { Cashfree?: (options: { mode: string }) => CashfreeCheckout }
}

// A form whose server action prepares a payment, then opens the provider's hosted checkout in
// this tab (Cashfree's checkout script: card, UPI and bank details never reach InboxCA). The
// owner comes back to Billing, which shows the payment once its webhook is in. Sent by hand, not
// as the form's action, as React empties a form after its action: what was typed stays on
// screen, the button busy, until the checkout opens or an error shows.
export function Checkout({ action, label, busy, className = "set-stack", button = "b b-primary", children }: { action: (prev: CheckoutState, form: FormData) => Promise<CheckoutState>; label: string; busy: string; className?: string; button?: string; children?: ReactNode }) {
  const [state, send, sending] = useActionState(action, {});
  const opening = !!state.session;
  useEffect(() => {
    if (!state.session || !state.script) return;
    const open = () => {
      const cashfree = window.Cashfree?.({ mode: state.mode ?? "sandbox" });
      if (!cashfree) return;
      void (state.kind === "mandate"
        ? cashfree.subscriptionsCheckout({ subsSessionId: state.session!, redirectTarget: "_self" })
        : cashfree.checkout({ paymentSessionId: state.session!, redirectTarget: "_self" }));
    };
    if (window.Cashfree) return open();
    const script = document.createElement("script");
    script.src = state.script;
    script.onload = open;
    document.head.append(script);
  }, [state]);
  return (
    <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => send(form)); }} className={className}>
      {children}
      {state.error && <p className="field-error" role="alert">{state.error}</p>}
      <div className="set-foot">
        <button className={button} type="submit" disabled={sending || opening} aria-busy={sending || opening || undefined}>
          {sending || opening ? busy : label}
        </button>
      </div>
    </form>
  );
}

// Cancel and get my money back: confirmed with the 2 step code (D33).
export function MoneyBackForm({ action }: { action: (prev: { error?: string }, form: FormData) => Promise<{ error?: string }> }) {
  const [state, send, sending] = useActionState(action, {});
  return (
    <form action={send} className="set-fields">
      <div>
        <label htmlFor="money-back-code">6 digit code from your authenticator app</label>
        <input id="money-back-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
      </div>
      {state.error && <p className="field-error" role="alert">{state.error}</p>}
      <div className="set-foot">
        <button className="b b-danger" type="submit" disabled={sending} aria-busy={sending || undefined}>{sending ? "Cancelling" : "Cancel and get my money back"}</button>
      </div>
    </form>
  );
}
