import { methodWords } from "@/src/lib/billing/billing";
import type { Method } from "@/src/lib/billing/money";

// The ways to pay by AutoPay for this amount, the first chosen: on Settings, Billing and on sign
// up's plan and payment step.
export function Methods({ choices, name = "method" }: { choices: { method: Method; approveEach: boolean }[]; name?: string }) {
  return (
    <fieldset className="set-choices">
      <legend className="sr-only">How to pay</legend>
      {choices.map(({ method, approveEach }, at) => (
        <label key={method}>
          <input type="radio" name={name} value={method} required defaultChecked={!at} />
          <span><strong>{methodWords[method][0].toUpperCase() + methodWords[method].slice(1)}</strong> <span className="hint">{approveEach ? "You approve each payment in your bank or UPI app." : method === "enach" ? "Your bank confirms it within 1 or 2 days. Nothing to approve after that." : "Approve once. Nothing to approve after that."}</span></span>
        </label>
      ))}
    </fieldset>
  );
}
