import { Badge, PageHead } from "@/app/(app)/app/ui";
import { dueLabel } from "@/src/lib/calendar";
import { currentAdmin } from "../admin";

// The due date rules and the government's extensions, those a CA has not yet checked first.
// A rule moves dates only once a CA has checked it against its official source.
export default async function AdminDueDates() {
  const { supabase } = await currentAdmin();
  const { data: rules, error } = await supabase.from("compliance_types")
    .select("code, period_key, name, source_url, verified_on, approved_by")
    .order("verified_on", { nullsFirst: true }).order("code").order("period_key");
  if (error) throw new Error(`Admin due dates failed: ${error.code}`);
  const waiting = rules.filter((rule) => !rule.verified_on).length;
  return (
    <>
      <PageHead title="Due dates" sub={`${waiting} of ${rules.length} rules wait for a CA to check them against the official notification.`} />
      <section className="admin-card" aria-label="Due date rules">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Rule</th><th>Applies to</th><th>Status</th><th>Checked by</th><th>Source</th></tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={`${rule.code}${rule.period_key}`}>
                  <td><strong>{rule.name ?? rule.code}</strong> <span className="sub-inline num">{rule.code}</span></td>
                  <td>{rule.period_key ? <>Extension for <span className="num">{rule.period_key}</span></> : "Every period"}</td>
                  <td>{rule.verified_on ? <Badge tone="done">Checked {dueLabel(rule.verified_on)}</Badge> : <Badge tone="warn">Not checked</Badge>}</td>
                  <td>{rule.approved_by ?? "Nobody yet"}</td>
                  <td>{rule.source_url ? <a href={rule.source_url} target="_blank" rel="noreferrer">Open the notification</a> : "None yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
