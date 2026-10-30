// The compliance calendar's display rules (PLAN.md 5.1). Rules and dates live in the
// database; a period's key is the month it ends in, YYYY-MM.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (key: string, offset = 0) => {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + offset;
  return `${months[index % 12]} ${Math.floor(index / 12)}`;
};

// "Sep 2026", "Jul to Sep 2026", or "FY 2025-26" for a year ending in March 2026. A year from
// 1 April 2026 is a tax year under the Income-tax Act, 2025: "Tax year 2026-27".
export function periodLabel(frequency: string | null, key: string | null) {
  if (!key) return "";
  if (frequency === "yearly") {
    const end = Number(key.slice(0, 4));
    return `${end >= 2027 ? "Tax year" : "FY"} ${end - 1}-${String(end).slice(2)}`;
  }
  if (frequency === "quarterly") return `${monthOf(key, -2).split(" ")[0]} to ${monthOf(key)}`;
  return monthOf(key);
}

// "20 Oct 2026" from a date column, whatever the server's time zone.
export const dueLabel = (date: string) => `${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

export const taskStatuses = { upcoming: "Upcoming", in_progress: "In progress", filed: "Filed" } as const;
// An income tax return is e-verified within 30 days of filing (incometax.gov.in, ITR-V FAQs,
// citing Notification No. 2/2024 of 31 March 2024). Counted from the day it was filed, never stored.
export const EVERIFY_DAYS = 30;
export const verifyBy = (filedOn: string) => addDays(filedOn, EVERIFY_DAYS);
export const isItr = (code: string | null | undefined) => !!code?.startsWith("ITR");

// Today in India, as a date column holds it (YYYY-MM-DD).
export const todayInIndia = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
// The GST portal refuses a GSTR-1 or GSTR-3B three years after its due date (Finance Act 2023).
// Their due dates fall in the month after the month or its quarter, so a month is offered until
// three years after the end of the month after its quarter.
export const gstPortalTakes = (period: string, today = todayInIndia()) =>
  today <= new Date(Date.UTC(Number(period.slice(0, 4)) + 3, Math.ceil(Number(period.slice(5, 7)) / 3) * 3 + 1, 0)).toISOString().slice(0, 10);
export const gstPortalClosed = "The GST portal no longer takes this return. It is more than three years past its due date.";

// The calendar page's views: what is late, what is coming, what was filed.
export const calendarViews = {
  overdue: { label: "Late", window: (today: string) => ({ to: addDays(today, -1) }) },
  week: { label: "Due in 7 days", window: (today: string) => ({ from: today, to: addDays(today, 7) }) },
  month: { label: "Due in 30 days", window: (today: string) => ({ from: today, to: addDays(today, 30) }) },
  filed: { label: "Filed in the last 30 days", window: (today: string) => ({ filedSince: addDays(today, -30) }) },
} as const;
export type CalendarView = keyof typeof calendarViews;
