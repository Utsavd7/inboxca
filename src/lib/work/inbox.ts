import { todayInIndia } from "@/src/lib/calendar";
import type { currentMember } from "@/src/lib/member";
import { awake, replyReasons } from "@/src/lib/triage";

// The Inbox's work for Today (PLAN.md 5.5, "Inbox, answered"), as plain items for Today to
// show. Everything is read as the signed in person, so row level security decides which emails,
// papers and clients count.
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
  many?: { title: string; why: string };
};

const DAY = 86_400_000;

// Emails waiting for a person, the longest waiting first, and papers waiting for approval.
export async function inboxWorkItems({ supabase, membership }: Context): Promise<WorkItem[]> {
  const today = todayInIndia();
  const [{ data: asks }, { data: papers }] = await Promise.all([
    supabase.from("requests").select("entity_id, client_id, reason_code, clients(name)").eq("firm_id", membership.firmId).eq("kind", "team_reply").eq("status", "pending").or(awake(today)).limit(200).throwOnError(),
    supabase.from("shares").select("id, documents(name, client_id, clients(name))").eq("firm_id", membership.firmId).eq("status", "waiting").limit(50).throwOnError(),
  ]);
  const { data: mails } = asks?.length ? await supabase.from("email_events").select("id, received_at").in("id", asks.map((ask) => ask.entity_id)) : { data: [] };
  const at = new Map(mails?.map((mail) => [mail.id, mail.received_at]));
  const days = (iso?: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : 0);
  // These go to front desk only (work-data.ts), who cannot add a client: someone not a client yet
  // asking about the firm's services waits for the person it is given to instead.
  const replies = (asks ?? [])
    .filter((ask) => ask.reason_code !== "new_client_enquiry")
    .sort((a, b) => (at.get(a.entity_id) ?? "").localeCompare(at.get(b.entity_id) ?? ""))
    .map((ask): WorkItem => {
      const waited = days(at.get(ask.entity_id));
      return {
        key: `reply:${ask.entity_id}`,
        title: ask.clients ? "Email to answer" : "Email from a contact",
        why: waited ? `Waiting ${waited === 1 ? "1 day" : `${waited} days`}` : (replyReasons[ask.reason_code ?? ""] ?? "Asks something InboxCA could not answer"),
        ...(ask.client_id && ask.clients && { client: { id: ask.client_id, name: ask.clients.name } }),
        action: { label: "Reply", href: `/app/inbox?mail=${ask.entity_id}` },
        audience: ask.client_id ? "assigned" : "firm",
      };
    });
  const approvals = (papers ?? []).map((share): WorkItem => ({
    key: `approve:${share.id}`,
    title: share.documents?.name ?? "A paper",
    why: "It goes to the client as a secure link once approved",
    ...(share.documents?.clients && { client: { id: share.documents.client_id, name: share.documents.clients.name } }),
    action: { label: "Approve", href: "/app/inbox#papers" },
    audience: "approver",
  }));
  return [...replies, ...approvals];
}
