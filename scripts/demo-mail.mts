// The demo firm's mailbox on the local test mail server (GreenMail), so its Inbox shows real
// emails, read live as for any firm, with the papers already in the drive attached. Then come
// new emails from clients with more papers (scripts/demo-files.mts), which InboxCA reads, types,
// names and files itself on its next mail check (the jobs runner, with a drive connected).
// Local only: run after npm run demo and npm run demo:data, with the file worker running.
// Running it again empties the mailbox first. Every email here is invented.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !process.env[line.slice(0, at)]) process.env[line.slice(0, at)] = line.slice(at + 1);
}
const { default: pg } = await import("pg");
const { default: nodemailer } = await import("nodemailer");
const { ImapFlow } = await import("imapflow");
const { accountIdentity, serverCrypto } = await import("../src/lib/crypto");
const { demoFiles } = await import("./demo-files.mts");

const OFFICE = "office@demo-firm.example";
const local = { imap: { host: "127.0.0.1", port: 3143 }, smtp: { host: "127.0.0.1", port: 3025 } };
const db = new pg.Client({ connectionString: process.env.TEST_DB_URL });
await db.connect();
const [{ id: firm } = { id: "" }] = (await db.query("select f.id from public.firms f join public.firm_members m on m.firm_id = f.id join auth.users u on u.id = m.user_id where u.email = 'demo-owner@inboxca.test' and m.role = 'owner'")).rows;
if (!firm) throw new Error("No demo firm: run npm run demo first");
const [account] = (await db.query("select id from public.connected_accounts where firm_id = $1 and kind = 'mail'", [firm])).rows;
if (!account) throw new Error("No demo mailbox: run npm run demo:data first");

// The local server makes a mailbox for any address it receives mail for, with the address as
// its password. It is emptied, and InboxCA's next mail check starts from here, so it reads
// only the emails sent below.
const smtp = nodemailer.createTransport({ host: local.smtp.host, port: local.smtp.port, secure: false, ignoreTLS: true });
await smtp.sendMail({ from: `Demo CA Firm <${OFFICE}>`, to: OFFICE, subject: "Demo mailbox", text: "Makes the demo mailbox." });
const imap = new ImapFlow({ host: local.imap.host, port: local.imap.port, secure: false, auth: { user: OFFICE, pass: OFFICE }, logger: false });
for (let tries = 0; ; tries++) {
  try { await imap.connect(); break; } catch (error) { if (tries > 9) throw error; await new Promise((done) => setTimeout(done, 500)); }
}
if (!(await imap.list()).some((box) => box.path === "Sent")) await imap.mailboxCreate("Sent");
for (const path of ["Sent", "INBOX"]) if ((await imap.mailboxOpen(path)).exists) await imap.messageDelete("1:*");
const inbox = imap.mailbox as { uidValidity: bigint; uidNext: number };
const crypto = serverCrypto();
await db.query("update public.connected_accounts set address_enc = $2, credentials_enc = $3, settings = $4, identity_hash = $5, status = 'connected', sync_cursor = $6 where id = $1", [
  account.id,
  await crypto.encrypt(firm, `accounts/${account.id}/address`, OFFICE),
  await crypto.encrypt(firm, `accounts/${account.id}/credentials`, JSON.stringify({ password: OFFICE })),
  local,
  accountIdentity("mail", "imap", OFFICE),
  `${inbox.uidValidity}:${inbox.uidNext}`,
]);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const lastMonth = new Date(Date.parse(`${today.slice(0, 7)}-01`) - 86_400_000).toISOString().slice(0, 7);
const papers = demoFiles(lastMonth, today);
const month = new Date(`${lastMonth}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
const attach = (list: typeof papers) => list.map((paper) => ({ filename: paper.original, content: Buffer.from(paper.bytes) }));

// One invented email for each sorted email the demo data made, with the same Message-ID, so
// the Inbox finds it; one has the team's reply in Sent.
const letters: Record<string, [string, string]> = {
  data_gst: [`GST bills for ${month}`, `Dear Sir,\n\nPlease find our sales and purchase bills for ${month} attached. Let us know if anything is missing.\n\nRegards`],
  data_tax_audit: ["Audit papers for FY 2025-26", "Hello,\n\nSending the ledger and trial balance for the tax audit. The fixed asset register will follow this week.\n\nThanks"],
  records_past: ["ITR copies for the last three years", "Dear Sir,\n\nThe bank has asked for my ITR acknowledgements for the last three years for a home loan. Could you send them?\n\nRajesh"],
  other: ["Can we meet next week?", "Hello,\n\nCan we meet next week to talk about this year's returns? Tuesday or Wednesday works for us.\n\nRegards"],
  notice_received: ["Notice received from the GST department", "Dear Sir,\n\nWe received the attached notice from the GST department today. What should we do? Please call us.\n\nRegards"],
  data_income_tax: ["Form 16 for this year", "Hi,\n\nAttaching my Form 16 and the interest certificate from the bank for this year's return.\n\nThanks"],
};
const events = (await db.query("select e.provider_message_id, e.label, e.received_at, c.id, c.name, c.email_enc from public.email_events e join public.clients c on c.id = e.client_id where e.firm_id = $1 order by e.received_at", [firm])).rows;
let replied: { id: string; to: string } | null = null;
for (const event of events) {
  const [subject, text] = letters[event.label] ?? letters.other;
  // The client's own (invented) address, so the email belongs to that client.
  const from = event.email_enc ? await crypto.decrypt(firm, `clients/${event.id}/email`, event.email_enc) : `accounts@${event.id}.example`;
  // The papers demo:data put in the drive for this email came with it.
  const attachments = attach(papers.filter((paper) => !paper.mail && paper.client === event.name));
  await smtp.sendMail({ from: `${event.name} <${from}>`, to: OFFICE, subject, text, messageId: event.provider_message_id, date: event.received_at, attachments });
  if (event.label === "data_gst" && !replied) replied = { id: event.provider_message_id, to: from };
}
// New emails with papers, one for each letter: InboxCA files these itself.
const incoming = new Map<object, typeof papers>();
for (const paper of papers) if (paper.mail) incoming.set(paper.mail, [...(incoming.get(paper.mail) ?? []), paper]);
for (const list of incoming.values()) {
  const [client] = (await db.query("select id, email_enc from public.clients where firm_id = $1 and name = $2", [firm, list[0].client])).rows;
  if (!client?.email_enc) continue;
  const from = await crypto.decrypt(firm, `clients/${client.id}/email`, client.email_enc);
  await smtp.sendMail({ from: `${list[0].client} <${from}>`, to: OFFICE, subject: list[0].mail!.subject, text: list[0].mail!.text, messageId: `<demo-${randomUUID()}@example>`, attachments: attach(list) });
}
if (replied) {
  const reply = [`From: Demo CA Firm <${OFFICE}>`, `To: ${replied.to}`, `Subject: Re: GST bills for ${month}`, `Message-ID: <demo-reply-${randomUUID()}@example>`, `In-Reply-To: ${replied.id}`, `References: ${replied.id}`, `Date: ${new Date().toUTCString()}`, "", `Thank you, the ${month} bills are received and filed. We will share the GSTR-3B figures by the 15th.`, "", "Demo CA Firm"].join("\r\n");
  await imap.append("Sent", reply, ["\\Seen"]);
}
await imap.logout();
await db.end();
console.log(`Demo mailbox ready on the local mail server: ${events.length} emails${replied ? " and one reply" : ""}, and ${incoming.size} new emails with papers for InboxCA to file.`);
