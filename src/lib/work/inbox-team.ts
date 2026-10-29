import { personName } from "@/src/lib/roles";
import { waitingWords } from "@/src/lib/team-replies";
import { replyReasons } from "@/src/lib/triage";
import type { WorkItem, inboxWorkItems } from "./inbox";

type Context = Parameters<typeof inboxWorkItems>[0];

// The emails waiting for a person, for Today (PLAN.md "Inbox, answered" E): each one given to
// this person, the longest waiting first, in red once it waited longer than the firm allows;
// and for the owner and partners, every late one given to someone else or to nobody. Read as
// the signed in person (public.team_replies), so row level security decides which count. The
// key is the one inbox.ts gives the same email.
export async function inboxTeamWorkItems({ supabase, membership, userId }: Context): Promise<WorkItem[]> {
  const firmWide = ["owner", "partner"].includes(membership.role);
  const [{ data: rows }, { data: people }] = await Promise.all([
    supabase.rpc("team_replies", { target_firm: membership.firmId }).throwOnError(),
    firmWide ? supabase.rpc("firm_people", { target_firm: membership.firmId }) : Promise.resolve({ data: [] }),
  ]);
  const emailOf = new Map(people?.map((person) => [person.user_id, person.email]));
  return (rows ?? []).filter((row) => row.assignee === userId || (firmWide && row.late)).map((row): WorkItem => ({
    key: `reply:${row.email_id}`,
    title: `Reply to ${row.client_name ?? "a contact"}`,
    why: [replyReasons[row.reason_code ?? ""] ?? replyReasons.no_rule, waitingWords(row.days), row.assignee !== userId && (row.assignee ? `For ${personName(emailOf.get(row.assignee))}` : "Given to nobody")].filter(Boolean).join(". "),
    ...(row.client_id && row.client_name && { client: { id: row.client_id, name: row.client_name } }),
    urgent: row.late,
    action: { label: "Reply", href: `/app/inbox?mail=${row.email_id}` },
    audience: row.assignee === userId ? "assigned" : "firm",
  }));
}
