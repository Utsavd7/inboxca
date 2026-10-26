import { expect, it } from "vitest";
import { inboxWeek, inboxWorkItems } from "@/src/lib/work/inbox";

// A stand in for the signed in person's Supabase client: each table answers with rows, and a
// count answers by the outcome it was filtered on.
const now = Date.now();
const ago = (days: number) => new Date(now - days * 86_400_000 - 60_000).toISOString();
const rows: Record<string, unknown[]> = {
  requests: [
    { entity_id: "mail-new", client_id: "c1", reason_code: "no_rule", clients: { name: "Shah Traders" } },
    { entity_id: "mail-old", client_id: null, reason_code: "client_unclear", clients: null },
  ],
  email_events: [{ id: "mail-new", received_at: ago(0) }, { id: "mail-old", received_at: ago(3) }],
  shares: [{ id: "s1", documents: { name: "Balance sheet.pdf", client_id: "c1", clients: { name: "Shah Traders" } } }],
};
const counts: Record<string, number> = { "": 9, answered: 4, replied: 2, reply: 3 };
const supabase = {
  from(table: string) {
    let outcome = "";
    const query = {
      select: () => query, eq: () => query, or: () => query, in: () => query, gte: () => query, limit: () => query,
      contains: (_: string, [value]: string[]) => ((outcome = value), query),
      then: (resolve: (value: unknown) => void) => resolve(table === "email_outcomes" ? { count: counts[outcome] } : { data: rows[table] }),
    };
    return query;
  },
};
const context = { supabase, membership: { firmId: "firm" }, userId: "me" } as unknown as Parameters<typeof inboxWorkItems>[0];

it("lists emails waiting for a person, the longest waiting first, then papers to approve", async () => {
  expect(await inboxWorkItems(context)).toEqual([
    { key: "reply:mail-old", title: "Reply to a contact", why: "Writes for several clients. Pick which one. Waiting 3 days", action: { label: "Reply", href: "/app/inbox?mail=mail-old" }, audience: "firm" },
    { key: "reply:mail-new", title: "Reply to Shah Traders", why: "Asks something InboxCA could not answer", client: { id: "c1", name: "Shah Traders" }, action: { label: "Reply", href: "/app/inbox?mail=mail-new" }, audience: "assigned" },
    { key: "approve:s1", title: "Approve Balance sheet.pdf", why: "A private paper was asked for. It goes as a secure link once approved", client: { id: "c1", name: "Shah Traders" }, action: { label: "Approve", href: "/app/inbox#papers" }, audience: "approver" },
  ]);
});

it("counts the week's email: read, answered by InboxCA, answered by the team, waiting", async () => {
  expect(await inboxWeek(context)).toEqual({ read: 9, answered: 4, replied: 2, waiting: 3 });
});
