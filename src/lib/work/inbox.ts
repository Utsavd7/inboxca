import { todayInIndia } from "@/src/lib/calendar";
import { whenRange } from "@/src/lib/mail-view";
import type { currentMember } from "@/src/lib/member";
import { awake, replyReasons } from "@/src/lib/triage";

// The Inbox's work and week for Today (PLAN.md 5.5, "Inbox, answered"), as plain items and
// numbers for Today to show. Everything is read as the signed in person, so row level
// security decides which emails, papers and clients count.
type Signed = Awaited<ReturnType<typeof currentMember>>;
type Context = { supabase: Signed["supabase"]; membership: NonNullable<Signed["membership"]>; userId: string };
export type WorkItem = {
  key: string;
  title: string;
  why: string;
  client?: { id: string; name: string };
  due?: string;
  urgent?: boolean;
  action: { label: string; href: string };
  audience: "assigned" | "approver" | "firm";
};

const DAY = 86_400_000;

// Emails waiting for a person, the longest waiting first, and papers waiting for approval.
export async function inboxWorkItems({ supabase, membership }: Context): Promise<WorkItem[]> {
  const today = todayInIndia();
  const [{ data: asks }, { data: papers }] = await Promise.all([
    supabase.from("requests").select("entity_id, client_id, reason_code, clients(name)").eq("firm_id", membership.firmId).eq("kind", "team_reply").eq("status", "pending").or(awake(today)).limit(200),
    supabase.from("shares").select("id, documents(name, client_id, clients(name))").eq("firm_id", membership.firmId).eq("status", "waiting").limit(50),
  ]);
  const { data: mails } = asks?.length ? await supabase.from("email_events").select("id, received_at").in("id", asks.map((ask) => ask.entity_id)) : { data: [] };
  const at = new Map(mails?.map((mail) => [mail.id, mail.received_at]));
  const days = (iso?: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : 0);
  const replies = (asks ?? [])
    .sort((a, b) => (at.get(a.entity_id) ?? "").localeCompare(at.get(b.entity_id) ?? ""))
    .map((ask): WorkItem => {
      const waited = days(at.get(ask.entity_id));
      return {
        key: `reply:${ask.entity_id}`,
        title: `Reply to ${ask.clients?.name ?? "a contact"}`,
        why: `${replyReasons[ask.reason_code ?? ""] ?? "Asks something InboxCA could not answer"}${waited ? `. Waiting ${waited === 1 ? "1 day" : `${waited} days`}` : ""}`,
        ...(ask.client_id && ask.clients && { client: { id: ask.client_id, name: ask.clients.name } }),
        action: { label: "Reply", href: `/app/inbox?mail=${ask.entity_id}` },
        audience: ask.client_id ? "assigned" : "firm",
      };
    });
  const approvals = (papers ?? []).map((share): WorkItem => ({
    key: `approve:${share.id}`,
    title: `Approve ${share.documents?.name ?? "a paper"}`,
    why: "The client asked for a private paper. It goes as a secure link once you approve it",
    ...(share.documents?.clients && { client: { id: share.documents.client_id, name: share.documents.clients.name } }),
    action: { label: "Approve", href: "/app/inbox#papers" },
    audience: "approver",
  }));
  return [...replies, ...approvals];
}

// This week's email, from Monday as the Inbox's This week: read, answered by InboxCA, answered
// by the team, and still waiting for a reply.
export async function inboxWeek({ supabase, membership }: Context) {
  const from = whenRange("week", todayInIndia()).from!;
  const [read, answered, replied, waiting] = await Promise.all(["", "answered", "replied", "reply"].map(async (outcome) => {
    const week = supabase.from("email_outcomes").select("id", { count: "exact", head: true }).eq("firm_id", membership.firmId).gte("received_at", from);
    return (await (outcome ? week.contains("outcomes", [outcome]) : week)).count ?? 0;
  }));
  return { read, answered, replied, waiting };
}
