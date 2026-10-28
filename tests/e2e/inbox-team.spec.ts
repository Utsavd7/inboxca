import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { simpleParser } from "mailparser";
import { ImapFlow } from "imapflow";
import { loadEnvConfig } from "@next/env";
import { serverCrypto } from "@/src/lib/crypto";
import { addPerson, appKey, connectTestMailbox, localSupabase, mailTexts, pollFirmMail, query, runJobs, seedFirm, signIn, testSmtp as smtp } from "./local-supabase";

// The emails InboxCA cannot answer go to a person (PLAN.md "Inbox, answered" E): each is for the
// client's assigned person, opens with a reply suggested by why it waits, takes a paper from the
// drive in two clicks, shows how long it has waited (red after the firm's reply time), and the
// owner gets a 09:00 list of what waited over a day. The mail goes through the local GreenMail
// server. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `team-owner-${tag}@example.test`;
const staffEmail = `anita-${tag}@example.test`;
const ownerKey = appKey();
const office = `team-office-${tag}@firm.test`;
const firmName = `Team Firm ${tag}`;
const client = { name: `Mehta Traders ${tag}`, email: `mehta-${tag}@mehta.test`, id: "" };
const paper = "Mehta ITR-V FY 2025-26.pdf";
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
const list = () => owner.getByRole("list", { name: "Emails" });
const pane = () => owner.getByRole("article", { name: "Open email" });
const row = (subject: string) => list().getByRole("listitem").filter({ hasText: subject });

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(firmName, ownerEmail, ownerKey);
  owner = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(owner, ownerEmail, ownerKey);
  await connectTestMailbox(owner, office);
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(client.name);
  await owner.getByLabel("Email", { exact: true }).fill(client.email);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(client.name);
  client.id = new URL(owner.url()).pathname.split("/").at(-1)!;
  // Anita looks after the client; the drive holds this year's ITR-V.
  const anita = await addPerson(firm.firmId, staffEmail, "staff", appKey());
  await query(local.dbUrl, "insert into public.client_assignments (firm_id, client_id, user_id, role) values ($1, $2, $3, 'staff')", [firm.firmId, client.id, anita]);
  await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, drive_file_id, name, size, sha256) values ($1, $2, 'income_tax', 'ITR-V', '2026', $3, $4, 1, $5)", [firm.firmId, client.id, `nowhere-${randomUUID()}`, paper, randomUUID()]);
});
test.afterAll(() => firm.remove(staffEmail));

