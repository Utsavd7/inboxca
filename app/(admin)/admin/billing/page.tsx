import { states } from "@/app/(auth)/sign-up/states";
import { Badge, PageHead } from "@/app/(app)/app/ui";
import type { Alert } from "@/src/lib/billing/billing";
import { reasonWords } from "@/src/lib/billing/documents";
import { financialYear, gstOn, indiaDay, rupees, type Tax } from "@/src/lib/billing/money";
import { billingReady } from "@/src/lib/billing/provider";
import { refundPayment, saveTax } from "../actions";
import { currentAdmin, when } from "../admin";
import { Submit } from "../parts";

type Billing = {
  payments: { id: string; firm: string | null; kind: string; amount: number; gst: number; fee: number | null; status: string; reason: string | null; at: string; no: string | null; refundable: boolean }[];
  months: { month: string; new_firms: number; refunds: number; money_back: number; duplicate: number; charge_error: number; refunded: number }[];
  tax: Partial<Tax>;
  alerts: Alert[];
};
const kinds: Record<string, string> = { plan: "First payment", renewal: "Renewal", upgrade: "Upgrade", yearly: "Switch to yearly", extra_user: "Extra person", ai_block: "AI block", topup: "AI top-up", setup: "Setup", refund: "Refund" };
const alertWords: Record<string, string> = {
  refund_failed: "A refund failed. InboxCA tries again in an hour, up to three times.",
  paid_twice: "A firm paid the same period twice. Give one back below as taken twice.",
  tax_details_missing: "Receipts are waiting for Orelu's tax details below.",
  amount_or_state_differs: "Cashfree's record of a payment differs from InboxCA's.",
  unknown_at_provider: "Cashfree has a payment InboxCA does not know.",
  not_settled: "A payment has not settled in 7 days.",
  mandate_cancel_failed: "A firm's AutoPay could not be cancelled at Cashfree. Cancel it in Cashfree's dashboard.",
  ai_repeated: "A firm sent AI the same email or paper twice. See AI use.",
  charge_unsure: "Cashfree did not answer a debit. InboxCA raises it again with the same id each day; check it in Cashfree's dashboard.",
  refund_unsure: "Cashfree did not answer a refund. InboxCA asks again with the same id within the hour.",
  first_debit_failed: "A firm's first bank mandate debit could not be raised. InboxCA raises it again each day, up to three times.",
  jobs_stopped: "Work stopped part way. See Failed jobs.",
};
// D32: Orelu registers for GST before its turnover across all its products passes the threshold;
// the admin console alerts at ₹15 lakh in a financial year.
const TURNOVER_ALERT_PAISE = 15_00_000_00;

