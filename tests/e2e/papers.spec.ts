import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { TEST_DRIVE } from "../../playwright.config";
import { pdf } from "../fixtures/pdf";
import { actionFields, addPerson, appKey, connectTestMailbox, localSupabase, makeMailbox, query, seedFirm, signIn } from "./local-supabase";

// Filed papers going to clients, and the questions around them (PLAN.md 5.10, 5.5.2, 5.17.2):
// papers chosen in Documents go from the firm's mailbox (the local GreenMail server) as secure
// links, a waiting private paper is not sent, and staff ask to send, remove or download, each
// answered by the right person and logged. Skipped when local Supabase is not running.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase: npx supabase start, then npm run db:env");
test.describe.configure({ mode: "serial", timeout: 120_000 });

const tag = randomUUID().slice(0, 8);
const key = appKey();
const ownerEmail = `papers-owner-${tag}@example.test`;
// The Inbox names people by their email: Meena manages Sunil's team.
const managerEmail = `meena-${tag}@example.test`;
const staffEmail = `sunil-${tag}@example.test`;
const office = `papers-office-${tag}@firm.test`;
const routine = { name: `Routine Client ${tag}`, email: `routine-${tag}@patel.test`, id: "" };
const secret = { name: `Private Client ${tag}`, email: `private-${tag}@patel.test`, id: "" };
const unreachable = { name: `No Address Client ${tag}`, id: "" };
let firm: Awaited<ReturnType<typeof seedFirm>>;
let owner: Page, manager: Page, staff: Page;
let staffId = "", managerId = "";
const files: string[] = [];
const paper = (name: string) => ({ name, id: "" });
const itr = paper(`${routine.name} - ITR-V - FY 2025-26.pdf`);
const balance = paper(`${secret.name} - Balance sheet - FY 2025-26.pdf`);
const noAddress = paper(`${unreachable.name} - ITR-V - FY 2025-26.pdf`);
const unchecked = paper(`${routine.name} - Bank statement.pdf`);
const kept = paper(`${routine.name} - Working papers.pdf`);
const rent = paper(`${routine.name} - Rent receipts.pdf`);

// The newest email to an address on GreenMail, or null.
async function lastMail(address: string) {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  try {
    await imap.connect();
    await imap.mailboxOpen("INBOX");
    const message = await imap.fetchOne("*", { source: true });
    return message && message.source ? await simpleParser(message.source) : null;
  } finally {
    await imap.logout().catch(() => {});
  }
}
const mailCount = async (address: string) => {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
  await imap.connect();
  try {
    return (await imap.mailboxOpen("INBOX")).exists;
  } finally {
    await imap.logout();
  }
};
const logged = async (action: string) => (await query(local.dbUrl, "select actor_id, entity_id, details from public.activity_log where firm_id = $1 and action = $2 order by at", [firm.firmId, action]));
const status = async (request: string) => (await query(local.dbUrl, "select status from public.requests where id = $1", [request]))[0].status;
// The newest question Sunil asked, for a right.
const asked = async (right: string) => (await query(local.dbUrl, "select id, details from public.requests where firm_id = $1 and kind = 'permission' and reason_code = $2 order by expires_at desc limit 1", [firm.firmId, right]))[0];
const panelOf = (client: { id: string }, file: { id: string }) => `/app/clients/${client.id}?tab=documents&edit=${file.id}`;
const answer = async (page: Page, what: string) => {
  await page.goto("/app/inbox");
  await page.locator("section[aria-labelledby=questions] li").filter({ hasText: `Sunil asks to ${what}` }).getByRole("link", { name: "Answer Sunil" }).click();
  return page.getByRole("dialog", { name: new RegExp(`^Sunil asks to ${what}`) });
};

