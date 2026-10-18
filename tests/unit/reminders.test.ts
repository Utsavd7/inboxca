import { describe, expect, it } from "vitest";
import { planReminders, reminderEmail, type ReminderTask } from "@/src/lib/reminders";

const today = "2026-10-17";
const task = (overrides: Partial<ReminderTask> & { id: string }): ReminderTask => ({
  client_id: "patel",
  code: "GSTR3B_M",
  period_key: "2026-09",
  due_on: "2026-10-20",
  rule: { name: "GSTR-3B (monthly)", frequency: "monthly", verified: true },
  client: { paused: false, hasEmail: true },
  ...overrides,
});

describe("smart reminders", () => {
  it("reminds on the set days only, one email a client for everything due", () => {
    const { send } = planReminders(
      [task({ id: "a" }), task({ id: "b", code: "GSTR1_M", rule: { name: "GSTR-1 (monthly)", frequency: "monthly", verified: true } }), task({ id: "c", due_on: "2026-10-22" })],
      today,
      new Set(),
      new Set(),
    );
    expect([...send.keys()]).toEqual(["patel"]);
    expect(send.get("patel")!.map((t) => t.id)).toEqual(["a", "b"]);
  });
  it("skips, with the reason, when the date is unconfirmed, reminders are paused, data has arrived or the team is replying", () => {
    const { send, skipped } = planReminders(
      [
        task({ id: "unconfirmed", rule: { name: "GSTR-3B (monthly)", frequency: "monthly", verified: false } }),
        task({ id: "paused", client_id: "shah", client: { paused: true, hasEmail: true } }),
        task({ id: "sent", client_id: "mehta" }),
        task({ id: "handled", client_id: "kapoor" }),
      ],
      today,
      new Set(["mehta:gst:2026-09"]),
      new Set(["kapoor"]),
    );
    expect(send.size).toBe(0);
    expect(skipped.map(({ task: t, reason }) => [t.id, reason])).toEqual([
      ["unconfirmed", "date_not_confirmed"],
      ["paused", "paused"],
      ["sent", "data_received"],
      ["handled", "team_handling"],
    ]);
  });
  it("writes the email from the records alone", () => {
    const { subject, text } = reminderEmail("Patel Textiles", "Demo CA Firm", [task({ id: "a" })], today);
    expect(subject).toBe("Reminder: GSTR-3B (monthly) due 20 Oct 2026");
    expect(text).toContain("- GSTR-3B (monthly) for Sep 2026: due in 3 days, on 20 Oct 2026");
    expect(text).toContain("please reply to this email with your sales bills, purchase bills, bank statement.");
  });
});
