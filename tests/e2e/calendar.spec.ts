import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { appKey, connectTestMailbox, localSupabase, mailTexts, makeMailbox, query, runJobs, seedFirm, signIn } from "./local-supabase";

// The Calendar's daily steps: a return marked filed and undone from the toast, Mark in
// progress, filed returns put back one by one or together, and Remind client: one email from
// the firm's mailbox on the local GreenMail server, which Undo stops in time. Skipped when
// local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `calendar-owner-${tag}@example.test`;
const ownerKey = appKey();
const office = `calendar-office-${tag}@firm.test`;
const clientEmail = `calendar-client-${tag}@patel.test`;
const clientName = `Calendar Client ${tag}`;
const code = `CL${tag.toUpperCase()}`;
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
let clientId = "";
const tasks: Record<string, string> = {};
const status = async (period: string) => (await query(local.dbUrl, "select status from public.tasks where id = $1", [tasks[period]]))[0].status;
const row = (period: string) => owner.getByRole("row").filter({ hasText: period });
const toast = (text: string) => owner.getByRole("status").filter({ hasText: text });
const calendar = (view: string) => owner.goto(`/app/calendar?view=${view}&code=${code}`);

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Calendar Firm ${tag}`, ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, ownerKey);
  await connectTestMailbox(owner, office);
  await makeMailbox(clientEmail);
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(clientName);
  await owner.getByLabel("Email", { exact: true }).fill(clientEmail);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(clientName);
  clientId = owner.url().split("/").at(-1)!;
  // An invented return type whose dates a CA confirmed, due in 3 and 5 days.
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, 'Calendar test return', 'monthly', '{\"for\": \"pan\"}', 'https://example.test/notification', current_date, 'test')", [code]);
  for (const [period, key, days] of [["Sep 2026", "2026-09", 3], ["Aug 2026", "2026-08", 5]] as const)
    [{ id: tasks[period] }] = await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, $4, (now() at time zone 'Asia/Kolkata')::date + $5::int) returning id", [firm.firmId, clientId, code, key, days]);
});
test.afterAll(async () => {
  await firm.remove();
  await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);
});

test("a return marked filed from its row is put back by the toast's Undo", async () => {
  await calendar("month");
  await row("Sep 2026").getByRole("link", { name: `Mark ${clientName} Calendar test return filed` }).click();
  const panel = owner.getByRole("dialog", { name: "Mark filed" });
  await panel.getByLabel(/ARN for/).fill("AA2409261234567");
  await panel.getByRole("button", { name: "Mark filed" }).click();
  await expect.poll(async () => (await query(local.dbUrl, "select status, details->>'ack' as ack from public.tasks where id = $1", [tasks["Sep 2026"]]))[0]).toEqual({ status: "filed", ack: "AA2409261234567" });
  // The toast, and its Undo, stays five seconds.
  await toast("1 return marked filed.").getByRole("button", { name: "Undo" }).click();
  await expect(toast("1 return marked not filed.")).toBeVisible();
  await expect(row("Sep 2026")).toContainText("Upcoming");
  expect(await status("Sep 2026")).toBe("upcoming");
});

test("Mark in progress from the panel; filed returns come back one by their row and the rest chosen together", async () => {
  await calendar("month");
  await row("Aug 2026").getByRole("link", { name: `Mark ${clientName} Calendar test return filed` }).click();
  await owner.getByRole("dialog", { name: "Mark filed" }).getByRole("button", { name: "Mark in progress" }).click();
  await expect(toast("1 return marked in progress.")).toBeVisible();
  await expect(row("Aug 2026")).toContainText("In progress");
  expect(await status("Aug 2026")).toBe("in_progress");

  for (const period of ["Sep 2026", "Aug 2026"]) await row(period).getByRole("checkbox").check();
  await owner.getByRole("button", { name: "Mark chosen as filed" }).click();
  await owner.getByRole("dialog", { name: "Mark 2 returns filed" }).getByRole("button", { name: "Mark filed" }).click();
  await expect(toast("2 returns marked filed.")).toBeVisible();

  await calendar("filed");
  await row("Sep 2026").getByRole("button", { name: `Mark ${clientName} Calendar test return not filed` }).click();
  await expect(toast("1 return marked not filed.")).toBeVisible();
  await expect(row("Sep 2026")).toHaveCount(0);
  await row("Aug 2026").getByRole("checkbox").check();
  await owner.getByRole("button", { name: "Mark chosen as not filed" }).click();
  await expect(toast("1 return marked not filed.")).toBeVisible();
  await expect(row("Aug 2026")).toHaveCount(0);
  expect([await status("Sep 2026"), await status("Aug 2026")]).toEqual(["upcoming", "upcoming"]);
});

test("Remind client sends one email from the firm's mailbox, and Undo stops it in time", async () => {
  const remind = async () => {
    await calendar("month");
    await row("Sep 2026").getByRole("link", { name: `Remind ${clientName}` }).click();
    const panel = owner.getByRole("dialog", { name: `Remind ${clientName}` });
    await expect(panel.getByRole("listitem").filter({ hasText: "In the email" })).toHaveCount(2);
    await panel.getByRole("button", { name: "Send reminder" }).click();
    await expect(toast("The reminder goes out from your firm email in about 20 seconds")).toBeVisible();
  };
  const job = "select state from public.jobs where firm_id = $1 and kind = 'reminders' and entity_type = 'client' and entity_id = $2 order by id";
  await remind();
  await toast("The reminder goes out from your firm email in about 20 seconds").getByRole("button", { name: "Undo" }).click();
  await expect(toast("Stopped. Nothing was sent.")).toBeVisible();
  expect(await query(local.dbUrl, job, [firm.firmId, clientId])).toEqual([{ state: "cancelled" }]);

  await remind();
  // It waits 20 seconds for Undo; the test lets it go now.
  await query(local.dbUrl, "update public.jobs set run_at = now() where firm_id = $1 and kind = 'reminders' and state = 'pending'", [firm.firmId]);
  await runJobs(owner.request, firm.firmId);
  expect(await query(local.dbUrl, job, [firm.firmId, clientId])).toEqual([{ state: "cancelled" }, { state: "done" }]);
  const sent = await mailTexts(clientEmail);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("- Calendar test return for Sep 2026: due in 3 days");
  expect(sent[0]).toContain("- Calendar test return for Aug 2026: due in 5 days");

  // One reminder a client a day.
  await calendar("month");
  await row("Sep 2026").getByRole("link", { name: `Remind ${clientName}` }).click();
  const panel = owner.getByRole("dialog", { name: `Remind ${clientName}` });
  await expect(panel.getByRole("alert")).toContainText("already reminded today");
  await expect(panel.getByRole("button", { name: "Send reminder" })).toBeDisabled();
});