// Orelu's billing (PLAN.md 5.14.1): what needs a look, payments and refunds, refunds by month and
// reason with the 10% alert, and the tax details every receipt and invoice is made from.
export default async function AdminBilling({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await currentAdmin();
  const [{ data, error }, { error: problem }] = await Promise.all([supabase.rpc("admin_billing"), searchParams]);
  if (error) throw new Error(`Admin billing failed: ${error.code}`);
  const billing = data as unknown as Billing;
  const tax = billing.tax;
  const fy = financialYear(indiaDay(new Date()));
  const high = billing.months.filter((month) => month.new_firms && month.money_back / month.new_firms > 0.1);
  const turnover = tax.turnover?.[fy] ?? 0;
  return (
    <>
      <PageHead title="Billing" sub={billingReady() ? "Payments through Orelu's Cashfree account." : "Cashfree is not set up yet: firms sign up and work with no payment."} />
      {problem && <p className="alert" role="alert">{problem === "tax" ? "Check the tax details: a PAN, and for GST all of GSTIN (starting with its state code and holding the PAN), state, SAC, rate and start date." : problem === "reason" ? "Choose why the payment is given back." : "That payment cannot be given back: it is not paid, or a refund is already on its way."}</p>}
      <section className="admin-card" aria-label="Needs a look">
        <h2>Needs a look</h2>
        {high.map((month) => <div className="admin-row" key={month.month}><Badge tone="late">Refunds above 10%</Badge><span className="grow">{month.month}: {month.money_back} money back of {month.new_firms} new firms.</span></div>)}
        {!tax.gstin && turnover >= TURNOVER_ALERT_PAISE && <div className="admin-row"><Badge tone="late">GST</Badge><span className="grow">Orelu&apos;s turnover for {fy} is {rupees(turnover)}. Register for GST before the threshold, with a CA.</span></div>}
        {billing.alerts.map((alert) => <div className="admin-row" key={alert.kind + alert.ref + alert.at}><Badge tone="warn">{when(alert.at)}</Badge><span className="grow">{alertWords[alert.kind] ?? alert.kind}</span>{alert.ref && <span className="sub num">{alert.ref.slice(0, 8)}</span>}</div>)}
        {!high.length && !billing.alerts.length && !(!tax.gstin && turnover >= TURNOVER_ALERT_PAISE) && <p className="admin-empty"><strong>Nothing to look at</strong>Payments, refunds and settlements all match.</p>}
      </section>

      <section className="admin-card" aria-label="Refunds by month">
        <h2>Refunds by month and reason</h2>
        {billing.months.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Month</th><th>New firms</th><th>{reasonWords.money_back}</th><th>Taken twice</th><th>Taken in error</th><th>Given back</th></tr></thead>
              <tbody>{billing.months.map((month) => (
                <tr key={month.month}><td className="num">{month.month}</td><td className="num">{month.new_firms}</td><td className="num">{month.money_back}</td><td className="num">{month.duplicate}</td><td className="num">{month.charge_error}</td><td className="num">{rupees(month.refunded)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="admin-empty"><strong>No payments yet</strong>They show here by month.</p>}
      </section>

      <section className="admin-card" aria-label="Payments">
        <h2>Payments and refunds</h2>
        {billing.payments.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>When</th><th>Firm</th><th>What</th><th>Amount</th><th>Cashfree fee</th><th>Document</th><th>State</th><th /></tr></thead>
              <tbody>{billing.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="num">{when(payment.at)}</td>
                  <td>{payment.firm ?? "Deleted firm"}</td>
                  <td>{kinds[payment.kind] ?? payment.kind}{payment.reason ? `, ${reasonWords[payment.reason] ?? payment.reason}` : ""}</td>
                  <td className="num">{rupees(payment.amount)}{payment.gst ? ` (GST ${rupees(payment.gst)})` : ""}</td>
                  <td className="num">{payment.fee === null ? "Not settled" : rupees(payment.fee)}</td>
                  <td className="num">{payment.no ?? ""}</td>
                  <td><Badge tone={payment.status === "done" ? "done" : payment.status === "failed" ? "late" : ""}>{payment.status === "done" ? "Done" : payment.status === "failed" ? "Failed" : payment.status === "created" ? "Waiting" : "Called off"}</Badge></td>
                  <td>{payment.refundable && (
                    <form action={refundPayment} className="admin-form">
                      <input type="hidden" name="payment" value={payment.id} />
                      <select name="reason" aria-label="Why it is given back" defaultValue="duplicate"><option value="duplicate">Taken twice</option><option value="charge_error">Taken in error</option></select>
                      <Submit>Give back in full</Submit>
                    </form>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="admin-empty"><strong>No payments yet</strong>Each payment and refund shows here.</p>}
      </section>

      <section className="admin-card" aria-label="Tax details">
        <h2>Orelu&apos;s tax details</h2>
        <p className="admin-row sub">On every receipt and invoice. {gstOn(tax as Tax, indiaDay(new Date())) ? "GST is charged now." : tax.gstFrom ? `GST is charged from ${tax.gstFrom}.` : "Until a GSTIN and its start date are set, receipts say Orelu is not GST registered and carry no GST."}</p>
        <form action={saveTax} className="admin-row admin-form">
          <label>Legal name <input name="legalName" required defaultValue={tax.legalName} /></label>
          <label>Address <input name="address" required defaultValue={tax.address} /></label>
          <label>PAN <input name="pan" required maxLength={10} defaultValue={tax.pan} /></label>
          <label>GSTIN <input name="gstin" maxLength={15} defaultValue={tax.gstin} /></label>
          <label>State <select name="stateCode" defaultValue={tax.stateCode ?? ""}><option value="">Not set</option>{states.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label>SAC <input name="sac" inputMode="numeric" maxLength={8} defaultValue={tax.sac} /></label>
          <label>GST rate, % <input name="rate" type="number" step="0.01" min={0} max={28} defaultValue={tax.rate} /></label>
          <label>GST from <input name="gstFrom" type="date" defaultValue={tax.gstFrom} /></label>
          <label>Signs credit notes <input name="signatory" defaultValue={tax.signatory} /></label>
          <label>Turnover {fy}, ₹, all products <input name="turnover" type="number" min={0} defaultValue={turnover ? turnover / 100 : undefined} /></label>
          <Submit>Save</Submit>
        </form>
      </section>
    </>
  );
}
