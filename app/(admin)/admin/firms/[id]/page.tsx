import { notFound } from "next/navigation";
import { Badge, PageHead, storage } from "@/app/(app)/app/ui";
import { downloadUse } from "@/src/lib/download-use";
import { askSupport, retryJob, startPilot } from "../../actions";
import { currentAdmin, when } from "../../admin";
import { Submit } from "../../parts";

type Firm = {
  name: string; status: string; created_at: string; members: number;
  accounts: { kind: string; provider: string; status: string; failures: number; last_run: string | null; last_error: string | null }[];
  failed: { id: number; kind: string; error: string | null; attempts: number; at: string }[];
  support: { status: string; expires_at: string | null; mine: boolean } | null;
};
type Look = { until: string; people: { email: string; role: string; status: string }[]; clients: number; names: string[] };

// One firm's health (PLAN.md 2.20): its mailbox and drive, its failed jobs, its returns and
// InboxCA storage this year, and support access, which its owner approves for an hour.
export default async function AdminFirm({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await currentAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data, error }, { data: usage }, downloads] = await Promise.all([supabase.rpc("admin_firm", { target: id }), supabase.rpc("firm_usage", { target_firm: id }), downloadUse(id).catch(() => null)]);
  if (error) throw new Error(`Admin firm failed: ${error.code}`);
  const firm = data as Firm | null;
  if (!firm) notFound();
  const open = firm.support?.status === "approved" && !!firm.support.expires_at && new Date(firm.support.expires_at) > new Date();
  const look = open && firm.support?.mine ? ((await supabase.rpc("admin_support_view", { target: id })).data as Look | null) : null;
  const year = usage?.[0];
  return (
    <>
      <PageHead title={firm.name} crumbs={[["/admin/firms", "Firms"]]} sub={`${firm.status[0].toUpperCase()}${firm.status.slice(1).replace("_", " ")}, started ${when(firm.created_at)}, ${firm.members === 1 ? "1 person" : `${firm.members} people`}.`} />
      {firm.status === "pending" && (
        <section className="admin-card" aria-label="Pilot">
          <form action={startPilot} className="admin-row">
            <input type="hidden" name="firm" value={id} />
            <span className="grow sub">The firm has not paid yet. A pilot firm starts now, with no payment.</span>
            <Submit>Start as a pilot</Submit>
          </form>
        </section>
      )}
      <section className="admin-card" aria-label="Mailbox and drive">
        <h2>Mailbox and drive</h2>
        {firm.accounts.length ? firm.accounts.map((account) => (
          <div className="admin-row" key={account.kind}>
            <div className="grow">
              <strong>{account.kind === "mail" ? "Mailbox" : "Drive"}</strong> <span className="sub-inline">{account.provider}</span>
              <span className="sub">Last run {when(account.last_run)}, {account.failures} failed sign ins, last error {account.last_error ?? "none"}</span>
            </div>
            <Badge tone={account.status === "connected" ? "done" : "late"}>{account.status === "connected" ? "Connected" : "Connect again"}</Badge>
          </div>
        )) : <p className="admin-empty"><strong>Nothing connected</strong>The firm has not connected a mailbox or drive yet.</p>}
      </section>
      <section className="admin-card" aria-label="Use this year">
        <h2>Use this year</h2>
        <div className="admin-row">
          <strong className="grow">Returns in the calendar</strong>
          <span className="sub">{year ? `${year.returns_so_far.toLocaleString("en-IN")} due so far of ${year.returns_this_year.toLocaleString("en-IN")} by March` : "Not counted"}</span>
        </div>
        <div className="admin-row">
          <strong className="grow">InboxCA storage</strong>
          <span className="sub">{year ? `${storage(year.workspace_bytes)}, about ${storage(year.workspace_by_march)} by March` : "Not counted"}</span>
        </div>
        <div className="admin-row">
          <strong className="grow">Downloads this month</strong>
          <span className="sub">{downloads ? `${downloads.used.toLocaleString("en-IN")}${Number.isFinite(downloads.most) ? ` of ${downloads.most.toLocaleString("en-IN")}` : ""}` : "Not counted"}</span>
        </div>
        <div className="admin-row">
          <strong className="grow">AI use</strong>
          <span className="sub">Not counted yet: AI use is metered once AI credits are built.</span>
        </div>
      </section>
      <section className="admin-card" aria-label="Failed jobs">
        <h2>Failed jobs</h2>
        {firm.failed.length ? firm.failed.map((job) => (
          <div className="admin-row" key={job.id}>
            <div className="grow">
              <strong className="num">{job.kind}</strong>
              <span className="sub">{job.error ?? "No error code"}, {job.attempts} tries, last {when(job.at)}</span>
            </div>
            <form action={retryJob}>
              <input type="hidden" name="job" value={job.id} />
              <Submit>Try again</Submit>
            </form>
          </div>
        )) : <p className="admin-empty"><strong>No failed jobs</strong>Everything this firm asked for ran.</p>}
      </section>
      <section className="admin-card" aria-label="Support access">
        <h2>Support access</h2>
        {look ? (
          <>
            <p className="admin-note">The owner allowed you to look until {when(look.until)}. Each look is in the firm&apos;s activity log.</p>
            {look.people.map((person) => (
              <div className="admin-row" key={person.email}>
                <strong className="grow">{person.email}</strong>
                <span className="sub">{person.role.replace("_", " ")}, {person.status}</span>
              </div>
            ))}
            <div className="admin-row"><span className="sub">{look.clients} clients: {look.names.join(", ")}{look.clients > look.names.length && ", and more"}</span></div>
          </>
        ) : (
          <div className="admin-row">
            <span className="grow sub">
              {firm.support?.status === "pending" ? "Waiting for the owner to approve in Settings." : open ? "Another Orelu admin has this hour." : "Orelu sees no client data. To help with a problem, ask the owner for an hour's look at the firm's people and client names."}
            </span>
            {firm.support?.status !== "pending" && !open && (
              <form action={askSupport}>
                <input type="hidden" name="firm" value={id} />
                <Submit>Ask the owner</Submit>
              </form>
            )}
          </div>
        )}
      </section>
    </>
  );
}
