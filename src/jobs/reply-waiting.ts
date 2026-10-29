import { firmMailer } from "@/src/lib/firm-mail";
import { personName } from "@/src/lib/roles";
import { supabaseAdmin } from "@/src/lib/supabase";
import { sendSystemMail, systemMailReady } from "@/src/lib/system-mail";
import { waitingWords } from "@/src/lib/team-replies";
import type { Handler } from "./runner";

const DAY = 86_400_000;

// 09:00 India time (private.queue_reply_waiting): the owner's list of client emails that have
// waited more than a day for a reply, by the person each is for, sent only when there are
// any. From the firm's own mailbox it names the clients; without one it goes through Orelu's
// system email, which names no client. Nothing of the emails themselves is read. Each owner's
// list is logged as it goes, so a try that stops part way never sends one twice.
export const replyWaiting: Handler = async (job, { markSending }) => {
  const admin = supabaseAdmin();
  const [{ data: rows, error }, { data: firm }, { data: owners }] = await Promise.all([
    admin.rpc("team_replies", { target_firm: job.firm_id! }),
    admin.from("firms").select("name, settings").eq("id", job.firm_id!).single(),
    admin.from("firm_members").select("user_id").eq("firm_id", job.firm_id!).eq("role", "owner").eq("status", "active"),
  ]);
  if (error) return { retry: "replies_not_read" };
  const waiting = (rows ?? []).filter((row) => Date.now() - Date.parse(row.received_at) > DAY);
  if (!firm || !waiting.length || (firm.settings as { reply_list?: boolean }).reply_list === false) return { done: true };
  const mailer = await firmMailer(job.firm_id!, firm.name);
  if (!mailer && !systemMailReady()) return { done: true };
  const emailOf = async (user: string) => (await admin.auth.admin.getUserById(user)).data.user?.email ?? "";
  const people = new Map<string, typeof waiting>();
  for (const row of waiting) people.set(row.assignee ?? "", [...(people.get(row.assignee ?? "") ?? []), row]);
  const name = new Map(await Promise.all([...people.keys()].map(async (user) => [user, user ? personName(await emailOf(user)) : "Given to nobody"] as const)));
  const emails = waiting.length === 1 ? "1 client email" : `${waiting.length} client emails`;
  const byPerson = [...people].map(([user, list]) => {
    const late = list.filter((row) => row.late).length;
    // The firm's own mail names each client; Orelu's names none.
    return mailer
      ? [`${name.get(user)}, ${list.length}:`, ...list.map((row) => `- ${row.client_name ?? "A contact"}, ${waitingWords(row.days).toLowerCase()}${row.late ? ", late" : ""}`)].join("\n")
      : `- ${name.get(user)}: ${list.length}${late ? `, ${late} late` : ""}`;
  });
  const subject = `Replies waiting: ${emails}`;
  const text = ["Good morning,", `${emails} ${waiting.length === 1 ? "has" : "have"} waited more than a day for a reply.`, ...byPerson, `Open them in the Inbox: ${process.env.APP_BASE_URL ?? ""}/app/inbox?show=reply`, `InboxCA for ${firm.name}`].join("\n\n");
  const { data: told, error: toldError } = await admin.from("activity_log").select("person:details->>person").eq("firm_id", job.firm_id!).eq("action", "replies.waiting_sent")
    .eq("details->>job", String(job.id)).gte("at", new Date(Date.now() - 7 * DAY).toISOString());
  if (toldError) return { retry: "sent_not_read" };
  const to = (await Promise.all((owners ?? []).map(async (owner) => ({ person: owner.user_id, address: await emailOf(owner.user_id) })))).filter(({ person, address }) => address && !told.some((row) => row.person === person));
  await markSending();
  for (const { person, address } of to) {
    if (!mailer) await sendSystemMail(address, `InboxCA: ${subject}`, text);
    else if (!(await mailer.send(address, subject, text))) return mailer.waitUntil ? { retry: "mail_wait", at: mailer.waitUntil } : { retry: "mail_not_sent" };
    await admin.from("activity_log").insert({ firm_id: job.firm_id!, action: "replies.waiting_sent", entity_type: "firm", entity_id: job.firm_id!, details: { emails: waiting.length, people: people.size, from: mailer ? "firm" : "system", job: job.id, person } });
  }
  return { done: true };
};
