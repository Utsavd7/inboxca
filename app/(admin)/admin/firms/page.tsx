import { Badge, PageHead } from "@/app/(app)/app/ui";
import { currentAdmin, when } from "../admin";

const yesNo = (on: boolean) => <Badge tone={on ? "done" : "warn"}>{on ? "Connected" : "Not connected"}</Badge>;

// Every firm's health, with no client data at all.
export default async function AdminFirms() {
  const { supabase } = await currentAdmin();
  const { data: firms, error } = await supabase.rpc("admin_firms");
  if (error) throw new Error(`Admin firms failed: ${error.code}`);
  return (
    <>
      <PageHead title="Firms" sub={`${firms.length} firms. Health only: client names, emails, papers and figures stay with each firm.`} />
      <section className="admin-card" aria-label="Firms">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Firm</th><th>Status</th><th>Started</th><th>People</th><th>Mailbox</th><th>Drive</th><th>Last activity</th></tr>
            </thead>
            <tbody>
              {firms.map((firm) => (
                <tr key={firm.id}>
                  <td><strong>{firm.name}</strong></td>
                  <td><Badge tone={firm.status === "active" ? "done" : firm.status === "closed" ? "" : "warn"}>{firm.status[0].toUpperCase() + firm.status.slice(1).replace("_", " ")}</Badge></td>
                  <td className="num">{when(firm.created_at)}</td>
                  <td className="num">{firm.members}</td>
                  <td>{yesNo(firm.mailbox)}</td>
                  <td>{yesNo(firm.drive)}</td>
                  <td className="num">{when(firm.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
