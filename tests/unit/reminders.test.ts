import { describe, expect, it } from "vitest";
import { followUpDue, planReminders, reminderEmail, type ReminderTask } from "@/src/lib/reminders";

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

  it("follows up a request every 3 days, up to 4 times, asking only for what is missing", () => {
    // Asked on 10 Oct (the link runs 30 days, to 9 Nov).
    const request = (followups: string[]) => ({ expires_at: "2026-11-09T00:00:00Z", details: { items: [{ type: "Sales bills", received: ["x"] }, { type: "Bank statement", received: [] }], followups } });
    expect(followUpDue(request([]), "2026-10-12")).toBeNull();
    expect(followUpDue(request([]), "2026-10-13")).toEqual(["Bank statement"]);
    expect(followUpDue(request(["2026-10-13"]), "2026-10-15")).toBeNull();
    expect(followUpDue(request(["2026-10-13", "2026-10-16", "2026-10-19", "2026-10-22"]), "2026-10-30")).toBeNull();
    const { subject, text } = reminderEmail("Patel Textiles", "Demo CA Firm", [], today, [
      { requestId: "r", client_id: "patel", period: "2026-09", missing: ["Bank statement"], link: "https://inboxca.test/u/abc", count: 1 },
    ]);
    expect(subject).toBe("Documents still needed");
    expect(text).toContain("We are still waiting for these documents for Sep 2026: Bank statement.");
    expect(text).toContain("https://inboxca.test/u/abc");
  });
});

// M5 acceptance: a wrong date, form, period or amount cannot replace the records.
it("uses the template for an unchecked draft, with AI writing off", async () => {
  const { checkedReminder } = await import("@/src/lib/reminders");
  const template = reminderEmail("Invented Textiles", "Test Firm", [task({ id: "a" })], today);
  expect(checkedReminder(template, template)).toBe(template);
  for (const draft of [
    { ...template, text: template.text.replace("20 Oct 2026", "21 Oct 2026") },
    { ...template, text: template.text.replace("GSTR-3B", "GSTR-1") },
    { ...template, text: template.text.replace("Sep 2026", "Aug 2026") },
    { ...template, text: template.text + "\nPay Rs 1,23,456." },
    { ...template, text: template.text + "\nYou owe two lakh rupees." },
  ]) expect(checkedReminder(draft, template)).toBe(template);
});

it("uses the firm's chosen stages, including none, with the current stages as default", async () => {
  const { reminderStages, STAGES } = await import("@/src/lib/reminders");
  expect(reminderStages({})).toEqual(STAGES);
  expect(reminderStages({ reminder_stages: [3, 999] })).toEqual([3]);
  expect(planReminders([task({ id: "a" })], today, new Set(), new Set(), [1]).send.size).toBe(0);
  expect(planReminders([task({ id: "a" })], today, new Set(), new Set(), []).send.size).toBe(0);
});
