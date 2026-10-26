import { describe, expect, it } from "vitest";
import { askDays, followUpDue, papersFor, planAsks, planReminders, reminderEmail, type ReminderTask } from "@/src/lib/reminders";
import { kindChecklists } from "@/src/lib/checklists";

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
    const request = (followups: string[]) => ({ expires_at: "2026-11-09T00:00:00Z", details: { items: [{ type: "Sales bills", received: ["x"] }, { type: "Purchase bills", received: ["y"] }, { type: "Bank statement", received: [] }], followups } });
    expect(followUpDue(request([]), "2026-10-12")).toBeNull();
    expect(followUpDue(request([]), "2026-10-13")).toEqual(["Bank statement"]);
    expect(followUpDue(request(["2026-10-13"]), "2026-10-15")).toBeNull();
    // Chase missing papers on Today asks again at once, still at most four times.
    expect(followUpDue(request(["2026-10-13"]), "2026-10-15", true)).toEqual(["Bank statement"]);
    expect(followUpDue(request(["2026-10-13", "2026-10-16", "2026-10-19", "2026-10-22"]), "2026-10-23", true)).toBeNull();
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

// Ask early (user, 26 Oct 2026): InboxCA asks for a return's papers itself, N days before.
describe("asking for papers early", () => {
  const days = askDays({});
  const listFor = (kind: string, work: Parameters<typeof papersFor>[1]) => papersFor(kindChecklists[kind as keyof typeof kindChecklists], work);
  const gst = (overrides: Partial<ReminderTask> & { id: string }) => ({ ...task({ code: "GSTR1_M", period_key: "2026-10", due_on: "2026-11-11", rule: { name: "GSTR-1 (monthly)", frequency: "monthly", verified: true }, ...overrides }), kind: "business" });
  const plan = (tasks: ReturnType<typeof gst>[], on: string, taken = new Set<string>(), received = new Set<string>()) => planAsks(tasks, on, days, listFor, taken, received);

  it("asks 10 days before a monthly return, 15 before a quarterly and 45 before a yearly, up to the due date", () => {
    expect(days).toEqual({ monthly: 10, quarterly: 15, yearly: 45 });
    expect(plan([gst({ id: "a" })], "2026-10-31")).toEqual([]);
    expect(plan([gst({ id: "a" })], "2026-11-01")).toHaveLength(1);
    expect(plan([gst({ id: "a" })], "2026-11-11")).toHaveLength(1);
    expect(plan([gst({ id: "a" })], "2026-11-12")).toEqual([]);
    const quarterly = gst({ id: "q", code: "GSTR1_Q", period_key: "2026-12", due_on: "2027-01-13", rule: { name: "GSTR-1 (QRMP)", frequency: "quarterly", verified: true } });
    expect(plan([quarterly], "2026-12-28")).toEqual([]);
    expect(plan([quarterly], "2026-12-29")).toHaveLength(1);
    const itr = { ...gst({ id: "y", code: "ITR_NA", period_key: "2027-03", due_on: "2027-07-31", rule: { name: "ITR (no business, no audit)", frequency: "yearly", verified: true } }), kind: "individual" };
    expect(plan([itr], "2027-06-15")).toEqual([]);
    const [ask] = plan([itr], "2027-06-16");
    // The year's papers are for FY 2026-27, from the list for individuals, never the portal's own files.
    expect(ask).toEqual({ client_id: "patel", work: "income_tax", period: "2027", returns: ["ITR_NA"], items: ["Form 16", "Bank statement", "Interest certificate", "Investment proofs", "Rent receipts", "Capital gains statement"] });
    expect(planAsks([gst({ id: "a" })], "2026-11-05", askDays({ ask_days: { monthly: 0 } }), listFor, new Set(), new Set())).toEqual([]);
  });

  it("opens one request a client, work and period, for confirmed dates of clients with an email and reminders on", () => {
    const [ask, ...others] = plan([gst({ id: "a" }), gst({ id: "b", code: "GSTR3B_M", due_on: "2026-11-20", rule: { name: "GSTR-3B (monthly)", frequency: "monthly", verified: true } })], "2026-11-02");
    expect(others).toEqual([]);
    expect(ask).toEqual({ client_id: "patel", work: "gst", period: "2026-10", returns: ["GSTR1_M", "GSTR3B_M"], items: ["Sales bills", "Purchase bills", "Bank statement"] });
    expect(plan([gst({ id: "a" })], "2026-11-02", new Set(["patel:gst:2026-10"]))).toEqual([]);
    for (const skipped of [
      gst({ id: "u", rule: { name: "GSTR-1 (monthly)", frequency: "monthly", verified: false } }),
      gst({ id: "p", client: { paused: true, hasEmail: true } }),
      gst({ id: "e", client: { paused: false, hasEmail: false } }),
      gst({ id: "t", code: "ADV_TAX", rule: { name: "Advance tax instalment", frequency: "quarterly", verified: true } }),
      gst({ id: "d", code: "DIR3KYC", rule: { name: "DIR-3 KYC", frequency: "monthly", verified: true } }),
    ])
      expect(plan([skipped], "2026-11-02")).toEqual([]);
  });

  it("asks only for what is not already in for the period, and nothing when every paper is", () => {
    const received = new Set(["patel:2026-10:SALESBILLS", "patel:2026-09:PURCHASEBILLS"]);
    expect(plan([gst({ id: "a" })], "2026-11-02", new Set(), received)[0].items).toEqual(["Purchase bills", "Bank statement"]);
    expect(plan([gst({ id: "a" })], "2026-11-02", new Set(), new Set([...received, "patel:2026-10:PURCHASEBILLS", "patel:2026-10:BANKSTATEMENT"]))).toEqual([]);
    // A firm's own list for the kind of client is kept to the return's work.
    expect(papersFor(["Purchase bills", "Loan statement", "GSTR-2B"], "gst")).toEqual(["Purchase bills"]);
    expect(papersFor(["Trust deed"], "gst")).toEqual(["Sales bills", "Purchase bills", "Bank statement"]);
  });

  it("emails InboxCA's own ask at once, then follows up 3 days after the latest ask, a call included", () => {
    const request = (details: object) => ({ expires_at: "2026-12-02T00:00:00Z", details: { items: [{ type: "Sales bills", received: [] }], returns: ["GSTR1_M"], ...details } });
    expect(followUpDue(request({}), "2026-11-02")).toEqual(["Sales bills"]);
    expect(followUpDue(request({ since: "2026-11-02" }), "2026-11-04")).toBeNull();
    expect(followUpDue(request({ since: "2026-11-02" }), "2026-11-05")).toEqual(["Sales bills"]);
    expect(followUpDue(request({ since: "2026-11-02", followups: ["2026-11-05", "2026-11-08"], chased: "2026-11-09" }), "2026-11-11")).toBeNull();
    expect(followUpDue(request({ since: "2026-11-02", followups: ["2026-11-05", "2026-11-08"], chased: "2026-11-09" }), "2026-11-12")).toEqual(["Sales bills"]);
    const { subject, text } = reminderEmail("Patel Textiles", "Demo CA Firm", [], "2026-11-02", [
      { requestId: "r", client_id: "patel", period: "2026-10", missing: ["Sales bills", "Bank statement"], link: "https://inboxca.test/u/abc", count: 0, first: true, returns: ["GSTR-1 (monthly)", "GSTR-3B (monthly)"] },
    ]);
    expect(subject).toBe("Documents needed");
    expect(text).toContain("To prepare your GSTR-1 (monthly) and GSTR-3B (monthly) for Oct 2026, please send these documents: Sales bills, Bank statement.");
    expect(text).toContain("https://inboxca.test/u/abc");
  });
});
