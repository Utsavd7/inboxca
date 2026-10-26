import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { appKey, connectTestMailbox, localSupabase, mailTexts, makeMailbox, query, runJobs, seedFirm, signIn } from "./local-supabase";

// The full list's sends (/app/work), each previewed first, with an Undo before it goes: Remind
// all late clients, and Remind about missing papers after the client was asked for them. The
// mail goes from the firm's mailbox on the local GreenMail server. Skipped when local Supabase
// is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 90_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `today-owner-${tag}@example.test`;
const ownerKey = appKey();
const office = `today-office-${tag}@firm.test`;
const code = `TD${tag.toUpperCase()}`;
const late = { name: `Late Client ${tag}`, email: `late-${tag}@patel.test`, id: "" };
const papers = { name: `Papers Client ${tag}`, email: `papers-${tag}@patel.test`, id: "" };
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
const toast = (text: string) => owner.getByRole("status").filter({ hasText: text });
const states = async () => (await query(local.dbUrl, "select state from public.jobs where firm_id = $1 and kind = 'reminders' order by id", [firm.firmId])).map((row) => row.state);
// A send waits 20 seconds for Undo; the test lets it go now.
const goNow = async () => {
  await query(local.dbUrl, "update public.jobs set run_at = now() where firm_id = $1 and kind = 'reminders' and state = 'pending'", [firm.firmId]);
  await runJobs(owner.request, firm.firmId);
};

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Today Firm ${tag}`, ownerEmail, ownerKey);
  owner = await (await browser.newContext()).newPage();
  await signIn(owner, ownerEmail, ownerKey);
  await connectTestMailbox(owner, office);
  for (const client of [late, papers]) {
    await makeMailbox(client.email);
    await owner.goto("/app/clients?panel=add");
    await owner.getByLabel("Name", { exact: true }).fill(client.name);
    await owner.getByLabel("Email", { exact: true }).fill(client.email);
    await owner.getByRole("button", { name: "Add client" }).click();
    await expect(owner.locator(".page-head")).toContainText(client.name);
    client.id = owner.url().split("/").at(-1)!;
  }
  // An invented return type whose date a CA confirmed, two days late for one client.
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, 'Today test return', 'monthly', '{\"for\": \"pan\"}', 'https://example.test/notification', current_date, 'test')", [code]);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on) values ($1, $2, $3, '2026-09', (now() at time zone 'Asia/Kolkata')::date - 2)", [firm.firmId, late.id, code]);
});
test.afterAll(async () => {
  await firm.remove();
  await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);
});

test("Remind all late clients: a preview, Undo before it goes, then one email listing the late returns", async () => {
  const remind = async () => {
    await owner.goto("/app/work?show=late");
    await owner.getByRole("link", { name: "Remind all late clients" }).click();
    const preview = owner.getByRole("dialog", { name: "Remind 1 late client" });
    await expect(preview.getByRole("listitem").filter({ hasText: late.name })).toContainText("Will be emailed");
    await preview.getByRole("button", { name: "Send 1 reminder" }).click();
    await expect(toast("Reminders go out in a minute")).toBeVisible();
  };
  await remind();
  await toast("Reminders go out in a minute").getByRole("button", { name: "Undo" }).click();
  await expect(toast("Stopped. Nothing was sent.")).toBeVisible();
  expect(await states()).toEqual(["cancelled"]);

  await remind();
  await goNow();
  expect(await states()).toEqual(["cancelled", "done"]);
  const sent = await mailTexts(late.email);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain(`Dear ${late.name},`);
  expect(sent[0]).toContain("- Today test return for Sep 2026: due 2 days ago");
  expect(await query(local.dbUrl, "select 1 from public.activity_log where entity_id = $1 and action = 'reminder.sent'", [late.id])).toHaveLength(1);
  expect(await mailTexts(papers.email)).toEqual([]);
});

test("Remind about missing papers emails the client's upload link again, naming what is still missing", async () => {
  await owner.goto(`/app/clients/${papers.id}?tab=files&ask=1`);
  await owner.getByRole("group", { name: "Papers" }).getByRole("checkbox", { name: "Bank statement" }).check();
  await owner.getByLabel("Anything else, by name").fill("Rent receipts");
  await owner.getByRole("button", { name: "Ask for papers" }).click();
  await expect(owner.getByRole("status")).toContainText("emailed a private upload link");
  await expect.poll(async () => (await mailTexts(papers.email)).length).toBe(1);
  const link = (await mailTexts(papers.email))[0].match(/http\S+\/u\/[\w-]+/)![0];

  await owner.goto("/app/work?show=papers");
  await owner.getByRole("link", { name: "Remind about missing papers" }).click();
  const preview = owner.getByRole("dialog", { name: "Remind about missing papers" });
  await expect(preview.getByRole("listitem").filter({ hasText: papers.name })).toContainText("Bank statement, Rent receipts");
  await preview.getByRole("button", { name: "Send 1 reminder" }).click();
  await expect(toast("Reminders go out in a minute")).toBeVisible();
  await goNow();
  const [, followUp] = await mailTexts(papers.email);
  expect(followUp).toContain("Bank statement");
  expect(followUp).toContain("Rent receipts");
  expect(followUp).toContain(link);
  const [{ details }] = await query(local.dbUrl, "select details from public.requests where firm_id = $1 and kind = 'documents'", [firm.firmId]);
  expect(details.followups).toHaveLength(1);
});
