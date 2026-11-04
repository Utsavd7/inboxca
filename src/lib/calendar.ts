// The compliance calendar's display rules (PLAN.md 5.1). Rules and dates live in the
// database; a period's key is the month it ends in, YYYY-MM.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (key: string, offset = 0) => {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + offset;
  return `${months[index % 12]} ${Math.floor(index / 12)}`;
};

// A year in words, the one rule every page and email follows. key: the March the year ends in
// ("2026" or "2026-03"). Income tax work: income to 31 March 2026 is assessed under the
// Income-tax Act, 1961, "AY 2026-27 (FY 2025-26)"; from 1 April 2026 the Income-tax Act, 2025
// has no assessment year, "Tax year 2026-27". GST, TDS, ROC and the books keep the financial
// year, "FY 2026-27".
export function yearName(key: string, incomeTax = false) {
  const end = Number(key.slice(0, 4));
  const fy = `${end - 1}-${String(end).slice(2)}`;
  return !incomeTax ? `FY ${fy}` : end >= 2027 ? `Tax year ${fy}` : `AY ${end}-${String(end + 1).slice(2)} (FY ${fy})`;
}

// "Sep 2026", "Jul to Sep 2026", or a year by yearName: income tax for the ITR, advance tax and
// tax audit codes (checklists.ts workOfService).
export function periodLabel(frequency: string | null, key: string | null, code?: string | null) {
  if (!key) return "";
  if (frequency === "yearly") return yearName(key, /^(ITR|ADV|TAX_AUDIT)/.test(code ?? ""));
  if (frequency === "quarterly") return `${monthOf(key, -2).split(" ")[0]} to ${monthOf(key)}`;
  if (frequency === "half_yearly") return `${monthOf(key, -5).split(" ")[0]} to ${monthOf(key)}`;
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
  soon: { label: "Due in 30 days", window: (today: string) => ({ from: today, to: addDays(today, 30) }) },
  filed: { label: "Filed in the last 30 days", window: (today: string) => ({ filedSince: addDays(today, -30) }) },
} as const;
export type CalendarView = keyof typeof calendarViews;
