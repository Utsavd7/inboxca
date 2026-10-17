// The compliance calendar's display rules (PLAN.md 5.1). Rules and dates live in the
// database; a period's key is the month it ends in, YYYY-MM.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (key: string, offset = 0) => {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + offset;
  return `${months[index % 12]} ${Math.floor(index / 12)}`;
};

// "Sep 2026", "Jul to Sep 2026", or "FY 2025-26" for a year ending in March 2026.
export function periodLabel(frequency: string | null, key: string | null) {
  if (!key) return "";
  if (frequency === "yearly") {
    const end = Number(key.slice(0, 4));
    return `FY ${end - 1}-${String(end).slice(2)}`;
  }
  if (frequency === "quarterly") return `${monthOf(key, -2).split(" ")[0]} to ${monthOf(key)}`;
  return monthOf(key);
}

// "20 Oct 2026" from a date column, whatever the server's time zone.
export const dueLabel = (date: string) => `${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

export const taskStatuses = { upcoming: "Upcoming", in_progress: "In progress", filed: "Filed" } as const;
