import Link from "next/link";
import { redirect } from "next/navigation";
import { manageEmail } from "@/app/(app)/actions";
import { serverCrypto } from "@/src/lib/crypto";
import { currentMember } from "@/src/lib/member";
import { labels } from "@/src/lib/triage";

const reasons: Record<string, string> = {
  no_rule: "InboxCA could not tell what it asks",
  data_unclear: "Data for more than one kind of work",
  client_unclear: "The sender writes for several clients",
};
const when = (at: string) =>
  new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Client email as InboxCA sorted it: what waits for the team, and the latest mail with its
// label. Only labels and times are kept; the email itself stays in the firm's mailbox.
export default async function Inbox() {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ data: events }, { data: waiting }] = await Promise.all([
    supabase
      .from("email_events")
      .select("id, client_id, contact_id, received_at, label, decision_source, clients(name), contacts(name_enc)")
      .order("received_at", { ascending: false })
      .limit(100),
    supabase.from("requests").select("id, entity_id, reason_code").eq("kind", "team_reply").eq("status", "pending"),
  ]);
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
      <h1>Inbox</h1>
      <section className="app-card" aria-labelledby="team-reply">
        <h2 id="team-reply">Needs team reply</h2>
        <p className="app-note">Reply from your own mailbox, then mark it done.</p>
        <ul className="app-list">
          {waiting?.map((request) => {
            const event = byId.get(request.entity_id);
            return (
              <li key={request.id}>
                <span className="person">
                  {event?.client_id ? <Link href={`/app/clients/${event.client_id}`}>{sender.get(request.entity_id)}</Link> : sender.get(request.entity_id)}
                  <span className="app-email">{reasons[request.reason_code ?? ""] ?? labels.other}</span>
                </span>
                <form action={manageEmail} className="person-role">
                  {event && <span className="num">{when(event.received_at)}</span>}
                  <input type="hidden" name="request" value={request.id} />
                  <button className="btn btn-quiet" name="intent" value="done">
                    Done
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
        {!waiting?.length && <p className="app-note">Nothing waits for the team.</p>}
      </section>

      <section className="app-card" aria-labelledby="latest">
        <h2 id="latest">Latest client email</h2>
        <ul className="app-list">
          {events?.map((event) => (
            <li key={event.id}>
              <span className="person">
                {sender.get(event.id)}
                <span className="app-email num">{when(event.received_at)}</span>
              </span>
              <form key={`${event.label}`} action={manageEmail} className="person-role">
                <input type="hidden" name="email" value={event.id} />
                <select name="label" defaultValue={event.label ?? "other"} aria-label={`Label for ${sender.get(event.id)}, ${when(event.received_at)}`}>
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {event.decision_source === "staff" && <span className="tag">Corrected</span>}
                <button className="btn btn-quiet" name="intent" value="label">
                  Save label
                </button>
              </form>
            </li>
          ))}
        </ul>
        {!events?.length && <p className="app-note">No client email yet. Connect the firm&apos;s email in Settings.</p>}
      </section>
    </>
  );
}