test("each email waiting for a person is for the client's person, with a reply suggested by why it waits", async () => {
  await smtp.sendMail({ from: client.email, to: office, subject: `Bank loan ${tag}`, text: "Sir, the bank wants our income tax papers for the loan. What can you send them?" });
  await smtp.sendMail({ from: client.email, to: office, subject: `Old ITR ${tag}`, text: "Please send my ITR for FY 2023-24." });
  await pollFirmMail(owner.request, firm.firmId);
  await runJobs(owner.request, firm.firmId);

  await owner.goto("/app/inbox?show=reply");
  await expect(row(`Bank loan ${tag}`)).toContainText("For Anita");
  await expect(row(`Old ITR ${tag}`)).toContainText("For Anita");
  // Who it is for comes from the client's people; nothing is kept until someone changes it.
  expect(await query(local.dbUrl, "select reason_code, details from public.requests where firm_id = $1 and kind = 'team_reply' order by reason_code", [firm.firmId])).toEqual([{ reason_code: "no_rule", details: {} }, { reason_code: "record_not_found", details: {} }]);

  // A paper not in the drive: the reply says so in plain words, and Ask for papers is one click away.
  await row(`Old ITR ${tag}`).getByText(`Old ITR ${tag}`).click();
  await expect(pane().getByRole("heading", { name: `Old ITR ${tag}` })).toBeVisible();
  await pane().getByRole("button", { name: /^Reply to/ }).click();
  await expect(pane().getByLabel(/^For Anita/)).toBeVisible();
  await expect(owner.getByLabel("Your reply")).toHaveValue(`Dear ${client.name},\n\nThank you for your email. We could not find the ITR-V for FY 2023-24 in our records just now. We will look for it and send it to you as soon as we have it.\n\nRegards,\n${firmName}`);
  await expect(pane().getByRole("link", { name: "Ask for papers" })).toHaveAttribute("href", `/app/clients/${client.id}?tab=documents&ask=1`);
  // A quick reply still takes the suggested one's place, and Esc still closes an unchanged one.
  await pane().getByRole("group", { name: "Quick replies" }).getByRole("button", { name: "We will call you" }).click();
  await expect(owner.getByLabel("Your reply")).toHaveValue(new RegExp(`^Dear ${client.name},\\n\\nThank you for your email. Someone from our team will call you`));

  await owner.goto(`/app/inbox?show=reply`);
  await row(`Bank loan ${tag}`).getByText(`Bank loan ${tag}`).click();
  await expect(owner.getByLabel("Your reply")).toHaveValue(`Dear ${client.name},\n\nThank you for your email. We are looking into it and will get back to you soon.\n\nRegards,\n${firmName}`);
  await expect(pane().getByRole("link", { name: "Ask for papers" })).toHaveCount(0);
  await owner.locator("body").click({ position: { x: 1, y: 1 } });
  await expect(async () => {
    await owner.keyboard.press("Escape");
    await expect(owner).not.toHaveURL(/mail=/, { timeout: 1000 });
  }).toPass();
});

test("how long an email has waited shows on it, red after the firm's reply time, and the owner's 09:00 list names it", async () => {
  await query(local.dbUrl, "update public.email_events set received_at = now() - interval '3 days' where firm_id = $1 and reason_code = 'no_rule'", [firm.firmId]);
  const waiting = () => row(`Bank loan ${tag}`).locator(".badge", { hasText: "Waiting 3 days" });
  for (const [days, late] of [["5 working days", false], ["1 working day", true]] as const) {
    await owner.goto("/app/settings?group=email");
    const card = owner.locator("section#replies");
    await card.getByLabel("Late after").selectOption({ label: days });
    await card.getByRole("button", { name: "Save reply time" }).click();
    await expect(owner.getByRole("status").filter({ hasText: "Reply time saved." })).toBeVisible();
    await owner.goto("/app/inbox?show=reply");
    await expect(waiting()).toBeVisible();
    await expect(waiting()).toHaveClass(late ? /\blate\b/ : /^(?!.*\blate\b)/);
  }
  await expect(row(`Old ITR ${tag}`).locator(".badge", { hasText: /^Waiting/ })).toHaveCount(0);
  expect((await query(local.dbUrl, "select settings from public.firms where id = $1", [firm.firmId]))[0].settings).toMatchObject({ reply_days: 1, reply_list: true });

  // 09:00: the owner's list, from the firm's own mailbox, by person, of what waited over a day.
  await query(local.dbUrl, "insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key) values ($1, 'reply_waiting', 'firm', $1, $2)", [firm.firmId, `reply_waiting:test:${randomUUID()}`]);
  await runJobs(owner.request, firm.firmId);
  const morning = (await mailTexts(ownerEmail)).find((text) => text.includes("waited more than a day"));
  expect(morning).toContain("1 client email has waited more than a day for a reply.");
  expect(morning).toContain(`Anita, 1:\n- ${client.name}, waiting 3 days, late`);
  expect(morning).not.toContain("Old ITR");
  expect(await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'replies.waiting_sent'", [firm.firmId])).toEqual([{ details: { emails: 1, people: 1, from: "firm" } }]);
});

test("the suggested reply goes with a paper from the client's folder, picked in two clicks", async () => {
  await owner.goto("/app/inbox?show=reply");
  await row(`Bank loan ${tag}`).getByText(`Bank loan ${tag}`).click();
  await expect(pane().locator(".ib-head .badge.late", { hasText: "Waiting 3 days" })).toBeVisible();
  // The person adds a line to the suggested reply and picks the paper: open the list, pick it.
  await pane().getByRole("button", { name: /^Reply to/ }).click();
  const reply = owner.getByLabel("Your reply");
  await reply.fill((await reply.inputValue()).replace("will get back to you soon.", "will get back to you soon. This year's ITR-V is attached for the bank."));
  await pane().getByLabel("Add a paper from the drive").selectOption({ label: paper });
  await expect(pane().locator(".ib-chip.on", { hasText: paper })).toBeVisible();
  await owner.getByRole("button", { name: "Send reply" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Reply sent" })).toBeVisible();

  const received = await (async () => {
    const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: client.email, pass: client.email }, logger: false });
    await imap.connect();
    try {
      await imap.mailboxOpen("INBOX");
      const all = [];
      for await (const message of imap.fetch("1:*", { source: true })) all.push(await simpleParser(message.source ?? ""));
      return all;
    } finally { await imap.logout(); }
  })();
  const answer = received.find((message) => message.subject === `Re: Bank loan ${tag}`);
  expect(answer?.text).toContain("We are looking into it and will get back to you soon. This year's ITR-V is attached for the bank.");
  expect(answer?.text).toContain(`Regards,\n${firmName}`);
  expect(received.find((message) => message.subject?.includes("ITR-V"))?.text).toContain("/s/");
  const [{ id: document }] = await query(local.dbUrl, "select id from public.documents where firm_id = $1", [firm.firmId]);
  expect(await query(local.dbUrl, "select details from public.activity_log where firm_id = $1 and action = 'email.replied'", [firm.firmId])).toEqual([{ details: { files: 0, papers: [document] } }]);
  await expect(row(`Bank loan ${tag}`)).toContainText("Answered by your team");
});

