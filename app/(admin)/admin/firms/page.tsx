import Link from "next/link";
import { Badge, PageHead } from "@/app/(app)/app/ui";
import { checkSplit } from "../actions";
import { currentAdmin, when } from "../admin";
import { Submit } from "../parts";

const yesNo = (on: boolean) => <Badge tone={on ? "done" : "warn"}>{on ? "Connected" : "Not connected"}</Badge>;
// Two firms that may be one (D38 (6)), from the nightly check: what matched, never the values.
type Split = { firms: string[]; evidence: string[]; clients?: number; share?: number; since: string; checked?: { verdict: string; at: string }; names: { id: string; name: string }[] };
const matched: Record<string, string> = { pan: "Same firm PAN", owner: "Same owner login", mail: "Same mailbox", drive: "Same drive account" };
const evidence = (split: Split) => [...split.evidence.filter((kind) => kind !== "clients").map((kind) => matched[kind] ?? kind), split.clients && `${split.clients} client PANs in common, ${split.share}% of the smaller firm's`].filter(Boolean).join(", ");

// Every firm's health, with no client data at all.
export default async function AdminFirms() {
  const { supabase } = await currentAdmin();
  const [{ data: firms, error }, { data: splits }] = await Promise.all([supabase.rpc("admin_firms"), supabase.rpc("admin_split_firms")]);
  if (error) throw new Error(`Admin firms failed: ${error.code}`);
  return (
    <>
      <PageHead title="Firms" sub={`${firms.length} firms. Health only: client names, emails, papers and figures stay with each firm.`} />
      {!!(splits as Split[] | null)?.length && (
        <section className="admin-card" aria-label="May be one firm">
          <h2>May be one firm</h2>
          <p className="admin-note">One firm signing up as several is against the terms. Only Orelu sees this; nothing is blocked. Check with the firms, then record what you found.</p>
          {(splits as Split[]).map((split) => (
            <div className="admin-row" key={split.firms.join()}>
              <div className="grow">
                <strong>{split.names.map((firm) => firm.name).join(" and ")}</strong>
                <span className="sub">{evidence(split)}. Found {when(split.since)}.</span>
              </div>
              {split.checked ? <Badge tone={split.checked.verdict === "one" ? "late" : "done"}>{split.checked.verdict === "one" ? "One firm" : "Separate firms"}</Badge>
                : (["separate", "one"] as const).map((verdict) => (
                  <form action={checkSplit} key={verdict}>
                    <input type="hidden" name="first" value={split.firms[0]} />
                    <input type="hidden" name="second" value={split.firms[1]} />
                    <input type="hidden" name="verdict" value={verdict} />
                    <Submit>{verdict === "one" ? "One firm" : "Separate firms"}</Submit>
                  </form>
                ))}
            </div>
          ))}
        </section>
      )}
      <section className="admin-card" aria-label="Firms">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Firm</th><th>Status</th><th>Started</th><th>People</th><th>Mailbox</th><th>Drive</th><th>Last activity</th></tr>
            </thead>
            <tbody>
              {firms.map((firm) => (
                <tr key={firm.id}>
                  <td><Link className="row-link" href={`/admin/firms/${firm.id}`}><strong>{firm.name}</strong></Link></td>
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
