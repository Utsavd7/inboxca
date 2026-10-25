// The demo firm's mailbox on the local test mail server (GreenMail), so its Inbox shows real
// emails, read live as for any firm. Local only: run after npm run demo and npm run demo:data,
// with the file worker running. Every email here is invented.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const at = line.indexOf("=");
  if (at > 0 && !process.env[line.slice(0, at)]) process.env[line.slice(0, at)] = line.slice(at + 1);
}
const { default: pg } = await import("pg");
const { default: nodemailer } = await import("nodemailer");
const { ImapFlow } = await import("imapflow");
const { serverCrypto } = await import("../src/lib/crypto");

const OFFICE = "office@demo-firm.example";
const local = { imap: { host: "127.0.0.1", port: 3143 }, smtp: { host: "127.0.0.1", port: 3025 } };
const db = new pg.Client({ connectionString: process.env.TEST_DB_URL });
await db.connect();
const [{ id: firm } = { id: "" }] = (await db.query("select f.id from public.firms f join public.firm_members m on m.firm_id = f.id join auth.users u on u.id = m.user_id where u.email = 'demo-owner@inboxca.test' and m.role = 'owner'")).rows;
if (!firm) throw new Error("No demo firm: run npm run demo first");
const [account] = (await db.query("select id from public.connected_accounts where firm_id = $1 and kind = 'mail'", [firm])).rows;
if (!account) throw new Error("No demo mailbox: run npm run demo:data first");

// The local server makes a mailbox for any address it receives mail for, with the address as
// its password.
const crypto = serverCrypto();
await db.query("update public.connected_accounts set address_enc = $2, credentials_enc = $3, settings = $4, status = 'connected' where id = $1", [
  account.id,
  await crypto.encrypt(firm, `accounts/${account.id}/address`, OFFICE),
  await crypto.encrypt(firm, `accounts/${account.id}/credentials`, JSON.stringify({ password: OFFICE })),
  local,
]);

// One invented email for each sorted email the demo data made, with the same Message-ID, so
// the Inbox finds it; one has the team's reply in Sent.
const letters: Record<string, [string, string]> = {
  data_gst: ["GST bills for September", "Dear Sir,\n\nPlease find our sales and purchase bills for September attached. Let us know if anything is missing.\n\nRegards"],
  data_tax_audit: ["Audit papers for FY 2025-26", "Hello,\n\nSending the ledger and trial balance for the tax audit. The fixed asset register will follow this week.\n\nThanks"],
  records_past: ["ITR copies for the last three years", "Dear Sir,\n\nThe bank has asked for my ITR acknowledgements for the last three years for a home loan. Could you send them?\n\nRajesh"],
  other: ["Can we meet next week?", "Hello,\n\nCan we meet next week to talk about this year's returns? Tuesday or Wednesday works for us.\n\nRegards"],
  notice_received: ["Notice received from the GST department", "Dear Sir,\n\nWe received the attached notice from the GST department today. What should we do? Please call us.\n\nRegards"],
  data_income_tax: ["Form 16 for this year", "Hi,\n\nAttaching my Form 16 and the interest certificate from the bank for this year's return.\n\nThanks"],
};
const smtp = nodemailer.createTransport({ host: local.smtp.host, port: local.smtp.port, secure: false, ignoreTLS: true });
const events = (await db.query("select e.provider_message_id, e.label, e.received_at, c.id, c.name, c.email_enc from public.email_events e join public.clients c on c.id = e.client_id where e.firm_id = $1 order by e.received_at", [firm])).rows;
let replied: { id: string; to: string } | null = null;
for (const event of events) {
  const [subject, text] = letters[event.label] ?? letters.other;
  // The client's own (invented) address, so the email belongs to that client.
  const from = event.email_enc ? await crypto.decrypt(firm, `clients/${event.id}/email`, event.email_enc) : `accounts@${event.id}.example`;
  await smtp.sendMail({ from: `${event.name} <${from}>`, to: OFFICE, subject, text, messageId: event.provider_message_id, date: event.received_at });
  if (event.label === "data_gst" && !replied) replied = { id: event.provider_message_id, to: from };
}
if (replied) {
  const imap = new ImapFlow({ host: local.imap.host, port: local.imap.port, secure: false, auth: { user: OFFICE, pass: OFFICE }, logger: false });
  await imap.connect();
  if (!(await imap.list()).some((box) => box.path === "Sent")) await imap.mailboxCreate("Sent");
  const reply = [`From: Demo CA Firm <${OFFICE}>`, `To: ${replied.to}`, "Subject: Re: GST bills for September", `Message-ID: <demo-reply-${randomUUID()}@example>`, `In-Reply-To: ${replied.id}`, `References: ${replied.id}`, `Date: ${new Date().toUTCString()}`, "", "Thank you, the September bills are received and filed. We will share the GSTR-3B figures by the 15th.", "", "Demo CA Firm"].join("\r\n");
  await imap.append("Sent", reply, ["\\Seen"]);
  await imap.logout();
}
await db.end();
console.log(`Demo mailbox ready on the local mail server: ${events.length} emails${replied ? " and one reply" : ""}.`);
