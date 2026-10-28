import { Check, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { startCheckout } from "@/app/(app)/app/settings/billing-actions";
import { Checkout } from "@/app/(app)/app/settings/checkout";
import { Methods } from "@/app/(app)/app/settings/methods";
import { billingSettings, quote } from "@/src/lib/billing/billing";
import { chosenPlan, gstOn, indiaDay, mandateMax, planPrice, planSchema, rupees, type Cycle } from "@/src/lib/billing/money";
import { estimate, type Formula, type Practice } from "@/src/lib/estimate";
import { longDate } from "@/src/lib/hours";
import { signedInMember } from "@/src/lib/member";
import { signOut } from "../actions";
import { Refresh } from "./refresh";
import "./start.css";

export const metadata: Metadata = { title: "Plan and payment | InboxCA" };

type Query = Record<string, string | string[] | undefined>;

const Steps = () => (
  <ol className="start-progress" aria-label="Sign up">
    <li className="done"><Check size={14} strokeWidth={3} aria-hidden /> Your firm</li>
    <li aria-current="step">Plan and payment</li>
    <li>Set up</li>
  </ol>
);
const SignOut = () => <form action={signOut}><button className="text-button" type="submit">Sign out</button></form>;
// A short screen of this step: waiting for the payment, or for the owner.
const Short = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="start">
    <Steps />
    <h1>{title}</h1>
    {children}
    <SignOut />
  </div>
);

