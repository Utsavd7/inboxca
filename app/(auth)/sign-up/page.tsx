import type { Metadata } from "next";
import Link from "next/link";
import { billingSettings } from "@/src/lib/billing/billing";
import { chosenPlan, rupees } from "@/src/lib/billing/money";
import { firmlessAccount, providerChoices } from "@/src/lib/sign-in";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Sign up | InboxCA" };

// After Google or Microsoft, a person in no firm yet is signed in already: only the firm's
// details are asked for. A plan chosen on the site's price list shows in one line, priced
// again here from plan_formula, and waits for the plan and payment step (/start).
export default async function SignUp({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [account, query] = await Promise.all([firmlessAccount(), searchParams]);
  const formula = typeof query.plan === "string" ? (await billingSettings()).formula : null;
  const chosen = formula && chosenPlan(formula, query);
  const ask = chosen ? new URLSearchParams({ clients: String(chosen.plan.clients), practice: chosen.plan.practice, people: String(chosen.plan.people), cycle: chosen.cycle }).toString() : undefined;
  return (
    <>
      <h1>Sign up</h1>
      {chosen && (
        <p className="auth-note">
          <strong>{chosen.price.name} plan</strong>, paid {chosen.cycle}: {rupees(chosen.price.paise)} {chosen.cycle === "yearly" ? "a year" : "a month"} before GST. You confirm it before you pay. <Link href="/#plans">Change</Link>
        </p>
      )}
      <SignUpForm account={account?.email} providers={account ? [] : providerChoices()} plan={ask} />
    </>
  );
}
