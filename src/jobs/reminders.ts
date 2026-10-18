import type { Json } from "@/src/db/types";
import { todayInIndia } from "@/src/lib/calendar";
import { workOfService } from "@/src/lib/checklists";
import { serverCrypto } from "@/src/lib/crypto";
import { firmMailer } from "@/src/lib/firm-mail";
import { planReminders, reminderEmail, type ReminderTask } from "@/src/lib/reminders";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
// At most this many clients' emails a run; the job comes back in 10 minutes for the rest,
// so a big firm's reminders spread over the morning inside the mailbox's daily limits.
const PER_RUN = 100;

type Details = { reminder?: { day: string; state: "sending" | "sent" | "failed" }; reminded?: string[]; skipped?: { day: string; reason: string } } & Record<string, unknown>;

// 09:30 India time on the next morning reminders may go (04:00 UTC).
function nextMorning(now = new Date()) {
  const hour = Number(now.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }));
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0));
  return hour < 9 && now < day ? day : new Date(day.getTime() + DAY);
}

// The firm's reminders for today (PLAN.md 5.2, 5.2.1): one email a client about every open
// return at a reminder stage, from the firm's own mailbox, between 09:00 and 20:00 India
// time. Skips are kept on each task with their reason. Before a send, each task records it;
// after a crash, the Sent folder is checked before anything goes again.
export const sendReminders: Handler = async (job) => {
  const admin = supabaseAdmin();
  const firm = job.entity_id ?? "";
  const { data: firmRow } = await admin.from("firms").select("name, settings").eq("id", firm).maybeSingle();
  if (!firmRow || (firmRow.settings as { reminders?: boolean }).reminders !== true) return { done: true };
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }));
  if (!process.env.REMINDERS_ANY_HOUR && (hour < 9 || hour >= 20)) return { retry: "quiet_hours", at: nextMorning() };
  const mailer = await firmMailer(firm, firmRow.name);
  if (!mailer) return { done: true };

  const today = todayInIndia();
  const [{ data: rows }, { data: rules }, { data: handling }] = await Promise.all([
    admin
      .from("tasks")
      .select("id, client_id, code, period_key, due_on, details, clients!inner(name, email_enc, reminders_paused, archived_at)")
      .eq("firm_id", firm)
      .neq("status", "filed")
      .is("clients.archived_at", null)
      .gte("due_on", shift(today, -3))
      .lte("due_on", shift(today, 7)),
    admin.from("compliance_types").select("code, name, frequency, verified_on").eq("period_key", ""),
    admin.from("requests").select("client_id").eq("firm_id", firm).eq("kind", "team_reply").eq("status", "pending"),
  ]);
  const rule = new Map(rules?.map((r) => [r.code, r]));
  const clientIds = [...new Set(rows?.map((row) => row.client_id))];
  const { data: documents } = clientIds.length ? await admin.from("documents").select("client_id, work_type, period_key").in("client_id", clientIds).neq("status", "deleted") : { data: [] };
  const filed = new Set(documents?.map((document) => `${document.client_id}:${document.work_type}:${document.period_key}`));
  const tasks: (ReminderTask & { details: Details; name: string; email_enc: string | null })[] = (rows ?? []).map((row) => ({
    id: row.id,
    client_id: row.client_id,
    code: row.code ?? "",
    period_key: row.period_key ?? "",
    due_on: row.due_on,
    rule: { name: rule.get(row.code ?? "")?.name ?? row.code ?? "", frequency: rule.get(row.code ?? "")?.frequency ?? null, verified: !!rule.get(row.code ?? "")?.verified_on },
    client: { paused: row.clients.reminders_paused, hasEmail: !!row.clients.email_enc },
    details: (row.details ?? {}) as Details,
    name: row.clients.name,
    email_enc: row.clients.email_enc,
  }));
  const { send, skipped } = planReminders(tasks, today, filed, new Set(handling?.map((request) => request.client_id ?? "")));
  const save = (task: { id: string; details: Details }, details: Details) => admin.from("tasks").update({ details: { ...task.details, ...details } as unknown as NonNullable<Json> }).eq("id", task.id);
  for (const { task, reason } of skipped) {
    const details = (task as (typeof tasks)[number]).details;
    if (details.skipped?.day !== today) await save({ id: task.id, details }, { skipped: { day: today, reason } });
  }

  const crypto = serverCrypto();
  const host = new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host;
  let sentNow = 0;
  for (const [clientId, due] of send) {
    const mine = due as (typeof tasks)[number][];
    if (mine.every((task) => task.details.reminder?.day === today && task.details.reminder.state === "sent")) continue;
    if (sentNow >= PER_RUN) return { retry: "more_clients", at: new Date(Date.now() + 10 * 60_000) };
    const messageId = `<reminder-${clientId}-${today}@${host}>`;
    const markAll = async (state: "sending" | "sent" | "failed") => {
      for (const task of mine) {
        const details: Details = { reminder: { day: today, state }, ...(state === "sent" && { reminded: [...(task.details.reminded ?? []), today] }) };
        await save(task, details);
        task.details = { ...task.details, ...details };
      }
    };
    // A send that may have happened before a crash is looked for first, never repeated blindly.
    if (mine.some((task) => task.details.reminder?.day === today && task.details.reminder.state === "sending") && (await mailer.sentAlready(messageId))) {
      await markAll("sent");
      continue;
    }
    await markAll("sending");
    const to = await crypto.decrypt(firm, `clients/${clientId}/email`, mine[0].email_enc!);
    const { subject, text } = reminderEmail(mine[0].name, firmRow.name, mine, today);
    const sent = await mailer.send(to, subject, text, messageId);
    await markAll(sent ? "sent" : "failed");
    if (sent) sentNow++;
    // Only what is reminded, never the text, goes in the log.
    if (sent) await admin.from("activity_log").insert({ firm_id: firm, action: "reminder.sent", entity_type: "client", entity_id: clientId, details: { tasks: mine.map((task) => task.id), works: [...new Set(mine.map((task) => workOfService(task.code)))] } });
  }
  return { done: true };
};
