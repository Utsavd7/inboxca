import { CreditCard, Gauge } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { billingSettings, fitOf, methodWords, moneyBack, movingUp, quote, type SubPlan } from "@/src/lib/billing/billing";
import { docTitles, type Doc } from "@/src/lib/billing/documents";
import { addDays, GB, gstOn, indiaDay, mandateMax, planPrice, planSchema, prorate, rupees, toYearly, withGst, type Cycle, type FirmPlan, type Method } from "@/src/lib/billing/money";
import { billingProvider } from "@/src/lib/billing/provider";
import { longDate } from "@/src/lib/hours";
import type { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";
import { Item, List } from "../motion";
import { Pending } from "../pending";
import { Badge, IconTile } from "../ui";
import { approveCheckout, buyCheckout, moneyBackAction, moveDown, saveAutoTopUp, startCheckout, turnOffAutoPay } from "./billing-actions";
import { Checkout, MoneyBackForm } from "./checkout";
import "./settings.css";

// Settings, Billing and sign up's last step (PLAN.md 5.14.1): the plan and its price, AutoPay,
// add-ons paid before they apply, receipts, and the money back within 14 days. Every amount is
// the server's, from plan_formula and Orelu's tax settings.
type Supabase = Awaited<ReturnType<typeof currentMember>>["supabase"];
type CardProps = { id: string; title: string; line?: React.ReactNode; danger?: boolean; children: React.ReactNode };
export type PlanAsk = { clients?: string; practice?: string; people?: string; cycle?: string };

const last = (until: string) => longDate(addDays(until, -1));
const askedPlan = (ask: PlanAsk, fallback?: FirmPlan) => planSchema.safeParse({ clients: Number(ask.clients ?? fallback?.clients), practice: ask.practice ?? fallback?.practice, people: Number(ask.people ?? fallback?.people), aiBlocks: fallback?.aiBlocks ?? 0, returns: fallback?.returns });
const kindWords: Record<string, string> = { plan: "First payment", renewal: "Plan renewal", upgrade: "Move to a bigger plan", yearly: "Switch to yearly payment", extra_user: "One more person", ai_block: "One more AI block", topup: "AI top-up", setup: "Setup", refund: "Money given back" };

// The two questions and the team, as on the site's price list: the plan is named from them.
function PlanQuestions({ ask, practices, action, hidden, button }: { ask: PlanAsk & { group?: string }; practices: [string, string, number][]; action: string; hidden?: Record<string, string>; button: string }) {
  return (
    <Form action={action} className="set-fields set-four" scroll={false}>
      {Object.entries(hidden ?? {}).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <div><label htmlFor="plan-clients">Clients</label><input id="plan-clients" name="clients" type="number" min={1} max={100000} required defaultValue={ask.clients} /></div>
      <div>
        <label htmlFor="plan-practice">Kind of practice</label>
        <select id="plan-practice" name="practice" defaultValue={ask.practice ?? "mixed"}>{practices.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
      </div>
      <div><label htmlFor="plan-people">Your team, you included</label><input id="plan-people" name="people" type="number" min={1} max={1000} required defaultValue={ask.people ?? 1} /></div>
      <div>
        <label htmlFor="plan-cycle">Pay</label>
        <select id="plan-cycle" name="cycle" defaultValue={ask.cycle ?? "monthly"}><option value="monthly">Every month</option><option value="yearly">Every year, one month free</option></select>
      </div>
      <div className="set-foot"><button className="b b-secondary" type="submit">{button}</button></div>
    </Form>
  );
}

function Methods({ choices, name = "method" }: { choices: { method: Method; approveEach: boolean }[]; name?: string }) {
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

// Sign up's last step on Today, once payments are set up: the plan, then AutoPay.
export async function StartPlan({ supabase, firmId, ask }: { supabase: Supabase; firmId: string; ask: PlanAsk }) {
  const [{ formula, tax }, { data: firm }] = await Promise.all([billingSettings(), supabase.from("firms").select("gstin, state_code, settings").eq("id", firmId).single()]);
  if (!formula) return <p className="notice">Prices are not set up yet. Try again later.</p>;
  const plan = ask.clients ? askedPlan(ask) : null;
  const cycle: Cycle = ask.cycle === "yearly" ? "yearly" : "monthly";
  const priced = plan?.success ? quote(formula, tax, firm?.gstin?.slice(0, 2) ?? firm?.state_code ?? "", plan.data, cycle, indiaDay(new Date()), true) : null;
  return (
    <div className="set-page"><div className="set-body set-start">
    <section className="panel set-card" aria-labelledby="start-title">
      <header className="set-head"><IconTile Icon={CreditCard} kind="approve" /><span className="grow"><h2 id="start-title">Choose your plan to start</h2><p className="hint">Tell us about your firm and InboxCA names the plan that fits. Clients are unlimited on every plan.</p></span></header>
      <PlanQuestions ask={ask} practices={formula.practices} action="/app" button="See my plan" />
      {priced && plan?.success && (
        <Checkout action={startCheckout} label="Set up AutoPay" busy="Opening the payment page">
          {Object.entries({ clients: String(plan.data.clients), practice: plan.data.practice, people: String(plan.data.people), cycle }).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <p><strong>{priced.price.name} plan</strong>: {rupees(priced.recurring.total)} {cycle === "monthly" ? "a month" : "a year"}{priced.recurring.gst ? " with GST" : ""}, for a team of up to {Math.max(priced.price.people, plan.data.people)} and {priced.price.aiCredits.toLocaleString("en-IN")} AI credits a month.</p>
          {priced.setupPaise > 0 && <p className="hint">The first payment, {rupees(priced.first.total)}, includes the one time setup.</p>}
          <Methods choices={priced.methods} />
          <div className="set-fields">
            <div><label htmlFor="start-phone">Mobile number for AutoPay messages</label><input id="start-phone" name="phone" inputMode="tel" autoComplete="tel" required maxLength={14} /></div>
            <div><label htmlFor="start-gstin">Firm GSTIN, if it has one</label><input id="start-gstin" name="gstin" maxLength={15} defaultValue={firm?.gstin ?? ""} /></div>
            <div><label htmlFor="start-address">Firm address, for receipts</label><input id="start-address" name="address" required maxLength={300} defaultValue={String((firm?.settings as Record<string, unknown> | undefined)?.billing_address ?? "")} /></div>
          </div>
          <p className="hint">Orelu will never take more than {rupees(mandateMax(priced.price.paise, priced.methods[0].method))} at a time without asking you. Cancel within 14 days of your first payment and get it back in full.</p>
        </Checkout>
      )}
    </section>
    </div></div>
  );
}

// A move up or a switch to yearly payment debited on the mandate, on its way.
const OnItsWay = ({ raised }: { raised: NonNullable<Awaited<ReturnType<typeof movingUp>>> }) =>
  <p className="hint">{rupees(raised.amount_paise)} will be taken on {longDate(indiaDay(new Date(raised.due_at!)))} to {raised.kind === "yearly" ? "switch to yearly payment" : "move you up"}.</p>;

// A monthly payer's switch to yearly payment (D38), one payment: debited on the mandate within its
// maximum, paid in checkout above it; not in the days a renewal may be raised.
const ToYearly = ({ pay, paidUntil, today }: { pay: number; paidUntil: string; today: string }) => paidUntil <= addDays(today, 6)
  ? <p className="hint">Switch to yearly payment after your renewal on {longDate(paidUntil)}.</p>
  : <Checkout action={buyCheckout} label={`Pay ${rupees(pay)} and switch to yearly payment`} busy="Switching" className=""><input type="hidden" name="kind" value="yearly" /></Checkout>;

// The plan fit (PLAN.md 5.14, D38), on the owner's Today and at the top of Settings, Billing:
// shown when either yearly measure reaches 80% of the plan or is on course to pass it. The plan
// that fits and every amount are the server's; the one action pays the difference for the rest
// of the paid period. A monthly payer whose year still fits its plan is offered yearly payment
// instead, never a bigger plan.
export async function PlanFit({ firmId, Card, fit: known }: { firmId: string; Card?: (props: CardProps) => React.ReactNode; fit?: Awaited<ReturnType<typeof fitOf>> }) {
  if (!billingProvider()) return null;
  const admin = supabaseAdmin();
  const today = indiaDay(new Date());
  const [{ formula, tax }, { data: sub }, { data: firm }] = await Promise.all([billingSettings(admin), admin.from("subscriptions").select("cycle, paid_until, plan").eq("firm_id", firmId).maybeSingle(), admin.from("firms").select("gstin, state_code, status").eq("id", firmId).single()]);
  if (!formula || !sub?.paid_until || sub.paid_until <= today || firm?.status !== "active") return null;
  const fit = known ?? (await fitOf(admin, firmId, formula, sub, today));
  if (!fit?.notice) return null;
  const cycle = sub.cycle as Cycle;
  const state = firm.gstin?.slice(0, 2) ?? firm.state_code ?? "";
  const moved = quote(formula, tax, state, fit.next, cycle, today);
  const current = planPrice(formula, sub.plan as unknown as SubPlan, cycle);
  const year = fit.yearly ? toYearly(formula, sub.plan as unknown as SubPlan, today, sub.paid_until) : null;
  const pay = withGst(year ? year.paise : prorate(moved.price.paise - current.paise, today, sub.paid_until, cycle), tax, state, today).total;
  const raised = await movingUp(admin, firmId);
  const plan = year ? `Its year still fits the ${current.name} plan, so it needs no bigger plan. Paid yearly, your plan gives the whole year's returns and InboxCA storage at once: ${rupees(pay)}${moved.recurring.gst ? " with GST" : ""} now pays for it until ${last(year.until)}`
    : `The ${moved.price.name} plan fits your firm's work: ${rupees(moved.recurring.total)} ${cycle === "monthly" ? "a month" : "a year"}${moved.recurring.gst ? " with GST" : ""}`;
  const action = raised ? <OnItsWay raised={raised} /> : year ? <ToYearly pay={pay} paidUntil={sub.paid_until} today={today} />
    : pay > 0 ? <Checkout action={buyCheckout} label={`Pay ${rupees(pay)} and ${moved.price.code === "custom" ? "switch to Custom" : "move up"}`} busy="Opening the payment page" className=""><input type="hidden" name="kind" value="fit" /></Checkout> : null;
  const share = (m: (typeof fit.measures)[number]) => Math.round((100 * m.used) / m.earned);
  if (!Card) {
    const first = fit.measures.find((m) => m.notice)!;
    const words = first.measure === "returns" ? "returns" : "InboxCA storage";
    return (
      <div className="today-line" role="region" aria-label="Your plan">
        <Gauge size={16} aria-hidden />
        <span className="grow"><strong>{year ? `Your firm has used ${share(first)}% of the ${words} its plan gives by this month.` : share(first) >= 80 ? `Your firm has used ${share(first)}% of its plan's ${words}.` : `Your firm's ${words} ${first.measure === "returns" ? "are" : "is"} on course to pass its plan by March.`}</strong> {plan}.</span>
        {action}
      </div>
    );
  }
  const figure = (m: (typeof fit.measures)[number], value: number) => (m.measure === "returns" ? Math.round(value).toLocaleString("en-IN") : `${(value / GB).toFixed(1)} GB`);
  return (
    <Card id="fit" title={year ? "Your firm is ahead of its monthly share" : "Your firm is outgrowing its plan"} line={year ? `${plan}.` : `${plan}, a team of up to ${Math.max(fit.next.people, moved.price.people)} and ${moved.price.aiCredits.toLocaleString("en-IN")} AI credits a month.`}>
      <dl className="set-meters">
        {fit.measures.map((m) => (
          <div key={m.measure}>
            <dt>{m.measure === "returns" ? "Returns due so far" : "InboxCA storage used"}</dt>
            <dd>{figure(m, m.used)} of {figure(m, m.earned)}, {share(m)}%</dd>
            <dd className="set-bar"><span style={{ width: `${Math.min(100, share(m))}%` }} /></dd>
            <dd className="set-meter-note">About {figure(m, m.byMarch)} by March, of {figure(m, m.allowance)} a year</dd>
          </div>
        ))}
      </dl>
      {cycle === "monthly" && <p className="hint set-after">Paid monthly, your plan gives a twelfth of the year each month. What you do not use carries forward to March.</p>}
      <p className="hint set-after">{formula.fitEnforced && !year ? "When your firm passes its plan, InboxCA moves it to the plan that fits and takes the difference, with an email 3 days before." : "Nothing changes until you choose."}</p>
      {action}
    </Card>
  );
}

// Settings, Billing: one card for each thing the owner may do.
export async function BillingCards({ supabase, firmId, ask, Card }: { supabase: Supabase; firmId: string; ask: PlanAsk & { change?: string; error?: string }; Card: (props: CardProps) => React.ReactNode }) {
  if (!billingProvider()) return <Card id="plan" title="Your plan" line="Payments are not set up yet. Your firm uses InboxCA with no payment for now."><p className="hint">Nothing is charged. When Orelu starts taking payments, you will choose your plan here.</p></Card>;
  const [{ formula, tax }, { data: sub }, { data: payments }, { data: firm }, back] = await Promise.all([
    billingSettings(),
    supabase.from("subscriptions").select("cycle, method, status, paid_until, plan").eq("firm_id", firmId).maybeSingle(),
    supabase.from("payments").select("id, kind, amount_paise, gst_paise, status, reason, doc, created_at").eq("firm_id", firmId).order("created_at", { ascending: false }).limit(50),
    supabase.from("firms").select("gstin, state_code, status").eq("id", firmId).single(),
    moneyBack(firmId),
  ]);
  if (!formula) return <Card id="plan" title="Your plan" line="Prices are not set up yet. Try again later."><span /></Card>;
  if (!sub) return <Card id="plan" title="Your plan" line={firm?.status === "pending" ? "Choose your plan on Today to start." : "Your firm is on a pilot. Orelu takes no payment for now."}><span /></Card>;
  const today = indiaDay(new Date());
  const state = firm?.gstin?.slice(0, 2) ?? firm?.state_code ?? "";
  const plan = sub.plan as unknown as SubPlan;
  const cycle = sub.cycle as Cycle;
  const priced = quote(formula, tax, state, plan, cycle, today);
  const admin = supabaseAdmin();
  const [fit, raised] = await Promise.all([fitOf(admin, firmId, formula, sub, today), movingUp(admin, firmId)]);
  // A monthly payer may switch to yearly payment; when the plan fit offers it, its card does.
  const yearly = cycle === "monthly" && sub.paid_until && sub.paid_until > today && !(fit?.notice && fit.yearly) ? toYearly(formula, plan, today, sub.paid_until) : null;
  const coming = plan.next ? quote(formula, tax, state, plan.next, cycle, today) : priced;
  const due = !sub.paid_until || sub.paid_until <= addDays(today, 3);
  const overdue = !!sub.paid_until && sub.paid_until <= today;
  const autopay = sub.status === "active";
  const abovelimit = autopay && coming.recurring.total > plan.maxPaise;
  const per = cycle === "monthly" ? "a month" : "a year";
  const gst = gstOn(tax, today) ? " with GST" : "";
  // A plan change paid after the plan changed was given back: said until anything is paid again.
  const returned = (payments ?? []).findIndex((row) => row.reason === "priced_on_old_plan");
  const retry = returned >= 0 && payments!.slice(0, returned).every((row) => row.kind === "refund" || row.status !== "done");
  const shown = (payments ?? []).filter((row) => row.status === "done" || (row.kind === "refund" && row.status !== "cancelled") || (row.status === "failed" && row.kind === "renewal"));
  // What each add-on costs now, for the rest of the paid period.
  const left = (more: FirmPlan) => (sub.paid_until && sub.paid_until > today ? withGst(prorate(planPrice(formula, more, cycle).paise - priced.price.paise, today, sub.paid_until, cycle), tax, state, today).total : 0);
  const team = Math.max(plan.people, priced.price.people);
  const person = left({ ...plan, people: team + 1 });
  const block = left({ ...plan, aiBlocks: (plan.aiBlocks ?? 0) + 1 });
  const topup = withGst(formula.aiBlock.price * 100, tax, state, today).total;
  const change = ask.change ? askedPlan(ask, plan) : null;
  const changed = change?.success ? planPrice(formula, change.data, cycle) : null;
  const upgrade = changed && sub.paid_until && changed.paise > priced.price.paise ? withGst(prorate(changed.paise - priced.price.paise, today, sub.paid_until, cycle), tax, state, today).total : 0;
  const hidden = (values: Record<string, string>) => Object.entries(values).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
  // After the money back the plan is over: what happened, the receipts and the money back stay.
  const ended = back.state === "refunding" || back.state === "refunded";
  return (
    <>
      {ended ? <Card id="plan" title="Your plan" line="Your plan is cancelled with its money back. Your firm can view everything and download its data in Settings, Your data, for 30 days."><span /></Card> : <>
      <PlanFit firmId={firmId} Card={Card} fit={fit} />
      <Card id="plan" title="Your plan" line={`${priced.price.name} plan, ${rupees(priced.recurring.total)} ${per}${gst}. A team of up to ${team}, ${priced.price.aiCredits.toLocaleString("en-IN")} AI credits a month${plan.aiBlocks ? ` and ${plan.aiBlocks} more AI ${plan.aiBlocks === 1 ? "block" : "blocks"}` : ""}.`}>
        <p role="status">
          {overdue ? <Badge tone="late">Not paid since {longDate(sub.paid_until!)}</Badge> : sub.paid_until ? <Badge tone="done">Paid until {last(sub.paid_until)}</Badge> : <Badge tone="warn">Waiting for the first payment</Badge>}{" "}
          {autopay ? `AutoPay is on with your ${methodWords[sub.method as Method]}${sub.paid_until ? `. Next payment ${rupees(coming.recurring.total)} on ${longDate(sub.paid_until)}` : ""}.` : sub.status === "created" ? "AutoPay is waiting for your bank or payment page." : "AutoPay is off. Nothing more will be taken."}
        </p>
        {retry && <p className="alert" role="alert">A payment was for a plan that had changed, so it was returned. Please try again.</p>}
        {autopay && <p className="hint">Orelu will never take more than {rupees(plan.maxPaise)} at a time without asking you. You get an email 3 days before each payment.</p>}
        {plan.next && <p className="hint">Moves to the {coming.price.name} plan, {rupees(coming.recurring.total)} {per}, at the renewal on {longDate(sub.paid_until!)}.</p>}
        {abovelimit ? (
          <Checkout action={approveCheckout} label="Approve the new AutoPay limit" busy="Opening the payment page">
            <p className="hint">Your plan now costs more than your AutoPay allows. Approve a new limit of {rupees(mandateMax(coming.price.paise, sub.method as Method))} once. Your work carries on meanwhile.</p>
          </Checkout>
        ) : due && sub.paid_until && !autopay ? (
          <Checkout action={buyCheckout} label={`Pay ${rupees(coming.recurring.total)} now`} busy="Opening the payment page">{hidden({ kind: "renewal" })}</Checkout>
        ) : !autopay && sub.status !== "created" ? (
          <Checkout action={startCheckout} label="Turn AutoPay on" busy="Opening the payment page">{hidden({ again: "yes" })}<Methods choices={coming.methods} /></Checkout>
        ) : autopay ? (
          <details className="reveal">
            <summary>Turn AutoPay off</summary>
            <form action={turnOffAutoPay} className="set-foot">
              <p className="hint grow">Nothing more is taken. {sub.paid_until ? `Your plan works until ${last(sub.paid_until)}.` : ""}</p>
              <Pending className="b b-danger" busy="Turning off">Turn AutoPay off</Pending>
            </form>
          </details>
        ) : null}
        {due && overdue && autopay && <Checkout action={buyCheckout} label={`Pay ${rupees(coming.recurring.total)} now`} busy="Opening the payment page">{hidden({ kind: "renewal" })}<p className="hint">The last payment did not go through. Pay now, or InboxCA tries again.</p></Checkout>}
      </Card>

      {yearly && (
        <Card id="yearly" title="Pay yearly" line={`Paid yearly, your plan gives the whole year's returns and InboxCA storage at once. ${rupees(withGst(yearly.paise, tax, state, today).total)}${gst} now pays for it until ${last(yearly.until)}, less what is left of the month paid. Then ${rupees(quote(formula, tax, state, plan.next ?? plan, "yearly", today).recurring.total)} a year${gst}.`}>
          {raised ? <OnItsWay raised={raised} /> : <ToYearly pay={withGst(yearly.paise, tax, state, today).total} paidUntil={sub.paid_until!} today={today} />}
        </Card>
      )}

      <Card id="change" title="Change your plan" line="Moving up starts at once: you pay the difference for the rest of this period. Moving down starts at your next renewal.">
        {(ask.error === "plan" || ask.error === "down") && <p className="alert" role="alert">{ask.error === "down" ? "Your team has more people than that plan takes. Remove people in People first, or keep a bigger team." : "Enter your clients, kind of practice and team size."}</p>}
        <PlanQuestions ask={{ clients: ask.clients ?? String(plan.clients), practice: ask.practice ?? plan.practice, people: ask.people ?? String(plan.people), cycle }} practices={formula.practices} action="/app/settings" hidden={{ group: "billing", change: "1" }} button="See the price" />
        {changed && change?.success && (upgrade ? (
          <Checkout action={buyCheckout} label={`Pay ${rupees(upgrade)} and move up`} busy="Opening the payment page">
            {hidden({ kind: "upgrade", clients: String(change.data.clients), practice: change.data.practice, people: String(change.data.people), aiBlocks: String(plan.aiBlocks ?? 0) })}
            <p>The {changed.name} plan: {rupees(withGst(changed.paise, tax, state, today).total)} {per}{gst} from the next renewal.</p>
          </Checkout>
        ) : changed.paise < priced.price.paise ? (
          <form action={moveDown} className="set-stack">
            {hidden({ clients: String(change.data.clients), practice: change.data.practice, people: String(change.data.people), aiBlocks: String(plan.aiBlocks ?? 0) })}
            <p>The {changed.name} plan: {rupees(withGst(changed.paise, tax, state, today).total)} {per}{gst}, from the renewal on {sub.paid_until ? longDate(sub.paid_until) : "your next payment"}.</p>
            <div className="set-foot"><Pending className="b b-primary" busy="Saving">Move down at renewal</Pending></div>
          </form>
        ) : <p className="hint">That is the plan you have now.</p>)}
        {plan.next && <form action={moveDown} className="set-foot"><input type="hidden" name="undo" value="yes" /><Pending className="b b-ghost" busy="Saving">Keep my plan as it is</Pending></form>}
      </Card>
      </>}

      {!ended && sub.paid_until && sub.paid_until > today && (
        <Card id="addons" title="Add to your plan" line="Paid first: each one is added as soon as its payment is in.">
          <List className="set-rows" rise={false}>
            {[["extra_user", "One more person in your team", person], ["ai_block", `One more AI block of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits every month`, block], ["topup", `An AI top-up of ${formula.aiBlock.credits.toLocaleString("en-IN")} credits for this month`, topup]].map(([kind, words, amount]) => (
              <Item key={kind as string}>
                <span className="grow">{words} <span className="hint">{rupees(amount as number)} now{gst}{kind === "topup" ? "" : `, for the rest of this period`}</span></span>
                <Checkout action={buyCheckout} label="Pay and add" busy="Opening" className="">{hidden({ kind: kind as string })}</Checkout>
              </Item>
            ))}
          </List>
          <form action={saveAutoTopUp} className="set-fields">
            <div>
              <label htmlFor="auto-topup">Auto top-up when AI credits run low</label>
              <select id="auto-topup" name="blocks" defaultValue={String(plan.autoTopUp ?? 0)}>
                <option value="0">Off</option>
                {Array.from({ length: Math.max(0, priced.price.blockCap - (plan.aiBlocks ?? 0)) }, (_, at) => <option key={at} value={at + 1}>Up to {at + 1} a month, {rupees(topup)} each</option>)}
              </select>
            </div>
            <div className="set-foot"><Pending className="b b-secondary" busy="Saving">Save</Pending></div>
          </form>
        </Card>
      )}

      <Card id="receipts" title="Receipts and invoices" line="Every payment and every refund makes one, emailed to you. Open one to print it or save it as a PDF.">
        {shown.length ? (
          <List className="set-rows" rise={false}>
            {shown.map((row) => {
              const doc = row.doc as unknown as Doc | null;
              return (
                <Item key={row.id}>
                  <span className="grow">
                    <strong>{doc ? `${docTitles[doc.kind]} ${doc.no}` : kindWords[row.kind]}</strong>{" "}
                    <span className="hint">{longDate(doc?.date ?? indiaDay(new Date(row.created_at)))}, {rupees(row.amount_paise)}</span>
                  </span>
                  {row.status === "failed" ? <Badge tone="late">{row.kind === "refund" ? "Being tried again" : "Did not go through"}</Badge> : row.kind === "refund" && row.status !== "done" ? <Badge tone="warn">Refund in progress</Badge> : row.kind === "refund" ? <Badge tone="done">Given back</Badge> : <Badge tone="done">Paid</Badge>}
                  {doc ? <Link className="b b-ghost" href={`/app/settings/billing/${row.id}`} target="_blank">Open</Link> : row.status === "done" && <span className="hint">Being made</span>}
                </Item>
              );
            })}
          </List>
        ) : <p className="hint">No payments yet.</p>}
      </Card>

      {back.state !== "none" && (
        <Card id="money_back" title="Money back" danger={back.state === "open"} line={
          back.state === "open" ? `Cancel by ${longDate(back.lastDay)}, within 14 days of your first payment, and get it back in full. Your firm can then only view, and you can download your data for 30 days.`
          : back.state === "refunding" ? "Your plan is cancelled and your money is on its way back. Banks usually take 5 to 7 working days."
          : back.state === "refunded" ? "Your plan is cancelled and your money was given back."
          : back.state === "late" ? `The 14 days for money back ended on ${longDate(back.lastDay)}. Turning AutoPay off stops the next payment.`
          : "This firm already had its money back once."}>
          {back.state === "open" && (
            <details className="reveal">
              <summary>Cancel and get my money back</summary>
              <p className="hint">The one time setup is kept once the first import of your past papers has started. Enter the code from your authenticator app to confirm.</p>
              <MoneyBackForm action={moneyBackAction} />
            </details>
          )}
        </Card>
      )}
    </>
  );
}
