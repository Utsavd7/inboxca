import { Badge, PageHead } from "@/app/(app)/app/ui";
import { currentAdmin, when } from "../admin";

// Every firm's connected mailbox and drive, never their addresses: when each last ran, and
// what went wrong if anything did.
export default async function AdminMailboxes() {
  const { supabase } = await currentAdmin();
  const { data: accounts, error } = await supabase.rpc("admin_accounts");
  if (error) throw new Error(`Admin accounts failed: ${error.code}`);
  const broken = accounts.filter((account) => account.status !== "connected").length;
  return (
    <>
      <PageHead title="Mailboxes" sub={`${accounts.length} connected mailboxes and drives, ${broken} need the firm to connect again.`} />
      <section className="admin-card" aria-label="Mailboxes and drives">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Firm</th><th>Kind</th><th>Status</th><th>Last run</th><th>Failed sign ins</th><th>Last error</th></tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={`${account.firm}${account.kind}`}>
                  <td><strong>{account.firm}</strong></td>
                  <td>{account.kind === "mail" ? "Mailbox" : "Drive"} <span className="sub-inline">{account.provider}</span></td>
                  <td><Badge tone={account.status === "connected" ? "done" : "late"}>{account.status === "connected" ? "Connected" : "Connect again"}</Badge></td>
                  <td className="num">{when(account.last_run)}</td>
                  <td className="num">{account.failures}</td>
                  <td className="num">{account.last_error ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
