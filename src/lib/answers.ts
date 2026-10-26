import { addDays, dueLabel, periodLabel } from "./calendar";
import { workOfService } from "./checklists";
import { findPeriod, periodName } from "./documents";
import { workTypes, type WorkType } from "./drive";
import { periodsOf } from "./reminders";

// Answers by rules (PLAN.md "Inbox, answered" B and C): a client asking whether a return is
// filed, which papers are still needed or what is due gets a reply built only from InboxCA's
// confirmed records; papers saved from an email and a notice get a short receipt. No AI, no
// advice. Each kind is Auto, Ask me first (the default) or Off in Settings.
export const answerKinds = {
  filed: ["Is my return filed", "The returns marked filed, with the date and the acknowledgement number."],
  papers: ["Which papers are still needed", "The papers still asked for, with the upload link."],
  due: ["What is due", "Returns due in the next 30 days, only dates InboxCA has checked."],
  received: ["Papers received", "Which papers arrived and where they were saved."],
  notice: ["Notice received", "That the notice arrived and your CA will look at it. Never advice."],
} as const;
export type AnswerKind = keyof typeof answerKinds;
export const answerModes = { auto: "Auto", ask: "Ask me first", off: "Off" } as const;
export type AnswerMode = keyof typeof answerModes;
// An automatic answer waits this long, so a person can Undo it from the Inbox.
export const UNDO_MINUTES = 5;
const DUE_DAYS = 30;

// The firm's choice for a kind. The papers receipt used to be one switch (acknowledge), on or off.
export function answerMode(settings: { answers?: unknown; acknowledge?: unknown }, kind: AnswerKind): AnswerMode {
  const chosen = (settings.answers as Partial<Record<string, string>> | undefined)?.[kind];
  if (chosen && Object.hasOwn(answerModes, chosen)) return chosen as AnswerMode;
  return kind === "received" && settings.acknowledge === true ? "auto" : "ask";
}

// The answer an email's label calls for. Requests for a paper have their own reply (5.5.2).
export const answerOf = (label: string | null): AnswerKind | null =>
  label === "ask_filed" ? "filed" : label === "ask_papers" ? "papers" : label === "ask_due" ? "due" : label === "notice_received" ? "notice" : label === "records_past" || label === "records_current" ? null : "received";

// What an answer says, for the Inbox: before it goes, and once it went.
export const answerWords: Record<AnswerKind, [string, string]> = {
  filed: ["Says which returns are filed", "InboxCA told the client which returns are filed."],
  papers: ["Lists the papers still needed, with the upload link", "InboxCA sent the client the papers still needed, with the upload link."],
  due: ["Lists what is due in the next 30 days", "InboxCA told the client what is due."],
  received: ["Says which papers arrived", "InboxCA told the client their papers arrived."],
  notice: ["Says the notice arrived and your CA will look at it", "InboxCA told the client their notice arrived."],
};

// Which return a question names, and for which period, kept with the email (never its words).
export type Asked = { form?: string; period?: string };
const forms: [RegExp, string, (code: string) => boolean][] = [
  [/gstr[\s-]?1\b/, "GSTR1", (code) => code.startsWith("GSTR1_")],
  [/gstr[\s-]?3b/, "GSTR3B", (code) => code.startsWith("GSTR3B_")],
  [/gstr[\s-]?9/, "GSTR9", (code) => code === "GSTR9"],
  [/tax audit|\b3c[abd]\b/, "TAX_AUDIT", (code) => code === "TAX_AUDIT"],
  [/\bitr\b|income[\s-]?tax|आयकर|આવકવેરા/, "ITR", (code) => /^(ITR|ADV)/.test(code)],
  [/\btds\b/, "TDS", (code) => code.startsWith("TDS")],
  [/\bgst/, "GST", (code) => workOfService(code) === "gst"],
];
export function askedAbout(subject: string, text: string): Asked {
  const words = `${subject}\n${text}`.toLowerCase();
  const form = forms.find(([pattern]) => pattern.test(words))?.[1];
  const period = findPeriod(words);
  return { ...(form && { form }), ...(period && { period }) };
}
const fits = (asked: Asked) => forms.find(([, form]) => form === asked.form)?.[2] ?? (() => true);
const inPeriod = (task: AnswerTask, period: string) => periodsOf(task.rule.frequency, task.period_key).includes(period);