test.beforeAll(async ({ browser }) => {
  firm = await seedFirm(`Papers Firm ${tag}`, ownerEmail, key);
  managerId = await addPerson(firm.firmId, managerEmail, "manager", key);
  staffId = await addPerson(firm.firmId, staffEmail, "staff", key);
  const [{ id: team }] = await query(local.dbUrl, "insert into public.groups (firm_id, kind, name) values ($1, 'team', 'Audit team') returning id", [firm.firmId]);
  await query(local.dbUrl, "update public.firm_members set team_id = $2 where firm_id = $1 and user_id = any($3)", [firm.firmId, team, [managerId, staffId]]);
  [owner, manager, staff] = await Promise.all([0, 1, 2].map(async () => (await browser.newContext()).newPage()));
  await signIn(owner, ownerEmail, key);
  await signIn(manager, managerEmail, key);
  await signIn(staff, staffEmail, key);
  await connectTestMailbox(owner, office);
  const drive = owner.locator("section#drive");
  await drive.getByLabel("Test drive on this computer").check();
  await drive.getByLabel(/I have read this and I agree/).check();
  await drive.getByRole("button", { name: "Connect drive" }).click();
  await expect(drive.getByRole("status")).toContainText("Connected:");

  // Clients added as the owner adds them, so their emails are sealed as usual.
  for (const client of [routine, secret, unreachable] as { name: string; email?: string; id: string }[]) {
    await owner.goto("/app/clients?panel=add");
    await owner.getByLabel("Name", { exact: true }).fill(client.name);
    if (client.email) {
      await makeMailbox(client.email);
      await owner.getByLabel("Email", { exact: true }).fill(client.email);
    }
    await owner.getByRole("button", { name: "Add client" }).click();
    await expect(owner.locator(".page-head")).toContainText(client.name);
    client.id = owner.url().split("/").at(-1)!;
  }
  // Invented PDFs in this run's test drive, filed for them.
  await mkdir(`${TEST_DRIVE}/InboxCA`, { recursive: true });
  const rows: [{ name: string; id: string }, { id: string }, string, string?, string?][] = [
    [itr, routine, "ITR-V"], [balance, secret, "Balance sheet"], [noAddress, unreachable, "ITR-V"],
    [unchecked, routine, "Bank statement", "to_check"], [kept, routine, "ITR-V", "filed", "internal"], [rent, routine, "Rent receipts"],
  ];
  for (const [file, client, type, state = "filed", policy = null] of rows) {
    const stored = `InboxCA/papers-${randomUUID()}.pdf`;
    const bytes = Buffer.from(pdf(`Invented ${type}`));
    await writeFile(`${TEST_DRIVE}/${stored}`, bytes);
    files.push(stored);
    [{ id: file.id }] = await query(local.dbUrl, "insert into public.documents (firm_id, client_id, work_type, document_type, period_key, drive_file_id, name, size, sha256, status, share_policy) values ($1, $2, 'income_tax', $3, '2026', $4, $5, $6, $7, $8, $9) returning id",
      [firm.firmId, client.id, type, stored, file.name, bytes.length, randomUUID(), state, policy]);
  }
});
test.afterAll(async () => {
  await Promise.all(files.map((file) => rm(`${TEST_DRIVE}/${file}`, { force: true })));
  await firm.remove(managerEmail, staffEmail);
});

test("papers chosen in Documents go from the firm's mailbox as secure links; private ones need a code, the rest are skipped", async ({ request }) => {
  await owner.goto("/app/documents?year=all");
  const list = owner.getByRole("region", { name: "Papers" });
  for (const file of [itr, balance, noAddress, unchecked, kept]) await list.getByLabel(`Choose ${file.name}`).check();
  await owner.getByRole("form", { name: "Chosen papers" }).getByRole("button", { name: "Send as secure links" }).click();
  // Who gets what, before anything goes.
  const preview = owner.getByRole("dialog", { name: "Send 5 papers as secure links" });
  const row = (file: { name: string }) => preview.getByRole("listitem").filter({ hasText: file.name });
  await expect(row(itr)).toContainText(`To ${routine.name}`);
  await expect(row(itr)).toContainText("Will be emailed");
  await expect(row(balance)).toContainText("Will be emailed");
  await expect(row(noAddress)).toContainText("No email address");
  await expect(row(unchecked)).toContainText("Not ready to send: still in To check or missing in the drive");
  await expect(row(kept)).toContainText("Kept inside the firm");
  await preview.getByRole("button", { name: "Send 2 links" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "2 papers sent as secure links. 3 were not sent. Choose them again to see why." })).toBeVisible();

  // The routine paper opens at once; the private one only after a one-time code.
  await expect.poll(async () => (await lastMail(routine.email))?.text ?? "").toContain("shared ITR-V for FY 2025-26 with you");
  const plain = (await lastMail(routine.email))!;
  expect(plain.from?.text).toContain(office);
  expect(plain.text).toContain("The link works for 7 days and up to 5 downloads.");
  expect(plain.text).not.toContain("It is private");
  const open = plain.text!.match(/Download it here: (http\S+)/)![1];
  expect((await (await request.get(`${open}/file`)).body()).toString()).toContain("Invented ITR-V");
  await expect.poll(async () => (await lastMail(secret.email))?.text ?? "").toContain("shared Balance sheet for FY 2025-26 with you");
  const locked = (await lastMail(secret.email))!;
  expect(locked.from?.text).toContain(office);
  expect(locked.text).toContain("This paper is private. When you open the link, choose Email me a code.");
  const closed = await request.get(`${locked.text!.match(/Download it here: (http\S+)/)![1]}/file`);
  expect(closed.status()).toBe(403);
  expect(await closed.text()).toContain("This paper is private. Enter the code from your email first.");
  // Each sent paper is logged; the skipped ones were never shared.
  expect((await logged("document.shared")).map((line) => line.entity_id).sort()).toEqual([itr.id, balance.id].sort());
  expect(await query(local.dbUrl, "select document_id from public.shares where document_id = any($1)", [[noAddress.id, unchecked.id, kept.id]])).toEqual([]);
});

