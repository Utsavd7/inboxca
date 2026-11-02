import { personName } from "./roles";

// Who prepared, approved, rejected and filed a return, from the log's form.* lines
// (public.form_signoffs), as one line each: "Prepared by Asha, 3 Nov 2026, 10:12". A line
// without a person is InboxCA's own fill. The latest of each kind counts.
export type Signoff = { document: string; action: string; actor_id: string | null; at: string };
const words: Record<string, string> = { "form.prepared": "Prepared", "form.approved": "Approved", "form.rejected": "Sent back", "form.filed": "Marked filed" };
export const whenWords = (at: string) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(" at ", ", ");

export function signoffLines(rows: Signoff[] | null | undefined, document: string, emailOf: (person: string | null) => string | undefined) {
  const latest = new Map<string, Signoff>();
  for (const row of rows ?? []) if (row.document === document && words[row.action]) latest.set(row.action, row);
  return Object.keys(words).flatMap((action) => {
    const row = latest.get(action);
    return row ? [{ action, who: row.actor_id ? personName(emailOf(row.actor_id)) : "InboxCA", when: whenWords(row.at), line: `${words[action]} by ${row.actor_id ? personName(emailOf(row.actor_id)) : "InboxCA"}, ${whenWords(row.at)}` }] : [];
  });
}
