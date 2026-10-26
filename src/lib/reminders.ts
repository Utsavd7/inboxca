import { dueLabel, periodLabel } from "./calendar";
import { checklists, workOfService } from "./checklists";
import { periodName, workOfType } from "./documents";
import { askName } from "./paper-type";
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
  date_not_confirmed: "Not reminded: InboxCA has not yet checked this due date against the government notification",
  paused: "Not reminded: reminders are paused for this client",
  no_email: "Not reminded: the client has no email address",
  data_received: "Not reminded: the client already sent papers for this period",
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
// A request InboxCA opened itself goes first in the next email it may send (first); the wait
// counts from the latest ask: a follow up, the first email, the client's latest paper, or a call.
export type FollowUp = { requestId: string; client_id: string; period: string; missing: string[]; link: string; count: number; first?: boolean; returns?: string[] };
export const FOLLOW_UP_DAYS = 3;
export const MAX_FOLLOW_UPS = 4;
type Asking = { items: { type: string; received: string[] }[]; followups?: string[]; returns?: string[]; since?: string; chased?: string };
export const firstAsk = (details: Asking) => !!details.returns && !details.since && !details.followups?.length;
export function followUpDue(request: { expires_at: string; details: Asking }, today: string, now = false) {
  const missing = request.details.items.filter((item) => !item.received.length).map((item) => item.type);
  const asked = new Date(Date.parse(request.expires_at) - 30 * DAY).toISOString().slice(0, 10);
  const last = [request.details.followups?.at(-1), request.details.since, request.details.chased].filter((day): day is string => !!day).sort().at(-1) ?? asked;
  const count = request.details.followups?.length ?? 0;
  return missing.length && count < MAX_FOLLOW_UPS && (now || firstAsk(request.details) || -daysUntil(last, today) >= FOLLOW_UP_DAYS) ? missing : null;
}

// Ask early (user, 26 Oct 2026): InboxCA itself asks a client for a return's papers this many
// days before the return is due, by how often it comes; 0 is Off. A firm sets its own in
// Settings (firms.settings.ask_days).
export const ASK_DAYS = { monthly: 10, quarterly: 15, yearly: 45 };
export const askChoices = [0, 5, 7, 10, 15, 20, 30, 45, 60];
export const askDays = (settings: { ask_days?: unknown }): Record<string, number> => ({ ...ASK_DAYS, ...(settings.ask_days as Partial<typeof ASK_DAYS> | undefined) });

// Papers staff fetch from the portals themselves (PLAN.md 5.3.1), never asked of a client.
const portalPapers = new Set(["AIS", "TIS", "Form 26AS", "Form 168", "GSTR-2B", "GSTR-2A"]);
// What a return's work needs from a kind of client: the firm's list for the kind, kept to that
// work's papers, or the work's own list when the kind's list has none of them.
export function papersFor(kindList: string[], work: WorkType) {
  const fits = kindList.filter((type) => !portalPapers.has(type) && (checklists[work]?.includes(type) || workOfType(type) === work));
  return fits.length ? fits : (checklists[work] ?? []);
}

