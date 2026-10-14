// Office hours as firms.settings keeps them: weekday (0 is Sunday) to opening and closing
// time, India time. A missing day is closed.
export type Hours = Record<string, [string, string]>;

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
