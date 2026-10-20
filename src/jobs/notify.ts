import { notify } from "@/src/lib/push";
import { rightWords, type Right } from "@/src/lib/rights";
import { personName } from "@/src/lib/roles";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

// Who is told what, by phone notification (PLAN.md 5.17.2): a question to the team's manager
// or to the owner and deputies, as it was routed; PCs and connections to the owner and
// deputies only. Never the person who asked, and no client's name in the text.
async function approvers(firmId: string, route: "owner" | "manager", teamId: string | null, except: string) {
  const admin = supabaseAdmin();
  const { data: firm } = await admin.from("firms").select("settings").eq("id", firmId).single();
  const deputies = ((firm?.settings as { office?: { deputies?: string[] } } | null)?.office?.deputies ?? []);
  const { data: people } = await admin.from("firm_members").select("user_id, role, team_id").eq("firm_id", firmId).eq("status", "active");
  return (people ?? [])
    .filter((person) => person.user_id !== except && (route === "manager"
      ? person.role === "manager" && !!teamId && person.team_id === teamId
      : person.role === "owner" || deputies.includes(person.user_id)))
    .map((person) => person.user_id);
}

const nameOf = async (userId?: string) => personName((await supabaseAdmin().auth.admin.getUserById(userId ?? "")).data.user?.email);

export const notifyRequest: Handler = async (job) => {
  const { data: request } = await supabaseAdmin().from("requests").select("firm_id, kind, reason_code, status, details").eq("id", job.entity_id!).maybeSingle();
  if (!request || request.status !== "pending") return { done: true };
  const details = request.details as { by?: string; person?: string; route?: "owner" | "manager"; team_id?: string | null };
  if (request.kind === "permission") {
    const what = request.reason_code === "time" ? "asks for more time today" : `asks to ${rightWords[request.reason_code as Right]}`;
    await notify(await approvers(request.firm_id, details.route ?? "owner", details.team_id ?? null, details.by ?? ""), { title: "A question for you", body: `${await nameOf(details.by)} ${what}.`, url: "/app/inbox" });
  } else {
    const body = request.reason_code === "office_changed" ? "Your office internet connection changed today." : `${await nameOf(details.person)}'s PC is on a different internet connection.`;
    await notify(await approvers(request.firm_id, "owner", null, details.person ?? ""), { title: "Office connection", body, url: "/app" });
  }
  return { done: true };
};

export const notifyDevices: Handler = async (job) => {
  const { count } = await supabaseAdmin().from("devices").select("id", { count: "exact", head: true }).eq("firm_id", job.firm_id!).eq("status", "waiting");
  if (count) await notify(await approvers(job.firm_id!, "owner", null, ""), { title: "PCs to approve", body: `${count} ${count === 1 ? "PC waits" : "PCs wait"} for your approval.`, url: "/app/settings#office" });
  return { done: true };
};

// 30 minutes without the manager's answer: the owner and deputies are told too (#45).
export const approvalNudge: Handler = async (job) => {
  const { data: request } = await supabaseAdmin().from("requests").select("firm_id, status, details").eq("id", job.entity_id!).maybeSingle();
  const by = (request?.details as { by?: string } | undefined)?.by;
  if (request?.status === "pending") await notify(await approvers(request.firm_id, "owner", null, by ?? ""), { title: "A question waits", body: `${await nameOf(by)}'s question has waited 30 minutes for their manager.`, url: "/app/inbox" });
  return { done: true };
};

// Monday: the owner's summary of the week's approvals (5.17.3).
export const approvalSummary: Handler = async (job) => {
  const admin = supabaseAdmin();
  const { count } = await admin.from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", job.firm_id!)
    .in("action", ["permission.allowed", "permission.always", "device.approved", "office.confirm", "office.today"]).gt("at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  const { data: owner } = await admin.from("firm_members").select("user_id").eq("firm_id", job.firm_id!).eq("role", "owner").eq("status", "active");
  if (count) await notify((owner ?? []).map((person) => person.user_id), { title: "Your week's approvals", body: `${count} ${count === 1 ? "approval" : "approvals"} this week. See who approved what.`, url: "/app/inbox#approved" });
  return { done: true };
};

// No client names leave in phone notifications. Home reads the current date and status.
export const noticeAlert: Handler = async (job) => {
  const admin = supabaseAdmin();
  const stage = job.idempotency_key.split(":").at(-1)!;
  const { data: notice, error: missing } = await admin.from("tasks").select("firm_id,client_id").eq("id", job.entity_id!).maybeSingle();
  if (missing) return { retry: "notice_not_read" };
  if (!notice) return { done: true };
  const [{ data: people, error: peopleError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    admin.from("firm_members").select("user_id,role,team_id").eq("firm_id", notice.firm_id).eq("status", "active"),
    admin.from("client_assignments").select("user_id,team_id").eq("firm_id", notice.firm_id).eq("client_id", notice.client_id),
  ]);
  if (peopleError || assignmentsError) return { retry: "notice_people_not_read" };
  const { data, error } = await admin.rpc("claim_notice_alert", { task_id: job.entity_id!, stage });
  if (error) return { retry: "notice_not_claimed" };
  if (!data) return { done: true };
  const recipients = (people ?? []).filter((person) => ["owner","partner"].includes(person.role) || assignments?.some((a) => a.user_id === person.user_id || (a.team_id && a.team_id === person.team_id))).map((person) => person.user_id);
  const date = stage.startsWith("action_") ? "action date" : "review deadline";
  const when = stage.endsWith("late") ? "has passed" : stage.endsWith("due") ? "is today" : "is within 3 days";
  await notify(recipients, { title: "A notice needs attention", body: `A notice's ${date} ${when}.`, url: "/app/notices" });
  return { done: true };
};

export const returnAlert: Handler = async (job) => {
  const { data, error } = await supabaseAdmin().rpc("claim_return_alert", { task_id: job.entity_id! });
  if (error) return { retry: "return_not_claimed" };
  if (data?.length) await notify(data, { title: "A return needs attention", body: "A return is 3 or more days late. Please check with the client.", url: "/app/calendar?view=overdue" });
  return { done: true };
};

export const mailboxReconnect:Handler=async(job)=>{
  const admin=supabaseAdmin();
  const {data:account,error}=await admin.from("connected_accounts").select("firm_id,status").eq("id",job.entity_id!).maybeSingle();
  if (error) return {retry:"mailbox_not_read"};
  if (account?.status==="needs_reconnect") {
    const {data:owners,error}=await admin.from("firm_members").select("user_id").eq("firm_id",account.firm_id).eq("role","owner").eq("status","active");
    if (error) return {retry:"owner_not_read"};
    await notify((owners ?? []).map((owner)=>owner.user_id),{title:"Connect your firm's email again",body:"InboxCA could not sign in. Replies will wait until you connect it again.",url:"/app/settings#mailbox"});
  }
  return {done:true};
};