// The requests InboxCA opens today: one a client, work and period (a client's GSTR-1 and GSTR-3B
// for a month share one), from the day to ask for any of its returns up to its due date. Only
// returns whose work needs papers and whose date a CA confirmed, for clients with an email and
// reminders on; advance tax is worked out from an estimate, so it is left out. A key already
// asked for (`taken`, "<client>:<work>:<period>") is skipped. Papers already in for the period
// (`received`, "<client>:<period>:<TYPE>") are not asked for, and nothing is opened when none
// is left. A yearly return's papers are for its financial year ("2027" for FY 2026-27).
export function planAsks(tasks: (ReminderTask & { kind: string })[], today: string, days: Record<string, number>, listFor: (kind: string, work: WorkType) => string[], taken: Set<string>, received: Set<string>) {
  const plain = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const keyOf = (task: ReminderTask) => {
    const work = workOfService(task.code);
    return work && !task.code.startsWith("ADV") ? { work, period: task.rule.frequency === "yearly" ? task.period_key.slice(0, 4) : task.period_key } : null;
  };
  const asks = new Map<string, { client_id: string; work: WorkType; period: string; periods: string[]; kind: string; returns: string[] }>();
  for (const task of tasks) {
    const of = keyOf(task);
    const ahead = days[task.rule.frequency ?? ""] ?? 0;
    const left = daysUntil(task.due_on, today);
    const key = of && `${task.client_id}:${of.work}:${of.period}`;
    if (of && key && ahead && left >= 0 && left <= ahead && task.rule.verified && !task.client.paused && task.client.hasEmail && !taken.has(key))
      asks.set(key, { client_id: task.client_id, work: of.work, period: of.period, periods: periodsOf(task.rule.frequency, task.period_key), kind: task.kind, returns: [] });
  }
  // Every open return of that work and period is named on it.
  for (const task of tasks) {
    const of = keyOf(task);
    const ask = of && asks.get(`${task.client_id}:${of.work}:${of.period}`);
    if (ask && !ask.returns.includes(task.code)) ask.returns.push(task.code);
  }
  return [...asks.values()].flatMap(({ periods, kind, ...ask }) => {
    const items = listFor(kind, ask.work).filter((type) => ![type, ...(type === "Form 16" ? ["Form 130"] : [])].some((name) => periods.some((period) => received.has(`${ask.client_id}:${period}:${plain(name)}`))));
    // Returns in a fixed order (GSTR-1 before GSTR-3B), so the client's email always reads the same.
    return items.length ? [{ ...ask, returns: [...ask.returns].sort(), items }] : [];
  });
}

// The one email a client gets today, in English (InboxCA writes in English only): returns
// due, and documents still missing.
export function reminderEmail(client: string, firm: string, tasks: ReminderTask[], today: string, followUps: FollowUp[] = []) {
  const when = (due: string) => {
    const days = daysUntil(due, today);
    return days === 0 ? "today" : days > 0 ? `in ${days} ${days === 1 ? "day" : "days"}` : `${-days} ${days === -1 ? "day" : "days"} ago`;
  };
  const lines = tasks.map((task) => `- ${task.rule.name} for ${periodLabel(task.rule.frequency, task.period_key)}: due ${when(task.due_on)}, on ${dueLabel(task.due_on)}`);
  const asks = [...new Set(tasks.flatMap((task) => checklists[workOfService(task.code) as WorkType] ?? []))];
  const late = tasks.filter((task) => daysUntil(task.due_on, today) < 0).length;
  const waiting = followUps.flatMap((followUp) => [
    followUp.first
      ? `${followUp.returns?.length ? `To prepare your ${followUp.returns.join(" and ")}${followUp.period ? ` for ${periodName(followUp.period)}` : ""}, please` : "Please"} send these documents: ${followUp.missing.map(askName).join(", ")}.`
      : `We are still waiting for these documents${followUp.period ? ` for ${periodName(followUp.period)}` : ""}: ${followUp.missing.map(askName).join(", ")}.`,
    `Upload them here, no sign in needed: ${followUp.link}`,
    "",
  ]);
  return {
    subject: !tasks.length
      ? followUps.every((followUp) => followUp.first) ? "Documents needed" : "Documents still needed"
      : tasks.length === 1
        ? `${late ? "Overdue" : "Reminder"}: ${tasks[0].rule.name} due ${dueLabel(tasks[0].due_on)}`
        : late ? `Returns due: ${tasks.length} returns, ${late} overdue` : `Returns due soon: ${tasks.length} returns`,
    text: [
      `Dear ${client},`,
      "",
      ...(tasks.length
        ? [
            `This is a reminder from ${firm} about:`,
            ...lines,
            "",
            ...(asks.length ? [`If you have not sent these papers yet, please reply to this email with them attached: ${asks.map(askName).join(", ")}.`, ""] : []),
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
