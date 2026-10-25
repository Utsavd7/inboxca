import { dueLabel, periodLabel } from "./calendar";
import { checklists, workOfService } from "./checklists";
import { periodName } from "./documents";
import type { WorkType } from "./drive";

// Smart reminders (PLAN.md 5.2, 5.2.1, D25): which of a firm's open returns are reminded
// today, which are skipped and why, and the one email each client gets. Every fact in the
// email comes from InboxCA's records; nothing is advised or promised.

// Days before (positive) or after (negative) the due date on which a reminder goes.
export const STAGES = [7, 3, 1, 0, -1, -3];
export const stageNames: Record<number, string> = { 7: "7 days before", 3: "3 days before", 1: "1 day before", 0: "On the day", "-1": "1 day after", "-3": "3 days after" };
export function reminderStages(settings: { reminder_stages?: unknown }) {
  return Array.isArray(settings.reminder_stages) ? STAGES.filter((day) => (settings.reminder_stages as unknown[]).includes(day)) : STAGES;
}
const DAY = 86_400_000;
export const daysUntil = (due: string, today: string) => Math.round((Date.parse(due) - Date.parse(today)) / DAY);

export type ReminderTask = {
  id: string;
  client_id: string;
  code: string;
  period_key: string;
  due_on: string;
  rule: { name: string; frequency: string | null; verified: boolean };
  client: { paused: boolean; hasEmail: boolean };
};
export type Skip = "date_not_confirmed" | "paused" | "no_email" | "data_received" | "team_handling";
export const skipReasons: Record<Skip, string> = {
  date_not_confirmed: "Not reminded: the due date is not yet confirmed by a CA",
  paused: "Not reminded: reminders are paused for this client",
  no_email: "Not reminded: the client has no email address",
  data_received: "Not reminded: the client already sent files for this period",
  team_handling: "Not reminded: your team is replying to this client",
};

// The document periods that count as data for a return's period: the month itself, the
// three months of a quarter, or the financial year.
export function periodsOf(frequency: string | null, key: string) {
  if (frequency === "yearly") return [key.slice(0, 4)];
  if (frequency === "quarterly") {
    const end = new Date(`${key}-01T00:00:00Z`);
    return [0, 1, 2].map((back) => new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back, 1)).toISOString().slice(0, 7));
  }
  return [key];
}

// Today's reminders by client, and every skip with its reason. `filed` is the firm's files by
// client, work and period ("<client>:gst:2026-09"); `handling` the clients with an open team reply.
export function planReminders(tasks: ReminderTask[], today: string, filed: Set<string>, handling: Set<string>, stages = STAGES) {
  const send = new Map<string, ReminderTask[]>();
  const skipped: { task: ReminderTask; reason: Skip }[] = [];
  for (const task of tasks) {
    if (!stages.includes(daysUntil(task.due_on, today))) continue;
    const work = workOfService(task.code);
    const reason: Skip | null = !task.rule.verified
      ? "date_not_confirmed"
      : task.client.paused
        ? "paused"
        : !task.client.hasEmail
          ? "no_email"
          : work && periodsOf(task.rule.frequency, task.period_key).some((period) => filed.has(`${task.client_id}:${work}:${period}`))
            ? "data_received"
            : handling.has(task.client_id)
              ? "team_handling"
              : null;
    if (reason) skipped.push({ task, reason });
    else send.set(task.client_id, [...(send.get(task.client_id) ?? []), task]);
  }
  return { send, skipped };
}

// A document request still waiting for files (PLAN.md 5.2): followed up every 3 days, up to
// 4 times, asking only for what has not arrived. `now` (Chase missing papers on Today) skips the wait.
export type FollowUp = { requestId: string; client_id: string; period: string; missing: string[]; link: string; count: number };
export const FOLLOW_UP_DAYS = 3;
export const MAX_FOLLOW_UPS = 4;
export function followUpDue(request: { expires_at: string; details: { items: { type: string; received: string[] }[]; followups?: string[] } }, today: string, now = false) {
  const missing = request.details.items.filter((item) => !item.received.length).map((item) => item.type);
  const asked = new Date(Date.parse(request.expires_at) - 30 * DAY).toISOString().slice(0, 10);
  const last = request.details.followups?.at(-1) ?? asked;
  const count = request.details.followups?.length ?? 0;
  return missing.length && count < MAX_FOLLOW_UPS && (now || -daysUntil(last, today) >= FOLLOW_UP_DAYS) ? missing : null;
}

// The one email a client gets today, in English (Hindi and Gujarati follow once a native
// speaker has checked the wording): returns due, and documents still missing.
export function reminderEmail(client: string, firm: string, tasks: ReminderTask[], today: string, followUps: FollowUp[] = []) {
  const when = (due: string) => {
    const days = daysUntil(due, today);
    return days === 0 ? "today" : days > 0 ? `in ${days} ${days === 1 ? "day" : "days"}` : `${-days} ${days === -1 ? "day" : "days"} ago`;
  };
  const lines = tasks.map((task) => `- ${task.rule.name} for ${periodLabel(task.rule.frequency, task.period_key)}: due ${when(task.due_on)}, on ${dueLabel(task.due_on)}`);
  const asks = [...new Set(tasks.flatMap((task) => checklists[workOfService(task.code) as WorkType] ?? []))];
  const late = tasks.some((task) => daysUntil(task.due_on, today) < 0);
  const waiting = followUps.flatMap((followUp) => [
    `We are still waiting for these documents${followUp.period ? ` for ${periodName(followUp.period)}` : ""}: ${followUp.missing.join(", ")}.`,
    `Upload them here, no sign in needed: ${followUp.link}`,
    "",
  ]);
  return {
    subject: !tasks.length
      ? "Documents still needed"
      : tasks.length === 1
        ? `${late ? "Overdue" : "Reminder"}: ${tasks[0].rule.name} due ${dueLabel(tasks[0].due_on)}`
        : `${late ? "Overdue returns" : "Returns due soon"}: ${tasks.length} returns`,
    text: [
      `Dear ${client},`,
      "",
      ...(tasks.length
        ? [
            `This is a reminder from ${firm} about:`,
            ...lines,
            "",
            ...(asks.length ? [`If you have not sent them yet, please reply to this email with your ${asks.join(", ").toLowerCase()}.`, ""] : []),
          ]
        : []),
      ...waiting,
      "If you have already sent everything, please ignore this message.",
      "",
      firm,
    ].join("\n"),
  };
}

// Until AI writing is enabled, even a factually correct paraphrase uses the checked wording.
// Compare every dated, numbered and named fact, then require the template's sentences too.
export function checkedReminder(draft: { subject: string; text: string } | undefined, template: { subject: string; text: string }) {
  if (!draft) return template;
  const facts = (mail: typeof template) => `${mail.subject} ${mail.text}`.match(/\b(?:\d[\w,./:-]*|[A-Z][A-Z0-9]*(?:-\d[\w()-]*)?|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g)?.join(" ") ?? "";
  const words = (value: string) => value.replace(/\s+/g, " ").trim();
  return facts(draft) === facts(template) && words(draft.subject) === words(template.subject) && words(draft.text) === words(template.text) ? draft : template;
}
