import { Check, FileText, Mail } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { manageEmail } from "@/app/(app)/actions";
import { serverCrypto } from "@/src/lib/crypto";
import { currentMember } from "@/src/lib/member";
import { AutoSelect } from "../auto-select";
import { Avatar, Badge, Empty, PageHead } from "../ui";
import { labels } from "@/src/lib/triage";

const reasons: Record<string, string> = {
  no_rule: "InboxCA could not tell what it asks",
  data_unclear: "Data for more than one kind of work",
  client_unclear: "The sender writes for several clients",
};
const byIdOf = <T extends { id: string }>(rows: T[] | null, id: string) => rows?.find((row) => row.id === id);
const when = (at: string) =>
  new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Client email as InboxCA sorted it: what waits for the team, and the latest mail with its
// label. Only labels and times are kept; the email itself stays in the firm's mailbox.
export default async function Inbox() {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ data: events }, { data: waiting }, { data: toCheck }] = await Promise.all([
    supabase
      .from("email_events")
      .select("id, client_id, contact_id, received_at, label, decision_source, clients(name), contacts(name_enc)")
      .order("received_at", { ascending: false })
      .order("id")
      .limit(100),
    supabase.from("requests").select("id, entity_id, reason_code").eq("kind", "team_reply").eq("status", "pending"),
    supabase.from("documents").select("id, client_id, name, clients(name)").eq("status", "to_check").limit(50),
  ]);
  // For mail from a contact who writes for several clients: the clients to choose from.
  const unclear = (waiting ?? []).flatMap((request) => (request.reason_code === "client_unclear" ? [byIdOf(events, request.entity_id)?.contact_id] : [])).filter(Boolean) as string[];
  const { data: links } = unclear.length ? await supabase.from("contact_clients").select("contact_id, client_id, clients(name)").in("contact_id", unclear) : { data: [] };
  const crypto = serverCrypto();
  const sender = new Map(
    await Promise.all(
      (events ?? []).map(async (event) => [
        event.id,
        event.clients?.name ?? (event.contacts ? await crypto.decrypt(membership.firmId, `contacts/${event.contact_id}/name`, event.contacts.name_enc) : ""),
      ] as const),
    ),
  );
  const byId = new Map(events?.map((event) => [event.id, event]));

  return (
    <>
      <PageHead title="Inbox" sub="Client email as InboxCA sorted it. The email itself stays in your mailbox; only its label and time are kept here." />
      <section className="panel" aria-labelledby="team-reply">
        <div className="panel-head">
          <h2 id="team-reply">Needs team reply</h2>
          <p className="hint">Reply from your own mailbox, then mark it done.</p>
        </div>
        <ul className="rows needs">
          {waiting?.map((request) => {
            const event = byId.get(request.entity_id);
            const name = sender.get(request.entity_id) || "A contact";
            return (
              <li key={request.id}>
                <Avatar name={name} />
                <span className="grow">
                  {event?.client_id ? (
                    <Link className="name" href={`/app/clients/${event.client_id}`}>
                      {name}
                    </Link>
                  ) : (
                    <span className="name">{name}</span>
                  )}
                  <span className="sub">{reasons[request.reason_code ?? ""] ?? labels.other}</span>
                </span>
                <form action={manageEmail} className="end">
                  {event && <span className="when">{when(event.received_at)}</span>}
                  <input type="hidden" name="request" value={request.id} />
                  {request.reason_code === "client_unclear" && event && (
                    <>
                      <input type="hidden" name="email" value={event.id} />
                      <select name="client" aria-label={`Which client the email from ${name} is for`}>
                        {links
                          ?.filter((link) => link.contact_id === event.contact_id)
                          .map((link) => (
                            <option key={link.client_id} value={link.client_id}>
                              {link.clients?.name}
                            </option>
                          ))}
                      </select>
                      <button className="b b-secondary b-small" name="intent" value="client">
                        It is for this client
                      </button>
                    </>
                  )}
                  <button className="b b-secondary b-small" name="intent" value="done">
                    <Check size={14} aria-hidden />
                    Done
                  </button>
                </form>
              </li>
            );
          })}
          {!waiting?.length && (
            <li className="is-clear">
              <Check size={16} aria-hidden />
              <span className="grow">Nothing waits for the team.</span>
            </li>
          )}
        </ul>
      </section>

      {!!toCheck?.length && (
        <section className="panel" aria-labelledby="to-check">
          <div className="panel-head">
            <h2 id="to-check">Files to check</h2>
            <p className="hint">Saved in the client&apos;s To check folder. Confirm or correct their type and period.</p>
          </div>
          <ul className="rows">
            {toCheck.map((file) => (
              <li key={file.id}>
                <FileText size={16} aria-hidden className="file-icon" />
                <span className="grow">
                  <span className="name">{file.name}</span>
                  <span className="sub">{file.clients?.name}</span>
                </span>
                <Link className="b b-secondary b-small" href={`/app/clients/${file.client_id}?tab=files`}>
                  Check
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel" aria-labelledby="latest">
        <div className="panel-head">
          <h2 id="latest">Latest client email</h2>
          <p className="hint">Pick another label when InboxCA got one wrong; it learns from you.</p>
        </div>
        {events?.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">Received</th>
                  <th scope="col">Label</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const name = sender.get(event.id) || "A contact";
                  return (
                    <tr key={event.id}>
                      <td>
                        <span className="who">
                          <Avatar name={name} />
                          {event.client_id ? (
                            <Link className="row-link" href={`/app/clients/${event.client_id}`}>
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </span>
                      </td>
                      <td className="shrink when">{when(event.received_at)}</td>
                      <td className="shrink">
                        <form key={`${event.label}`} action={manageEmail} className="cell-form">
                          <input type="hidden" name="email" value={event.id} />
                          <AutoSelect save="label" name="label" defaultValue={event.label ?? "other"} aria-label={`Label for ${name}, ${when(event.received_at)}`}>
                            {Object.entries(labels).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </AutoSelect>
                          <button hidden name="intent" value="label" />
                          {event.decision_source === "staff" && <Badge tone="purple">Corrected</Badge>}
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty Icon={Mail} title="No client email yet">
            <span>Connect the firm&apos;s email in Settings and new mail shows here, sorted.</span>
          </Empty>
        )}
      </section>
    </>
  );
}
