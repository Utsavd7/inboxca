import { PageHead } from "@/app/(app)/app/ui";
import { fixedSuggestion } from "@/src/lib/office";
import { setOffice } from "../actions";
import { currentAdmin } from "../admin";
import { Submit } from "../parts";

// The fixed connection suggestion (PLAN.md 5.8): its thresholds for every firm, and each firm's
// and each internet provider's office changes and confirmations, so the numbers can be tuned.
export default async function AdminOffice({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await currentAdmin();
  const rule = await fixedSuggestion();
  const [{ data: firms, error }, { error: problem }] = await Promise.all([supabase.rpc("admin_office", { days: rule.days }), searchParams]);
  if (error) throw new Error(`Admin office failed: ${error.code}`);
  const providers = Map.groupBy(firms, (firm) => firm.provider || "Not known");
  return (
    <>
      <PageHead title="Office connections" sub={`Firms with the Office only switch on, over the last ${rule.days} days.`} />
      {problem === "thresholds" && <p className="alert" role="alert">Choose 1 to 50 confirmations in 1 to 90 days.</p>}
      <section className="admin-card" aria-label="Fixed connection suggestion">
        <h2>Fixed connection suggestion</h2>
        <form action={setOffice} className="admin-row admin-form">
          <span className="grow sub">An owner is told how to ask for a fixed connection after this many office confirmations, or while no PC stays in the office.</span>
          <label>Confirmations <input name="taps" type="number" min={1} max={50} defaultValue={rule.taps} required /></label>
          <label>In days <input name="days" type="number" min={1} max={90} defaultValue={rule.days} required /></label>
          <Submit>Save</Submit>
        </form>
      </section>
      <section className="admin-card" aria-label="By provider">
        <h2>By internet provider</h2>
        {providers.size ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Provider</th><th>Firms</th><th>Changes</th><th>Confirmations</th><th>Fixed</th></tr></thead>
              <tbody>
                {[...providers].map(([provider, rows]) => (
                  <tr key={provider}>
                    <td><strong>{provider}</strong></td>
                    <td className="num">{rows.length}</td>
                    <td className="num">{rows.reduce((sum, row) => sum + row.changes, 0)}</td>
                    <td className="num">{rows.reduce((sum, row) => sum + row.taps, 0)}</td>
                    <td className="num">{rows.filter((row) => row.fixed).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="admin-empty"><strong>No firm uses Office only yet</strong>Firms show here once they turn it on.</p>}
        {!process.env.OFFICE_PROVIDER_HEADER && <p className="admin-note">Providers are not known until the host names them in a request header (OFFICE_PROVIDER_HEADER).</p>}
      </section>
      {!!firms.length && (
        <section className="admin-card" aria-label="By firm">
          <h2>By firm</h2>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Firm</th><th>Provider</th><th>Changes</th><th>Confirmations</th><th>Fixed connection</th></tr></thead>
              <tbody>
                {firms.map((firm) => (
                  <tr key={firm.firm}>
                    <td><strong>{firm.firm}</strong></td>
                    <td>{firm.provider || "Not known"}</td>
                    <td className="num">{firm.changes}</td>
                    <td className="num">{firm.taps}</td>
                    <td>{firm.fixed ? "Yes" : firm.declined ? "Provider does not offer it" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