test("a private paper waiting in the Inbox is not sent when someone chooses Don't send", async () => {
  // A client's request for it, waiting for one approval.
  const [{ id: share }] = await query(local.dbUrl, "insert into public.shares (firm_id, document_id, status) values ($1, $2, 'waiting') returning id", [firm.firmId, balance.id]);
  const before = await mailCount(secret.email);
  const approve = await actionFields(owner, "/app/inbox", { share });
  await owner.goto("/app/inbox");
  const waiting = owner.locator("section[aria-labelledby=papers]");
  await expect(waiting.getByRole("listitem").filter({ hasText: balance.name })).toContainText(`Asked for by ${secret.name}`);
  await waiting.getByRole("button", { name: "Don't send" }).click();
  await expect(waiting).toHaveCount(0);
  expect(await query(local.dbUrl, "select status from public.shares where id = $1", [share])).toEqual([{ status: "refused" }]);
  expect(await logged("share.refused")).toEqual([{ actor_id: firm.ownerId, entity_id: balance.id, details: {} }]);
  // Approving it afterwards, from the page as it was, sends nothing.
  await owner.request.post("/app/inbox", { multipart: { ...approve, intent: "approve" }, headers: { Origin: new URL(owner.url()).origin } });
  expect(await query(local.dbUrl, "select status from public.shares where id = $1", [share])).toEqual([{ status: "refused" }]);
  expect(await logged("share.approved")).toEqual([]);
  expect(await mailCount(secret.email)).toBe(before);
});