test("AI's draft waits in the reply box, goes only when a person sends it, and is then removed", async () => {
  await smtp.sendMail({ from: client.email, to: office, subject: `Diwali ${tag}`, text: "Happy Diwali to the whole team!" });
  await pollFirmMail(owner.request, firm.firmId);
  await runJobs(owner.request, firm.firmId);
  // The test server has no AI key: its job for the email ended without asking anyone. The draft
  // is sealed here with the firm's key, as the job seals it.
  const [ask] = await query(local.dbUrl, "select r.id, j.state from public.requests r join public.email_events e on e.id = r.entity_id join public.jobs j on j.idempotency_key = 'ai_draft:' || r.id || ':' || r.client_id where r.firm_id = $1 and r.status = 'pending' order by e.received_at desc limit 1", [firm.firmId]);
  expect(ask.state).toBe("done");
  loadEnvConfig(process.cwd());
  const draft = `Dear ${client.name},\n\nThank you for your wishes. Happy Diwali to you and your family from all of us.\n\nRegards,\n${firmName}`;
  await query(local.dbUrl, "update public.requests set draft_enc = $2 where id = $1", [ask.id, await serverCrypto().encrypt(firm.firmId, `requests/${ask.id}/draft`, JSON.stringify({ text: draft, papers: [] }))]);

  await owner.goto("/app/inbox?show=reply");
  // The row says a draft is ready before the email is opened.
  await expect(row(`Diwali ${tag}`).getByText("AI draft ready")).toBeVisible();
  await row(`Diwali ${tag}`).getByText(`Diwali ${tag}`).click();
  await expect(owner.getByLabel("Your reply")).toHaveValue(draft);
  expect((await mailTexts(client.email)).some((text) => text.includes("Thank you for your wishes"))).toBe(false);
  await owner.getByRole("button", { name: "Send reply" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Reply sent" })).toBeVisible();
  expect((await mailTexts(client.email)).filter((text) => text.includes("Thank you for your wishes"))).toHaveLength(1);
  expect(await query(local.dbUrl, "select status, draft_enc from public.requests where id = $1", [ask.id])).toEqual([{ status: "done", draft_enc: null }]);
});
