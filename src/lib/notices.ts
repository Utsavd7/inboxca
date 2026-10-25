// The notice tracker (PLAN.md 5.6): what a notice is, read by rules from the email and any
// PDF with it, never by AI. The rules may suggest an action date; it becomes the action
// date only when a person confirms it against the notice.
export const authorities = { income_tax: "Income Tax", gst: "GST", roc: "MCA", other: "Other" } as const;
export type Authority = keyof typeof authorities;
export const noticeStatuses = { upcoming: "Open", in_progress: "In progress", replied: "Replied", closed: "Closed" } as const;

const types: [RegExp, string, Authority][] = [
  [/143\s?\(1\)|intimation u\/s 143/, "Intimation u/s 143(1)", "income_tax"],
  [/143\s?\(2\)/, "Notice u/s 143(2)", "income_tax"],
  [/142\s?\(1\)/, "Notice u/s 142(1)", "income_tax"],
  [/\b148a?\b/, "Notice u/s 148", "income_tax"],
  [/\b156\b|demand notice/, "Demand notice u/s 156", "income_tax"],
  [/drc[\s-]?01a?\b/, "DRC-01", "gst"],
  [/asmt[\s-]?10/, "ASMT-10", "gst"],
  [/reg[\s-]?(03|17|23)\b/, "Registration notice", "gst"],
  [/show cause/, "Show cause notice", "other"],
  [/summons/, "Summons", "other"],
];
const authorityWords: [RegExp, Authority][] = [
  [/\bgst\b|gstin|cgst|sgst|igst/, "gst"],
  [/income[\s-]?tax|assessment year|\bcpc\b|\bpan\b|\bdin\b/, "income_tax"],
  [/\bmca\b|\broc\b|companies act|registrar of companies/, "roc"],
];

const DAY = 86_400_000;
const isoDate = (day: number, month: number, year: number) => {
  const full = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(full, month - 1, day));
  return date.getUTCDate() === day && date.getUTCMonth() === month - 1 ? date.toISOString().slice(0, 10) : "";
};

// The notice in an email: its authority and type, the reference or DIN, and a date to reply
// by when the text names one ("on or before 25/10/2026", "within 15 days").
export function readNotice(text: string, receivedOn: string) {
  const words = text.toLowerCase();
  const found = types.find(([pattern]) => pattern.test(words));
  const authority: Authority = found && found[2] !== "other" ? found[2] : (authorityWords.find(([pattern]) => pattern.test(words))?.[1] ?? found?.[2] ?? "other");
  const reference = text.match(/\bDIN[\s.:-]*([A-Z0-9/-]{10,40})/i)?.[1] ?? text.match(/\b(?:reference|ref\.?)\s*(?:no\.?|number)?[\s.:-]*([A-Z0-9/-]{6,40})/i)?.[1] ?? "";
  const on = words.match(/(?:on or before|not later than|latest by|by)\s+(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  const within = words.match(/within\s+(\d{1,3})\s+days/);
  const suggested = on ? isoDate(Number(on[1]), Number(on[2]), Number(on[3])) : within ? new Date(Date.parse(receivedOn) + Number(within[1]) * DAY).toISOString().slice(0, 10) : "";
  return { authority, type: found?.[1] ?? "Other", reference: reference.toUpperCase(), suggested };
}

// The firm's own review deadline for a notice with no confirmed action date: the given
// number of working days after it was received, Sundays and the firm's holidays skipped.
export function reviewBy(receivedOn: string, days = 1, holidays: string[] = []) {
  let at = Date.parse(receivedOn);
  for (let left = days; left > 0; ) {
    at += DAY;
    const date = new Date(at).toISOString().slice(0, 10);
    if (new Date(at).getUTCDay() !== 0 && !holidays.includes(date)) left--;
  }
  return new Date(at).toISOString().slice(0, 10);
}

export type NoticeDetails = { authority: Authority; notice_type: string; reference: string; received_on: string; action_date?: string; suggested_date?: string; email_event_id?: string };

// Who confirmed each notice's action date, from its activity lines: the confirmation, or else
// the person who added the notice with its date.
export const confirmAction = ["notice.date_confirmed", "notice.added"];
export function confirmers(lines: { entity_id: string | null; action: string; actor_id: string | null }[]) {
  const by = new Map<string, string>();
  for (const line of lines) if (line.entity_id && line.actor_id && (line.action === "notice.date_confirmed" || !by.has(line.entity_id))) by.set(line.entity_id, line.actor_id);
  return by;
}