test("Ask to send goes to the team's manager, who allows it once; the paper goes and the permission is used", async () => {
  await staff.goto(panelOf(routine, itr));
  const panel = staff.getByRole("dialog", { name: itr.name });
  await expect(panel.getByRole("link", { name: "Send this paper" })).toHaveCount(0);
  await panel.getByRole("button", { name: `Ask to send: ${itr.name}` }).click();
  await expect(staff.getByRole("status")).toContainText("Permission asked.");
  await staff.goto(panelOf(routine, itr));
  await expect(panel.getByText("Asked", { exact: true })).toBeVisible();
  const question = await asked("send");
  expect(question.details).toMatchObject({ by: staffId, route: "manager", document_id: itr.id });

  // The manager answers; only the owner could always allow it.
  const dialog = await answer(manager, "send a paper to the client");
  await expect(dialog).toContainText(`The paper: ${itr.name}`);
  await expect(dialog.getByRole("button", { name: "Always allow Sunil" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Allow once" }).click();
  await expect(manager.getByRole("status").filter({ hasText: "Sunil may send a paper to the client once, within an hour." })).toBeVisible();

  const sent = await mailCount(routine.email);
  await staff.goto(panelOf(routine, itr));
  await panel.getByRole("link", { name: "Send this paper" }).click();
  const send = staff.getByRole("dialog", { name: "Send to the client" });
  await expect(send).toContainText(`Send ITR-V to ${routine.email}?`);
  await send.getByRole("button", { name: "Send", exact: true }).click();
  await expect(staff.getByRole("status")).toContainText(`Sent ${itr.name}.`);
  await expect.poll(() => mailCount(routine.email)).toBe(sent + 1);
  expect((await lastMail(routine.email))!.from?.text).toContain(office);
  expect(await status(question.id)).toBe("used");
  await staff.goto(panelOf(routine, itr));
  await expect(panel.getByRole("button", { name: `Ask to send: ${itr.name}` })).toBeVisible();
  expect((await logged("permission.asked")).map((line) => line.actor_id)).toEqual([staffId]);
  expect(await logged("permission.allowed")).toEqual([{ actor_id: managerId, entity_id: question.id, details: { right: "send", for: staffId } }]);
});

test("Ask to remove goes to the owner alone, who refuses, then allows it once; the paper is removed", async () => {
  await staff.goto(panelOf(routine, rent));
  const panel = staff.getByRole("dialog", { name: rent.name });
  await expect(panel.getByRole("button", { name: `Remove ${rent.name}` })).toHaveCount(0);
  await panel.getByRole("button", { name: `Ask to remove: ${rent.name}` }).click();
  await expect(staff.getByRole("status")).toContainText("Permission asked.");
  const first = await asked("remove");
  expect(first.details).toMatchObject({ by: staffId, route: "owner", document_id: rent.id });

  // Not the manager's to answer: it is not listed for them, and their answer is refused.
  await manager.goto("/app/inbox");
  await expect(manager.locator("section[aria-labelledby=questions]")).toHaveCount(0);
  const fields = await actionFields(owner, `/app/inbox?answer=${first.id}`, { request: first.id });
  await manager.request.post("/app/inbox", { multipart: { ...fields, intent: "allow" }, headers: { Origin: new URL(manager.url()).origin } });
  expect(await status(first.id)).toBe("pending");
  expect((await logged("approval.denied")).map((line) => line.actor_id)).toEqual([managerId]);

  const refuse = await answer(owner, "remove a paper");
  await expect(refuse.getByRole("button", { name: "Always allow Sunil" })).toHaveCount(0);
  await refuse.getByRole("button", { name: "Refuse" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Refused. Sunil may not remove a paper." })).toBeVisible();
  expect(await status(first.id)).toBe("refused");
  await staff.goto(panelOf(routine, rent));
  await expect(panel.getByRole("button", { name: `Remove ${rent.name}` })).toHaveCount(0);

  // Asked again, the owner allows it once.
  await panel.getByRole("button", { name: `Ask to remove: ${rent.name}` }).click();
  await expect(staff.getByRole("status")).toContainText("Permission asked.");
  const second = await asked("remove");
  await (await answer(owner, "remove a paper")).getByRole("button", { name: "Allow once" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Sunil may remove a paper once, within an hour." })).toBeVisible();
  await staff.goto(panelOf(routine, rent));
  await panel.getByRole("button", { name: `Remove ${rent.name}` }).click();
  await expect.poll(async () => (await query(local.dbUrl, "select status from public.documents where id = $1", [rent.id]))[0].status).toBe("deleted");
  expect(await status(second.id)).toBe("used");
  expect((await logged("document.removed")).map((line) => [line.actor_id, line.entity_id])).toEqual([[staffId, rent.id]]);
  expect((await logged("permission.refused")).map((line) => [line.actor_id, line.entity_id])).toEqual([[firm.ownerId, first.id]]);
  const [{ drive_file_id: moved }] = await query(local.dbUrl, "select drive_file_id from public.documents where id = $1", [rent.id]);
  files.push(moved);
});

test("Ask to download expires unanswered; asked again, the manager allows one marked copy", async () => {
  const viewer = `/app/files/${balance.id}/view`;
  await staff.goto(viewer);
  await staff.getByRole("button", { name: "Ask to download", exact: true }).click();
  await expect(staff.getByRole("status")).toContainText("Permission asked.");
  const stale = await asked("download");
  expect(stale.details).toMatchObject({ by: staffId, route: "manager", document_id: balance.id });
  // Four hours on, nobody can answer it any more.
  await query(local.dbUrl, "update public.requests set expires_at = now() - interval '1 second' where id = $1", [stale.id]);
  await manager.goto("/app/inbox");
  await expect(manager.locator("section[aria-labelledby=questions]")).toHaveCount(0);

  await staff.goto(viewer);
  await staff.getByRole("button", { name: "Ask to download", exact: true }).click();
  await expect(staff.getByRole("status")).toContainText("Permission asked.");
  const question = await asked("download");
  expect(question.id).not.toBe(stale.id);
  const dialog = await answer(manager, "download a paper");
  await expect(dialog).toContainText(`The paper: ${balance.name}`);
  await dialog.getByRole("button", { name: "Allow once" }).click();
  await expect(manager.getByRole("status").filter({ hasText: "Sunil may download a paper once, within an hour." })).toBeVisible();

  await staff.goto(viewer);
  const [download] = await Promise.all([staff.waitForEvent("download"), staff.getByRole("button", { name: "Download these pages" }).click()]);
  expect((await readFile((await download.path())!)).subarray(0, 8).toString()).toBe("%PDF-1.4");
  expect(await status(question.id)).toBe("used");
  expect((await logged("document.downloaded")).map((line) => [line.actor_id, line.entity_id, line.details.permission])).toEqual([[staffId, balance.id, question.id]]);
  // Used once, it is gone.
  await staff.reload();
  await expect(staff.getByRole("button", { name: "Ask to download", exact: true })).toBeVisible();
  expect((await staff.request.post(viewer.replace("/view", "/stream"), { headers: { Origin: new URL(staff.url()).origin } })).status()).toBe(403);
});
