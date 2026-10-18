import { dueLabel, periodLabel } from "./calendar";
import { checklists, workOfService } from "./checklists";
import type { WorkType } from "./drive";

// Smart reminders (PLAN.md 5.2, 5.2.1, D25): which of a firm's open returns are reminded
// today, which are skipped and why, and the one email each client gets. Every fact in the
// email comes from InboxCA's records; nothing is advised or promised.

// Days before (positive) or after (negative) the due date on which a reminder goes.
export const STAGES = [7, 3, 1, 0, -1, -3];
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
export function planReminders(tasks: ReminderTask[], today: string, filed: Set<string>, handling: Set<string>) {
  const send = new Map<string, ReminderTask[]>();
  const skipped: { task: ReminderTask; reason: Skip }[] = [];
  for (const task of tasks) {
    if (!STAGES.includes(daysUntil(task.due_on, today))) continue;
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

// The one email a client gets today, in English (Hindi and Gujarati follow once a native
// speaker has checked the wording).
export function reminderEmail(client: string, firm: string, tasks: ReminderTask[], today: string) {
  const when = (due: string) => {
    const days = daysUntil(due, today);
    return days === 0 ? "today" : days > 0 ? `in ${days} ${days === 1 ? "day" : "days"}` : `${-days} ${days === -1 ? "day" : "days"} ago`;
  };
  const lines = tasks.map((task) => `- ${task.rule.name} for ${periodLabel(task.rule.frequency, task.period_key)}: due ${when(task.due_on)}, on ${dueLabel(task.due_on)}`);
  const asks = [...new Set(tasks.flatMap((task) => checklists[workOfService(task.code) as WorkType] ?? []))];
  const late = tasks.some((task) => daysUntil(task.due_on, today) < 0);
  return {
    subject: tasks.length === 1 ? `${late ? "Overdue" : "Reminder"}: ${tasks[0].rule.name} due ${dueLabel(tasks[0].due_on)}` : `${late ? "Overdue returns" : "Returns due soon"}: ${tasks.length} returns`,
    text: [
      `Dear ${client},`,
      "",
      `This is a reminder from ${firm} about:`,
      ...lines,
      "",
      ...(asks.length ? [`If you have not sent them yet, please reply to this email with your ${asks.join(", ").toLowerCase()}.`, ""] : []),
      "If you have already sent everything, please ignore this message.",
      "",
      firm,
    ].join("\n"),
  };
}
