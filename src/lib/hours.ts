// Office hours as firms.settings keeps them: weekday (0 is Sunday) to opening and closing
// time, India time. A missing day is closed.
export type Hours = Record<string, [string, string]>;
// A date range with its own times, every day in it (Season hours, a late evening).
export type SpecialHours = { from: string; to: string; open: string; close: string };

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The editable starting point PLAN.md suggests: Monday to Saturday, 9:00 to 18:00.
export const SUGGESTED_HOURS: Hours = Object.fromEntries(
  [1, 2, 3, 4, 5, 6].map((day) => [String(day), ["09:00", "18:00"]]),
);

// "Monday, Tuesday: 09:00 to 18:00; Saturday: 09:00 to 13:00"
export function describeHours(hours: Hours | null | undefined) {
  const groups = new Map<string, string[]>();
  for (const [day, name] of DAYS.entries()) {
    const times = hours?.[String(day)];
    if (times) groups.set(`${times[0]} to ${times[1]}`, [...(groups.get(`${times[0]} to ${times[1]}`) ?? []), name]);
  }
  return [...groups].map(([times, days]) => `${days.join(", ")}: ${times}`).join("; ");
}

// "1 July 2026" for a "2026-07-01" date.
export const longDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

// "18:00" plus 60 minutes is "19:00", never past the day's end.
export const laterBy = (time: string, minutes: number) => {
  const total = Math.min(23 * 60 + 59, Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

// When the firm closes today for one person bound by office hours, India time, counting
// their extra time today (firm_members.access.extra_time, as open_to() reads it); null on a
// closed day; `at` is the closing moment in milliseconds. 23:59, the latest time Settings
// offers, means open to the end of the day, as open_to() reads it.
export function closingToday(settings: Record<string, unknown>, person: unknown, now = new Date()) {
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const special = ((settings.special_hours ?? []) as SpecialHours[]).find((range) => day >= range.from && day <= range.to);
  const close = special?.close ?? (settings.hours as Hours | undefined)?.[String(new Date(`${day}T00:00:00Z`).getUTCDay())]?.[1];
  const extra = (person as { extra_time?: { day: string; until: string } } | null)?.extra_time;
  const extended = extra?.day === day;
  const until = extended && (!close || extra.until > close) ? extra.until : close;
  return until ? { day, close: until, extended, at: Date.parse(`${day}T${until}:00+05:30`) + (until === "23:59" ? 60_000 : 0) } : null;
}
