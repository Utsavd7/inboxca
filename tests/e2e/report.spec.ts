import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { contactEmail } from "@/src/lib/site";
import { addPerson, appKey, localSupabase, query, seedFirm, signIn } from "./local-supabase";

// Report a problem or idea: anyone in the firm, here a staff member, opens it from Help, sends a
// subject with a picture, and Orelu support gets the email with the picture and the person to
// reply to; the admin console's row keeps the words only.
const local = localSupabase();
test.skip(!local.url || !local.mailUrl, "Needs local Supabase");

// The report on the local test mail server (GreenMail), by its subject; removed once read.
async function reportMail(subject: string) {
  const imap = new ImapFlow({ host: "127.0.0.1", port: 3143, secure: false, auth: { user: contactEmail, pass: contactEmail }, logger: false });
  await imap.connect();
  try {
    await imap.mailboxOpen("INBOX");
    const found = (await imap.search({ subject })) || [];
    if (!found.length) return null;
    const message = await imap.fetchOne(String(found[0]), { source: true });
    await imap.messageDelete(found);
    return message && message.source ? await simpleParser(message.source) : null;
  } finally {
    await imap.logout().catch(() => {});
  }
}

test("a staff member reports a problem with a picture, and Orelu support gets it to reply to", async ({ page }) => {
  test.setTimeout(90_000);
  const owner = `report-owner-${randomUUID()}@invented.test`;
  const staff = `report-staff-${randomUUID()}@invented.test`;
  const key = appKey();
  const firm = await seedFirm("Invented Report Firm", owner);
  try {
    await addPerson(firm.firmId, staff, "staff", key);
    await signIn(page, staff, key);
    await page.locator(".side-foot").getByRole("button", { name: "Help" }).click();
    await page.getByRole("button", { name: "Report a problem or idea" }).click();
    const sheet = page.getByRole("dialog", { name: "Report a problem or idea" });
    await sheet.getByLabel("Something is broken").check();
    const subject = `Upload does nothing ${randomUUID().slice(0, 8)}`;
    await sheet.getByLabel("Subject").fill(subject);
    // A small picture drawn by the browser itself.
    const png = Buffer.from((await page.evaluate(() => Object.assign(document.createElement("canvas"), { width: 4, height: 4 }).toDataURL("image/png"))).split(",")[1], "base64");
    await sheet.getByLabel("Choose a file").setInputFiles({ name: "invented.png", mimeType: "image/png", buffer: png });
    await expect(sheet.getByRole("list", { name: "Attached" })).toContainText("invented.png");
    await sheet.getByRole("button", { name: "Send to Orelu" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Sent to Orelu. We reply to your email." })).toBeVisible();
    await expect(sheet).toBeHidden();

    let mail: ParsedMail | null = null;
    await expect.poll(async () => (mail = await reportMail(`[InboxCA] Something is broken: ${subject}`)) !== null, { timeout: 20_000 }).toBe(true);
    expect(mail!.replyTo?.value[0].address).toBe(staff);
    expect(mail!.attachments.map((file) => [file.filename, file.contentType, file.size])).toEqual([["invented.png", "image/png", png.length]]);
    expect(mail!.text).toContain("Page: /app\n");
    expect(await query(local.dbUrl, "select kind, context ->> 'role' role from public.feedback where firm_id = $1", [firm.firmId])).toEqual([{ kind: "broken", role: "Staff" }]);
  } finally {
    await firm.remove(staff);
  }
});