export type AnswerTask = { code: string; period_key: string; due_on: string; status: string; details: { filed_on?: string; ack?: string }; rule: { name: string; frequency: string | null; verified: boolean } };
type Lines = { lines: string[] } | { team: string };

// Is it filed: the returns of the period asked, or else of the latest period that is due or
// filed. Only when every one of them is marked filed; anything else is for a person.
export function filedAnswer(tasks: AnswerTask[], asked: Asked, today: string): Lines {
  const returns = tasks.filter((task) => !/^(PMT|TDS_PAY|ADV)/.test(task.code) && fits(asked)(task.code));
  const settled = returns.filter((task) => task.status === "filed" || task.due_on <= today);
  if (!asked.form && new Set(settled.map((task) => workOfService(task.code) ?? task.code)).size > 1) return { team: "status_unclear" };
  const latest = settled.map((task) => task.period_key).sort().at(-1);
  const chosen = asked.period ? returns.filter((task) => inPeriod(task, asked.period!)) : settled.filter((task) => task.period_key === latest);
  if (!chosen.length) return { team: "status_unclear" };
  if (chosen.some((task) => task.status !== "filed" || !task.details.filed_on)) return { team: "status_not_filed" };
  return {
    lines: chosen.map((task) => `- ${task.rule.name} for ${periodLabel(task.rule.frequency, task.period_key)}: filed on ${dueLabel(task.details.filed_on!)}${task.details.ack ? `, acknowledgement number ${task.details.ack}` : ""}`),
  };
}

// What is due: returns not yet filed, due in the next 30 days (or of the period asked), and only
// when every date is checked and none is late.
export function dueAnswer(tasks: AnswerTask[], asked: Asked, today: string): Lines {
  const open = tasks.filter((task) => task.status !== "filed" && fits(asked)(task.code) && (asked.period ? inPeriod(task, asked.period) : task.due_on >= addDays(today, -DUE_DAYS) && task.due_on <= addDays(today, DUE_DAYS)));
  if (open.some((task) => !task.rule.verified)) return { team: "due_unchecked" };
  if (open.some((task) => task.due_on < today)) return { team: "due_late" };
  if (!open.length) return { team: "due_none" };
  return { lines: open.sort((a, b) => a.due_on.localeCompare(b.due_on)).map((task) => `- ${task.rule.name} for ${periodLabel(task.rule.frequency, task.period_key)}: due on ${dueLabel(task.due_on)}`) };
}

// Papers still needed: each open ask's missing papers and its upload link.
export type OpenAsk = { period: string; missing: string[]; link: string };
export function papersAnswer(asks: OpenAsk[], asked: Asked): Lines {
  const open = asks.filter((ask) => ask.missing.length && (!asked.period || !ask.period || ask.period === asked.period));
  if (!open.length) return { team: "papers_none" };
  return { lines: open.flatMap((ask) => [`We still need these papers${ask.period ? ` for ${periodName(ask.period)}` : ""}:`, ...ask.missing.map((type) => `- ${type}`), `Upload them here, no sign in needed: ${ask.link}`, ""]).slice(0, -1) };
}

// Papers received: by where they were saved (work and period); those under To check counted.
export function receivedLines(papers: { type: string; work: string; period: string; toCheck: boolean }[]) {
  const places = new Map<string, string[]>();
  for (const paper of papers.filter((paper) => !paper.toCheck)) {
    const place = [paper.work !== "other" ? workTypes[paper.work as WorkType] : "", periodName(paper.period)].filter(Boolean).join(", ");
    places.set(place, [...new Set([...(places.get(place) ?? []), paper.type])]);
  }
  const unclear = papers.filter((paper) => paper.toCheck).length;
  return [
    ...[...places].map(([place, types]) => `- ${types.join(", ")}${place ? `: saved under ${place}` : ""}`),
    ...(unclear ? [`- ${unclear === 1 ? "1 file" : `${unclear} files`} our team will check`] : []),
  ];
}
