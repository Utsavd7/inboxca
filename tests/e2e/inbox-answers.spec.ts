import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { test, expect, type Page } from "@playwright/test";
import { serverCrypto } from "@/src/lib/crypto";
import { appKey, connectTestMailbox, localSupabase, mailTexts, makeMailbox, pollFirmMail, query, runJobs, seedFirm, signIn, testSmtp as smtp } from "./local-supabase";

// Inbox, answered B and C end to end: a client asks whether a return is filed, which papers are
// still needed and what is due, and sends papers and a notice. With Ask me first (the default)
// each answer waits in the Inbox, built from the firm's records, for one click Send or Edit;
// Don't send stops it. With Auto each goes after its 5 minutes, and Undo stops it. Mail goes
// through the local GreenMail server. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 180_000 });

const tag = randomUUID().slice(0, 8);
const ownerEmail = `answers-owner-${tag}@example.test`;
const ownerKey = appKey();
const office = `answers-office-${tag}@firm.test`;
const code = `TA${tag.toUpperCase()}`;
const client = { name: `Answers Traders ${tag}`, email: `answers-${tag}@client.test`, id: "" };
const token = randomBytes(32).toString("base64url");
const day = (ahead: number) => new Date(Date.now() + ahead * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page;
const list = () => owner.getByRole("list", { name: "Emails" });
const pane = () => owner.getByRole("article", { name: "Open email" });
const replies = () => owner.locator("section[aria-labelledby=answers]");
const toast = (text: string) => owner.getByRole("status").filter({ hasText: text });
const open = async (subject: string) => {
  await list().getByRole("listitem").filter({ hasText: subject }).getByText(subject).click();
  await expect(pane().getByRole("heading", { name: subject })).toBeVisible();
};
// The client's five emails: three questions, papers and a notice.
const write = (round: string, bills: string) => Promise.all([
  smtp.sendMail({ from: client.email, to: office, subject: `Filed ${round}`, text: "Sir, is my GST return filed?" }),
  smtp.sendMail({ from: client.email, to: office, subject: `Papers ${round}`, text: "Which documents are still pending from my side?" }),
  smtp.sendMail({ from: client.email, to: office, subject: `Due ${round}`, text: "What is due this month?" }),
  smtp.sendMail({ from: client.email, to: office, subject: `Bills ${round}`, text: "Please find the September bills attached.", attachments: [{ filename: bills, content: `%PDF-1.4 invented ${bills}` }] }),
  smtp.sendMail({ from: client.email, to: office, subject: `Notice ${round}`, text: "Notice under section 148 of the Income-tax Act. DIN: ITBA/AST/F/148/2026-27/1050012345(1). Please respond on or before 24/12/2026." }),
]);

test.beforeAll(async ({ browser }) => {
  loadEnvConfig(process.cwd());
  firm = await seedFirm(`Answers Firm ${tag}`, ownerEmail, ownerKey);
  owner = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(owner, ownerEmail, ownerKey);
  await connectTestMailbox(owner, office);
  const drive = owner.locator("section#drive");
  await drive.getByLabel("Test drive on this computer").check();
  await drive.getByLabel(/I have read this and I agree/).check();
  await drive.getByRole("button", { name: "Connect drive" }).click();
  await expect(drive.getByRole("status")).toContainText("Connected:");
  await makeMailbox(client.email);
  await owner.goto("/app/clients?panel=add");
  await owner.getByLabel("Name", { exact: true }).fill(client.name);
  await owner.getByLabel("Email", { exact: true }).fill(client.email);
  await owner.getByRole("button", { name: "Add client" }).click();
  await expect(owner.locator(".page-head")).toContainText(client.name);
  client.id = new URL(owner.url()).pathname.split("/").at(-1)!;
  // September's GSTR-1, marked filed with its acknowledgement; an invented return due in 5 days
  // whose date a CA checked; and October's papers asked for, with the upload link.
  await query(local.dbUrl, "insert into public.compliance_types (code, name, frequency, due_rule, source_url, verified_on, approved_by) values ($1, 'Invented checked return', 'monthly', '{\"for\": \"pan\"}', 'https://example.test/notification', current_date, 'test')", [code]);
  await query(local.dbUrl, "insert into public.tasks (firm_id, client_id, code, period_key, due_on, status, details) values ($1, $2, 'GSTR1_M', '2026-09', $3, 'filed', $4), ($1, $2, $5, '2026-10', $6, 'upcoming', '{}')", [firm.firmId, client.id, day(-10), { filed_on: day(-12), ack: "AA2409261234567" }, code, day(5)]);
  const ask = randomUUID();
  await query(local.dbUrl, "insert into public.requests (id, firm_id, kind, client_id, entity_type, entity_id, expires_at, details) values ($1, $2, 'documents', $3, 'checklist', $1, now() + interval '30 days', $4)", [ask, firm.firmId, client.id, {
    period: "2026-10", items: [{ type: "Purchase bills", work: "gst", received: [] }, { type: "Sales bills", work: "gst", received: [] }],
    link_hash: createHash("sha256").update(token).digest("hex"), link_enc: await serverCrypto().encrypt(firm.firmId, `requests/${ask}/link`, token),
  }]);
});
test.afterAll(async () => {
  await firm.remove();
  await query(local.dbUrl, "delete from public.compliance_types where code = $1", [code]);
});

test("Ask me first: each answer waits in the Inbox, built from the records, for Send or Edit", async () => {
  await write(`one ${tag}`, "purchase_bills_sep_2026.pdf");
  await pollFirmMail(owner.request, firm.firmId);
  await runJobs(owner.request, firm.firmId);
  await owner.goto("/app/inbox");
  const row = (words: string) => replies().getByRole("listitem").filter({ hasText: words });
  await expect(replies().getByRole("listitem")).toHaveCount(5);
  for (const words of ["Says which returns are filed", "Lists the papers still needed", "Lists what is due", "Says which papers arrived", "Says the notice arrived"]) await expect(row(words)).toContainText(client.name);
  await owner.goto("/app/inbox?status=draft");
  await expect(list().getByRole("listitem")).toHaveCount(5);
  await expect(list().getByRole("listitem").first()).toContainText("Reply ready");
  expect(await mailTexts(client.email)).toEqual([]);

  // The open email shows InboxCA's reply; Send sends it as it reads.
  await open(`Filed one ${tag}`);
  const reply = pane().getByRole("region", { name: "InboxCA's reply" });
  await expect(reply.locator("pre")).toHaveText(new RegExp(`^Dear ${client.name},\\n\\nThank you for your email\\. As per our records:\\n- GSTR-1 \\(monthly\\) for Sep 2026: filed on \\d+ \\w+ \\d{4}, acknowledgement number AA2409261234567\\n\\nAnswers Firm ${tag}$`));
  await expect(reply).toContainText("acknowledgement number AA2409261234567");
  await owner.screenshot({ path: test.info().outputPath("ask-me-first.png") });
  await reply.getByRole("button", { name: "Send", exact: true }).click();
  await expect(toast("Sending the reply now.")).toBeVisible();
  await runJobs(owner.request, firm.firmId);
  await expect.poll(async () => (await mailTexts(client.email)).join("\n---\n")).toContain("- GSTR-1 (monthly) for Sep 2026: filed on ");

  // Edit puts it in the reply box, to change and send as the team's own reply.
  await owner.goto("/app/inbox");
  await row("Lists the papers still needed").getByRole("link", { name: "Edit" }).click();
  const box = pane().getByLabel("Your reply");
  await expect(box).toHaveValue(new RegExp(`We still need these papers for Oct 2026:\\n- Purchase bills\\n- Sales bills\\nUpload them here, no sign in needed: http\\S+/u/${token}`));
  await box.fill(`${await box.inputValue()}\n\nThe sales bills matter most.`);
  await pane().getByRole("button", { name: "Send reply" }).click();
  await expect(toast("Reply sent")).toBeVisible();

  // One click Send from the list, and Don't send for the notice's receipt.
  await owner.goto("/app/inbox");
  await row("Lists what is due").getByRole("button", { name: /^Send/ }).click();
  await expect(toast("Sending the reply now.")).toBeVisible();
  await row("Says which papers arrived").getByRole("button", { name: /^Send/ }).click();
  await expect(toast("Sending the reply now.")).toBeVisible();
  await owner.goto("/app/inbox?status=draft");
  await open(`Notice one ${tag}`);
  await expect(pane().getByRole("region", { name: "InboxCA's reply" })).toContainText("We received your notice. Your CA will look at it.");
  await expect(pane()).toContainText("InboxCA recorded the notice.");
  await pane().getByRole("button", { name: "Don't send" }).click();
  await expect(toast("Not sent.")).toBeVisible();
  await runJobs(owner.request, firm.firmId);
  await expect.poll(async () => (await mailTexts(client.email)).length).toBe(4);
  const texts = (await mailTexts(client.email)).join("\n---\n");
  expect(texts).toContain("The sales bills matter most.");
  expect(texts).toContain("As per our records, these are due:\n- Invented checked return for Oct 2026: due on ");
  expect(texts).toContain("Thank you. We received these papers:\n- Purchase bills: saved under GST, Sep 2026");
  expect(texts).not.toContain("We received your notice");

  // Each shows what happened, and each answer that went is logged with who sent it.
  await owner.goto("/app/inbox?status=answered");
  await expect(list().getByRole("listitem")).toHaveCount(3);
  await open(`Due one ${tag}`);
  await expect(pane()).toContainText("InboxCA told the client what is due.");
  await owner.goto("/app/inbox?status=replied");
  await expect(list().getByRole("listitem").filter({ hasText: `Papers one ${tag}` })).toBeVisible();
  const logged = await query(local.dbUrl, "select l.details ->> 'template' as template, l.actor_id is not null as by_person from public.activity_log l where l.firm_id = $1 and l.action = 'email.answered' order by l.details ->> 'template'", [firm.firmId]);
  expect(logged).toEqual([{ template: "due.en.1", by_person: true }, { template: "filed.en.1", by_person: true }, { template: "received.en.1", by_person: true }]);
});

test("Auto: each answer goes after its 5 minutes, and Undo stops it", async () => {
  await owner.goto("/app/settings?group=reminders");
  const card = owner.locator("section#answers");
  for (const label of ["Is my return filed", "Which papers are still needed", "What is due", "Papers received", "Notice received"]) {
    await expect(card.getByLabel(label)).toHaveValue("ask");
    await card.getByLabel(label).selectOption("auto");
  }
  await card.getByRole("button", { name: "Save replies" }).click();
  await expect(toast("Replies saved.")).toBeVisible();
  await card.screenshot({ path: test.info().outputPath("settings-replies.png") });
  const [{ settings }] = await query(local.dbUrl, "select settings from public.firms where id = $1", [firm.firmId]);
  expect(settings.answers).toEqual({ filed: "auto", papers: "auto", due: "auto", received: "auto", notice: "auto" });

  const before = (await mailTexts(client.email)).length;
  await write(`two ${tag}`, "sales_bills_sep_2026.pdf");
  await pollFirmMail(owner.request, firm.firmId);
  await runJobs(owner.request, firm.firmId);
  await owner.goto("/app/inbox");
  const row = (words: string) => replies().getByRole("listitem").filter({ hasText: words });
  await expect(replies().getByRole("listitem")).toHaveCount(5);
  await expect(row("Says which returns are filed")).toContainText("Goes at");
  expect((await mailTexts(client.email)).length).toBe(before);

  // Undo from the list: the question waits in Needs reply; the receipt is simply not sent.
  await row("Says which returns are filed").getByRole("button", { name: /^Undo/ }).click();
  await expect(toast("Not sent. The email waits in Needs reply.")).toBeVisible();
  await owner.goto("/app/inbox?status=queued");
  await open(`Notice two ${tag}`);
  await expect(pane().getByRole("region", { name: "InboxCA's reply" })).toContainText("Undo stops it.");
  await owner.screenshot({ path: test.info().outputPath("auto-undo.png") });
  await pane().getByRole("button", { name: "Undo" }).click();
  await expect(toast("Not sent.")).toBeVisible();
  await owner.goto("/app/inbox?status=reply");
  await open(`Filed two ${tag}`);
  await expect(pane()).toContainText("Asks if a return is filed");

  // The 5 minutes pass: the other three go by themselves.
  await query(local.dbUrl, "update public.jobs set run_at = now() where firm_id = $1 and kind = 'answer_mail' and state = 'pending'", [firm.firmId]);
  await runJobs(owner.request, firm.firmId);
  await expect.poll(async () => (await mailTexts(client.email)).length).toBe(before + 3);
  const texts = (await mailTexts(client.email)).slice(before).join("\n---\n");
  expect(texts).toContain("Upload them here, no sign in needed: http");
  expect(texts).toContain("- Sales bills: saved under GST, Sep 2026");
  expect(texts).not.toContain("We received your notice");
  expect(await query(local.dbUrl, "select state, count(*)::int as n from public.jobs where firm_id = $1 and kind = 'answer_mail' and state = 'cancelled' group by state", [firm.firmId])).toEqual([{ state: "cancelled", n: 2 }]);
  await owner.goto("/app/inbox?status=answered");
  await expect(list().getByRole("listitem")).toHaveCount(6);
  const stopped = await query(local.dbUrl, "select details ->> 'kind' as kind from public.activity_log where firm_id = $1 and action = 'email.answer_stopped' order by 1", [firm.firmId]);
  expect(stopped).toEqual([{ kind: "filed" }, { kind: "notice" }, { kind: "notice" }]);
});