// Sign up's last step (PLAN.md 5.14.1), once payments are set up: the owner chooses the plan and
// sets up AutoPay, and the firm opens when the first payment is in. Until then every page of the
// app sends here (currentMember). The plan chosen on the site's price list waits in plan_ask; one
// picked here is sized as the price list sizes it. Every amount is the server's (quote).
export default async function Start({ searchParams }: { searchParams: Promise<Query> }) {
  const [{ supabase, membership }, query] = await Promise.all([signedInMember(), searchParams]);
  if (membership?.billing !== "start") redirect("/app");
  if (membership.role !== "owner")
    return <Short title="Your firm starts once its owner chooses a plan"><p className="auth-lead">Ask the owner of {membership.firmName} to sign in and choose the plan. Then sign in again here.</p></Short>;
  const firmId = membership.firmId;
  const [{ formula, tax }, { data: firm }, { data: sub }, { data: payment }] = await Promise.all([
    billingSettings(),
    supabase.from("firms").select("gstin, state_code, settings").eq("id", firmId).single(),
    supabase.from("subscriptions").select("status").eq("firm_id", firmId).maybeSingle(),
    supabase.from("payments").select("status, due_at, amount_paise").eq("firm_id", firmId).eq("kind", "plan").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  // A bank mandate (eNACH) the bank confirmed: its first debit follows the notice.
  if (sub?.status === "active")
    return <Short title="Your bank confirmed AutoPay"><p className="auth-lead">InboxCA takes the first payment{payment ? ` of ${rupees(payment.amount_paise)}` : ""}{payment?.due_at ? ` on ${longDate(indiaDay(new Date(payment.due_at)))}` : ""}. Your firm starts as soon as it is paid, and we email you then.</p></Short>;
  // Back from the payment page: the signed webhook decides, so this waits for it.
  const back = query.paid === "1";
  if (back && sub?.status === "created" && payment?.status === "created")
    return (
      <Short title="Confirming your payment">
        <p className="auth-lead start-wait" role="status">Your bank is telling us now. This page moves on by itself.</p>
        <Refresh />
        <p className="auth-small">Closed the payment page without paying? <Link href="/start">Try again</Link></p>
      </Short>
    );
  if (back && (sub?.status === "cancelled" || payment?.status === "failed" || payment?.status === "cancelled"))
    return (
      <Short title="The payment did not go through">
        <p className="auth-lead">Your firm has not started yet. Try again with the same way to pay or another one.</p>
        <Link className="btn" href="/start">Try again</Link>
      </Short>
    );
  if (!formula) return <Short title="Prices are not set up yet"><p className="auth-lead">Try again later.</p></Short>;

  const ask: Query = query.plan || query.clients ? query : Object.fromEntries(new URLSearchParams((await cookies()).get("plan_ask")?.value));
  const one = (key: string) => (typeof ask[key] === "string" ? ask[key] : undefined);
  const cycle: Cycle = one("cycle") === "yearly" ? "yearly" : "monthly";
  const answers = planSchema.safeParse({ clients: Number(one("clients")), practice: one("practice"), people: Number(one("people")) });
  // The plan picked by name, else the one the answers name, else the smallest.
  const code = one("plan") ?? (answers.success ? planPrice(formula, answers.data, cycle).code : formula.plans[0].code);
  const chosen = chosenPlan(formula, { ...ask, plan: code });
  const plan = chosen?.plan ?? (answers.success ? answers.data : { clients: 1, practice: "mixed" as const, people: 1, aiBlocks: 0 });
  const today = indiaDay(new Date());
  const priced = chosen && quote(formula, tax, firm?.gstin?.slice(0, 2) ?? firm?.state_code ?? "", chosen.plan, cycle, today, true);
  const fit = estimate(plan.clients, plan.practice as Practice, plan.people, formula as unknown as Formula);
  const returns = fit.custom ? fit.storageGb * formula.custom.returnsPerStep : formula.plans[fit.index].maxReturns;
  const custom = code === "custom";
  const top = formula.plans[formula.plans.length - 1];
  const href = (change: Record<string, string>) => `/start?${new URLSearchParams({ plan: code, cycle, clients: String(plan.clients), practice: plan.practice, people: String(plan.people), ...change })}`;
  const hidden = (values: Record<string, string>) => Object.entries(values).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
  const per = cycle === "monthly" ? "every month" : "every year";
  const gst = gstOn(tax, today) ? tax.rate : 0;
  const team = priced ? Math.max(priced.price.people, plan.people) : plan.people;

  return (
    <div className="start start-wide">
      <Steps />
      <header className="start-head">
        <div>
          <h1>Choose your plan and set up AutoPay</h1>
          <p className="auth-lead">{membership.firmName} opens on InboxCA as soon as the first payment is in.</p>
        </div>
        <SignOut />
      </header>
      <div className="start-grid">
        <section className="start-plan" aria-labelledby="plan-title">
          <h2 id="plan-title">Your plan</h2>
          <nav className="start-tabs" aria-label="Plans">
            {[...formula.plans.map((each) => [each.code, each.name]), ["custom", "Custom"]].map(([key, name]) => (
              <Link key={key} href={href({ plan: key, people: String(key === "custom" ? plan.people : Math.min(plan.people, formula.custom.includedPeople)) })} aria-current={key === code ? "true" : undefined} scroll={false}>{name}</Link>
            ))}
          </nav>
          <nav className="start-tabs start-cycle" aria-label="How often to pay">
            <Link href={href({ cycle: "monthly" })} aria-current={cycle === "monthly" ? "true" : undefined} scroll={false}>Monthly</Link>
            <Link href={href({ cycle: "yearly" })} aria-current={cycle === "yearly" ? "true" : undefined} scroll={false}>Yearly <span className="start-free">1 month free</span></Link>
          </nav>
          {priced && (
            <ul className="start-includes" aria-label={`The ${priced.price.name} plan includes`}>
              <li>{returns.toLocaleString("en-IN")} returns a year</li>
              <li>{(returns / formula.custom.returnsPerStep).toLocaleString("en-IN")} GB storage</li>
              <li>{priced.price.aiCredits.toLocaleString("en-IN")} AI credits a month</li>
              <li>{team === 1 ? "Just you" : `A team of up to ${team}`}</li>
              <li>Unlimited clients</li>
            </ul>
          )}
          <Form action="/start" className="start-team" scroll={false}>
            {hidden({ plan: code, cycle, ...(!custom && { clients: String(plan.clients), practice: plan.practice }) })}
            {custom && (
              <>
                <div><label htmlFor="start-clients">Clients</label><input id="start-clients" name="clients" type="number" min={1} max={100000} required defaultValue={plan.clients} key={plan.clients} /></div>
                <div>
                  <label htmlFor="start-practice">Kind of practice</label>
                  <select id="start-practice" name="practice" defaultValue={plan.practice}>{formula.practices.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
                </div>
              </>
            )}
            <div><label htmlFor="start-people">{custom ? "Team, you included" : "Your team, you included"}</label><input id="start-people" name="people" type="number" min={1} max={custom ? 1000 : formula.custom.includedPeople} required defaultValue={plan.people} key={plan.people} /></div>
            <button className="btn btn-quiet" type="submit">Update</button>
          </Form>
          {custom && !priced && <p className="auth-small">Custom is for firms past Enterprise: more than {top.maxReturns.toLocaleString("en-IN")} returns a year or a team of more than {formula.custom.includedPeople}.</p>}
          {priced && (
            <>
              <dl className="start-price">
                {priced.price.lines.map((line) => <div key={line.text}><dt>{line.text}</dt><dd>{rupees(line.paise)}</dd></div>)}
                {priced.setupPaise > 0 && <div><dt>One time setup of InboxCA for your firm</dt><dd>{rupees(priced.setupPaise)}</dd></div>}
                {(priced.price.lines.length > 1 || priced.setupPaise > 0) && <div><dt>Before GST</dt><dd>{rupees(priced.first.taxable)}</dd></div>}
                <div><dt>{gst ? `GST at ${gst}%` : "GST"}</dt><dd>{gst ? rupees(priced.first.gst) : "None"}</dd></div>
                <div className="start-total"><dt>You pay today</dt><dd>{rupees(priced.first.total)}</dd></div>
              </dl>
              <p className="auth-small">{gst ? "" : `${tax?.gstin ? "No GST is charged on this payment." : "Orelu is not registered under GST, so no GST is charged."} `}You confirm it before you pay. Then {rupees(priced.recurring.total)} {per} by AutoPay.</p>
            </>
          )}
        </section>
        <section className="start-pay" aria-labelledby="pay-title">
          <h2 id="pay-title">AutoPay</h2>
          {priced ? (
            <Checkout action={startCheckout} label="Pay and start" busy="Opening the payment page" className="start-form" button="btn">
              {hidden({ clients: String(plan.clients), practice: plan.practice, people: String(plan.people), cycle })}
              <Methods choices={priced.methods} />
              <div className="start-fields">
                <div><label htmlFor="start-phone">Mobile number for AutoPay messages</label><input id="start-phone" name="phone" inputMode="tel" autoComplete="tel" required maxLength={14} /></div>
                <div><label htmlFor="start-gstin">Firm GSTIN, if it has one</label><input id="start-gstin" name="gstin" maxLength={15} defaultValue={firm?.gstin ?? ""} /></div>
                <div className="start-wide-field"><label htmlFor="start-address">Firm address, for receipts</label><input id="start-address" name="address" required maxLength={300} autoComplete="street-address" defaultValue={String((firm?.settings as Record<string, unknown> | undefined)?.billing_address ?? "")} /></div>
              </div>
              <p className="auth-small">Orelu will never take more than {rupees(mandateMax(priced.price.paise, priced.methods[0].method))} at a time without asking you.</p>
              <p className="start-back"><ShieldCheck size={16} aria-hidden /> Cancel within 14 days of your first payment and get it back in full.</p>
            </Checkout>
          ) : <p className="start-empty">Enter your firm&apos;s size to see the price and set up AutoPay.</p>}
        </section>
      </div>
    </div>
  );
}
