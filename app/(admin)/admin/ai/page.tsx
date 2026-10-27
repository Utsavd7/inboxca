import Link from "next/link";
import { Badge, PageHead } from "@/app/(app)/app/ui";
import { aiReady } from "@/src/lib/ai";
import { currentAdmin } from "../admin";

type Row = { calls: number; hits: number; again: number; credits: number; cost: number | null };
type Report = { reasons: (Row & { reason: string })[]; firms: (Row & { id: string; name: string })[] };
const rate = (row: Row) => (row.calls + row.hits ? `${Math.round((100 * row.hits) / (row.calls + row.hits))}%` : "");
const rupees = (cost: number | null) => (cost === null ? "" : `₹${Number(cost).toFixed(2)}`);

// The AI efficiency report (PLAN.md D29): the last 30 days of AI by reason and by firm, how many
// answers came from the cache with no AI, and calls that sent AI the same email or paper again,
// which the cache should have answered. Counts only, never what was sent or answered.
export default async function AdminAi() {
  const { supabase } = await currentAdmin();
  const { data, error } = await supabase.rpc("admin_ai_report");
  if (error) throw new Error(`Admin AI report failed: ${error.code}`);
  const report = data as unknown as Report;
  const repeated = report.firms.filter((firm) => firm.again);
  const heads = ["AI calls", "From the cache", "Cache rate", "Sent twice", "Credits", "Cost"].map((name) => <th key={name}>{name}</th>);
  const cells = (row: Row) => <><td className="num">{row.calls}</td><td className="num">{row.hits}</td><td className="num">{rate(row)}</td><td className="num">{row.again}</td><td className="num">{row.credits.toLocaleString("en-IN")}</td><td className="num">{rupees(row.cost)}</td></>;
  return (
    <>
      <PageHead title="AI use" sub={aiReady() ? "The last 30 days. Counts only, never what was sent or answered." : "AI is off until its key is set: nothing is called or charged."} />
      <section className="admin-card" aria-label="Avoidable calls">
        <h2>Avoidable calls</h2>
        {repeated.map((firm) => (
          <div className="admin-row" key={firm.id}>
            <Badge tone="warn">Sent twice</Badge>
            <span className="grow">{firm.name} sent AI the same email or paper again {firm.again === 1 ? "once" : `${firm.again} times`}. The cache should have answered.</span>
            <Link href={`/admin/firms/${firm.id}`}>Open firm</Link>
          </div>
        ))}
        {!repeated.length && <p className="admin-empty"><strong>Nothing to look at</strong>No firm sent AI the same thing twice.</p>}
      </section>

      <section className="admin-card" aria-label="By reason">
        <h2>By reason</h2>
        {report.reasons.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Reason</th>{heads}</tr></thead>
              <tbody>{report.reasons.map((row) => <tr key={row.reason}><td>{row.reason}</td>{cells(row)}</tr>)}</tbody>
            </table>
          </div>
        ) : <p className="admin-empty"><strong>No AI calls yet</strong>Each call shows here by its reason.</p>}
      </section>

      <section className="admin-card" aria-label="By firm">
        <h2>By firm</h2>
        {report.firms.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Firm</th>{heads}</tr></thead>
              <tbody>{report.firms.map((row) => <tr key={row.id}><td>{row.name}</td>{cells(row)}</tr>)}</tbody>
            </table>
          </div>
        ) : <p className="admin-empty"><strong>No AI calls yet</strong>Each firm that uses AI shows here.</p>}
      </section>
    </>
  );
}
