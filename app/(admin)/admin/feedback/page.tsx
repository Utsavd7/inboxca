import { PageHead } from "@/app/(app)/app/ui";
import { reportKinds, type ReportKind } from "@/src/lib/report";
import { currentAdmin, when } from "../admin";

// What people in firms reported from Report a problem or idea, newest first. Each arrived as an
// email to Orelu support with its files; this list keeps the words for 12 months and nothing else.
export default async function AdminReports() {
  const { supabase } = await currentAdmin();
  const { data: reports, error } = await supabase.rpc("admin_feedback");
  if (error) throw new Error(`Admin reports failed: ${error.code}`);
  return (
    <>
      <PageHead title="Reports" sub="Problems and ideas sent from inside InboxCA. Each one also reached the support email with its pictures or recording. Kept 12 months." />
      <section className="admin-card" aria-label="Reports">
        {reports.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr><th>Firm</th><th>Person</th><th>Kind</th><th>Subject</th><th>Page</th><th>Sent</th></tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td><strong>{report.firm}</strong></td>
                    <td>{report.person}</td>
                    <td>{reportKinds[report.kind as ReportKind]}</td>
                    <td>{report.subject}{report.details && <span className="sub">{report.details}</span>}</td>
                    <td className="num">{report.page || "Not known"}</td>
                    <td className="num">{when(report.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-empty"><strong>No reports yet</strong>Problems and ideas people send from Help show here.</p>
        )}
      </section>
    </>
  );
}
