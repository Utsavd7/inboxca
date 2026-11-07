import { Badge, PageHead } from "@/app/(app)/app/ui";
import { redirect } from "next/navigation";
import { currentAdmin, PAGE, pageRows, providerName, when } from "../admin";
import { Pager } from "../parts";

// Every firm's connected mailbox and drive, never their addresses: when each last ran, and
// what went wrong if anything did.
export default async function AdminMailboxes({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { supabase } = await currentAdmin();
  const { page, from, to } = pageRows((await searchParams).page);
  const [{ data: accounts, count, error }, { count: broken }] = await Promise.all([
    supabase.rpc("admin_accounts", undefined, { count: "exact" }).range(from, to),
    supabase.rpc("admin_accounts", undefined, { count: "exact", head: true }).neq("status", "connected"),
  ]);
  if (error?.code === "PGRST103") redirect("/admin/mailboxes");
  if (error) throw new Error(`Admin accounts failed: ${error.code}`);
  return (
    <>
      <PageHead title="Mailboxes" sub={broken ? `${broken} of ${count} mailboxes and drives need the firm to connect again. They come first.` : `${count ?? 0} mailboxes and drives, all connected.`} />
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
                  <td>{account.kind === "mail" ? "Mailbox" : "Drive"} <span className="sub-inline">{providerName(account.provider)}</span></td>
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
      <Pager page={page} size={PAGE} total={count ?? 0} label="Mailbox pages" />
    </>
  );
}
