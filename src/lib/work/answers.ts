import { answerOf, answerWords } from "@/src/lib/answers";
import type { currentMember } from "@/src/lib/member";
import type { WorkItem } from "./inbox";

// InboxCA's replies that wait for a person to send them (Ask me first, "Inbox, answered" B and
// C), as plain items for Today, the oldest first, unless a person answers the email instead.
// Read as the signed in person, so row level security decides which emails count.
type Signed = Awaited<ReturnType<typeof currentMember>>;
type Context = { supabase: Signed["supabase"]; membership: NonNullable<Signed["membership"]>; userId: string };

export async function answersWorkItems({ supabase, membership }: Context): Promise<WorkItem[]> {
  const { data } = await supabase.from("email_events").select("id, client_id, label, clients(name)").eq("firm_id", membership.firmId).eq("delivery->>ack", "held").order("received_at").limit(50).throwOnError();
  const { data: taken } = data?.length ? await supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("entity_type", "email").in("entity_id", data.map((row) => row.id)) : { data: [] };
  return (data ?? []).flatMap((row): WorkItem[] => {
    const kind = answerOf(row.label);
    return kind && !taken?.some((ask) => ask.entity_id === row.id) ? [{
      key: `answer:${row.id}`,
      title: `Send InboxCA's reply to ${row.clients?.name ?? "a client"}`,
      why: `${answerWords[kind][0]}. Check it, then send`,
      ...(row.client_id && row.clients && { client: { id: row.client_id, name: row.clients.name } }),
      action: { label: "Check and send", href: `/app/inbox?mail=${row.id}` },
      audience: "assigned",
    }] : [];
  });
}
