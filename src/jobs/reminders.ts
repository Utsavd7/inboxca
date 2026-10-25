import { emailTemplates, TEMPLATE_VERSION } from "@/src/lib/email-templates";
import type { Json } from "@/src/db/types";
import { todayInIndia } from "@/src/lib/calendar";
import { workOfService } from "@/src/lib/checklists";
import { serverCrypto } from "@/src/lib/crypto";
import { firmMailer } from "@/src/lib/firm-mail";
import type { DocumentRequest } from "@/src/lib/checklists";
import { followUpDue, planReminders, reminderStages, checkedReminder, type FollowUp, type ReminderTask } from "@/src/lib/reminders";
import { supabaseAdmin } from "@/src/lib/supabase";
import type { Handler } from "./runner";

const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
// At most this many clients' emails a run; the job comes back in 10 minutes for the rest,
// so a big firm's reminders spread over the morning inside the mailbox's daily limits.
const PER_RUN = 100;
// Every day of the last year counts as a stage when the late clients are reminded at once.
const LATE_DAYS = Array.from({ length: 366 }, (_, day) => -1 - day);
// Remind client on the Calendar: every return of that client due today or in the next 7 days.
const SOON_DAYS = Array.from({ length: 8 }, (_, day) => day);

type RequestDetails = DocumentRequest & { reminder?: { day: string; state: "sending" | "sent" | "failed" } };
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
// Today's buttons send now, asked for by an owner or partner: "late" reminds every client with
// a late return, "papers" follows up every request still missing papers, whatever the stage.
// Remind client on the Calendar ("client") reminds one client of its returns due within 7 days.
export const sendReminders: Handler = async (job) => {
  const admin = supabaseAdmin();
  const one = job.entity_type === "client" ? job.entity_id : null;
  const firm = (one ? job.firm_id : job.entity_id) ?? "";
  const now = job.entity_type === "late" || job.entity_type === "papers" ? job.entity_type : one ? "soon" : null;
  const { data: firmRow } = await admin.from("firms").select("name, settings").eq("id", firm).maybeSingle();
  if (!firmRow || (!now && (firmRow.settings as { reminders?: boolean }).reminders !== true)) return { done: true };
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }));
  if (!process.env.REMINDERS_ANY_HOUR && (hour < 9 || hour >= 20)) return { retry: "quiet_hours", at: nextMorning() };
  const mailer = await firmMailer(firm, firmRow.name);
  if (!mailer) return {retry:"mail_not_connected",at:new Date(Date.now()+3600_000)};

  const today = todayInIndia();
  const open = admin
    .from("tasks")
    .select("id, client_id, code, period_key, due_on, details, clients!inner(name, email_enc, reminders_paused, archived_at)")
    .eq("firm_id", firm)
    .eq("kind", "compliance")
    .neq("status", "filed")
    .is("clients.archived_at", null)
    .gte("due_on", shift(today, now === "late" ? -366 : now === "soon" ? 0 : -3))
    .lte("due_on", shift(today, now === "late" ? -1 : 7));
  const [{ data: rows }, { data: rules }, { data: handling }] = await Promise.all([
    one ? open.eq("client_id", one) : open,
    admin.from("compliance_types").select("code, name, frequency, verified_on").eq("period_key", ""),
    admin.from("requests").select("client_id").eq("firm_id", firm).eq("kind", "team_reply").eq("status", "pending"),
  ]);
  const rule = new Map(rules?.map((r) => [r.code, r]));
  const clientIds = [...new Set(rows?.map((row) => row.client_id))];
  const { data: documents } = clientIds.length ? await admin.from("documents").select("client_id, work_type, period_key").in("client_id", clientIds).neq("status", "deleted") : { data: [] };
  const filed = new Set(documents?.map((document) => `${document.client_id}:${document.work_type}:${document.period_key}`));
  const tasks: (ReminderTask & { details: Details; name: string; email_enc: string | null })[] = (now === "papers" ? [] : rows ?? []).map((row) => ({
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
  const { send, skipped } = planReminders(tasks, today, filed, new Set(handling?.map((request) => request.client_id ?? "")), now === "late" ? LATE_DAYS : now === "soon" ? SOON_DAYS : reminderStages(firmRow.settings as { reminder_stages?: unknown }));
  const save = (task: { id: string; details: Details }, details: Details) => admin.from("tasks").update({ details: { ...task.details, ...details } as unknown as NonNullable<Json> }).eq("id", task.id);
  for (const { task, reason } of skipped) {
    const details = (task as (typeof tasks)[number]).details;
    if (details.skipped?.day !== today) await save({ id: task.id, details }, { skipped: { day: today, reason } });
  }

  const crypto = serverCrypto();
  // Document requests still waiting for files, followed up in the same daily email.
  const { data: requests } = await admin
    .from("requests")
    .select("id, client_id, expires_at, details, clients(name, email_enc, reminders_paused, archived_at)")
    .eq("firm_id", firm)
    .eq("kind", "documents")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());
  const follow = new Map<string, (FollowUp & { details: RequestDetails })[]>();
  const people = new Map(tasks.map((task) => [task.client_id, { name: task.name, email_enc: task.email_enc }]));
  // A follow-up carries the upload link, which needs the app's own address.
  for (const request of process.env.APP_BASE_URL && now !== "late" && now !== "soon" ? (requests ?? []) : []) {
    const details = request.details as unknown as RequestDetails;
    const client = request.clients;
    const missing = followUpDue({ expires_at: request.expires_at!, details }, today, now === "papers");
    if (!missing || !client || !client.email_enc || client.reminders_paused || client.archived_at || !details.link_enc || !request.client_id) continue;
    const link = `${process.env.APP_BASE_URL}/u/${await crypto.decrypt(firm, `requests/${request.id}/link`, details.link_enc)}`;
    follow.set(request.client_id, [...(follow.get(request.client_id) ?? []), { requestId: request.id, client_id: request.client_id, period: details.period, missing, link, count: details.followups?.length ?? 0, details }]);
    people.set(request.client_id, { name: client.name, email_enc: client.email_enc });
  }

  const host = new URL(process.env.APP_BASE_URL ?? "http://inboxca.local").host;
  let sentNow = 0;
  let uncertain = false;
  const started=Date.now();
  for (const clientId of new Set([...send.keys(), ...follow.keys()])) {
    let mine = (send.get(clientId) ?? []) as (typeof tasks)[number][];
    const asks = follow.get(clientId) ?? [];
    if (mine.length) {
      const { data: current, error } = await admin.from("tasks").select("id,details").in("id", mine.map((task) => task.id)).neq("status", "filed");
      if (error) return { retry: "returns_not_read" };
      mine = mine.filter((task) => current?.some((row) => row.id === task.id)).map((task) => ({ ...task, details: current!.find((row) => row.id === task.id)!.details as Details }));
    }
    if (!mine.length && !asks.length) continue;
    // New work added after today's email waits for tomorrow, never another email today.
    const {count: alreadySent,error: sentError}=await admin.from("activity_log").select("at",{count:"exact",head:true}).eq("firm_id",firm).eq("entity_id",clientId).eq("action","reminder.sent").gte("at",`${today}T00:00:00+05:30`);
    if (sentError) return {retry:"sends_not_read"};
    if (alreadySent) continue;
    // Each task and each request carries the day's send, so nothing goes twice.
    const states = [...mine.map((task) => task.details.reminder), ...asks.map((ask) => ask.details.reminder)];
    if (states.some((state) => state?.day === today && state.state === "sent")) continue;
    if (sentNow >= PER_RUN || Date.now()-started>=30_000) return { retry: "more_clients", at: new Date(Date.now() + 10 * 60_000) };
    const messageId = `<reminder-${clientId}-${today}@${host}>`;
    const markAll = async (state: "sending" | "sent" | "failed") => {
      for (const task of mine) {
        const details: Details = { reminder: { day: today, state }, ...(state === "sent" && { reminded: [...(task.details.reminded ?? []), today] }) };
        await save(task, details);
        task.details = { ...task.details, ...details };
      }
      for (const ask of asks) {
        ask.details = { ...ask.details, reminder: { day: today, state }, ...(state === "sent" && { followups: [...(ask.details.followups ?? []), today] }) };
        await admin.from("requests").update({ details: ask.details as unknown as NonNullable<Json> }).eq("id", ask.requestId);
        // After the third follow-up with nothing back, the owner and partners are told.
        if (state === "sent" && ask.details.followups?.length === 3)
          await admin.from("requests").upsert(
            { firm_id: firm, kind: "alert", entity_type: "request_stalled", entity_id: ask.requestId, client_id: clientId, reason_code: "request_stalled", status: "pending", details: { client: people.get(clientId)?.name ?? "" } },
            { onConflict: "kind,entity_type,entity_id" },
          );
      }
    };
    // A send that may have happened before a crash is looked for first, never repeated blindly.
    if (states.some((state) => state?.day === today && state.state === "sending")) {
      try {
        if (await mailer.sentAlready(messageId)) { await markAll("sent"); continue; }
      } catch {
        uncertain = true;
        continue;
      }
    }
    await markAll("sending");
    const person = people.get(clientId)!;
    const to = await crypto.decrypt(firm, `clients/${clientId}/email`, person.email_enc!);
    const { subject, text } = checkedReminder(undefined, emailTemplates.reminder(person.name, firmRow.name, mine, today, asks));
    const sent = await mailer.send(to, subject, text, messageId);
    await markAll(sent ? "sent" : mailer.waitUntil ? "failed" : "sending");
    if (!sent) {
      if (mailer.waitUntil) return {retry:"mail_wait",at:mailer.waitUntil};
      uncertain = true;
      continue;
    }
    if (sent) sentNow++;
    // Only what is reminded, never the text, goes in the log.
    if (sent)
      await admin.from("activity_log").insert({
        firm_id: firm,
        action: "reminder.sent",
        entity_type: "client",
        entity_id: clientId,
        details: { template:`reminder.en.${TEMPLATE_VERSION}`,tasks: mine.map((task) => task.id), requests: asks.map((ask) => ask.requestId), works: [...new Set(mine.map((task) => workOfService(task.code)))] },
      });
  }
  return uncertain ? {retry:"mail_not_sent",patient:true} : {done:true};
};
