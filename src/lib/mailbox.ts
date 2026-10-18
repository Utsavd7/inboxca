import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

// The firm's own mailbox over IMAP and SMTP (PLAN.md 5.13): settings found from the
// address, both sign ins checked before anything is saved, always over TLS. Only a test
// mail server on this machine may skip TLS, when the tests set MAIL_ALLOW_LOCAL; no
// deployment sets it.
export type Server = { host: string; port: number };
export type MailSettings = { imap: Server; smtp: Server };
export type MailCheck = { cursor: string } | { error: "sign_in" | "server" };

const providers: Record<string, MailSettings> = {
  google: { imap: { host: "imap.gmail.com", port: 993 }, smtp: { host: "smtp.gmail.com", port: 465 } },
  zoho_in: { imap: { host: "imap.zoho.in", port: 993 }, smtp: { host: "smtp.zoho.in", port: 465 } },
  zoho: { imap: { host: "imap.zoho.com", port: 993 }, smtp: { host: "smtp.zoho.com", port: 465 } },
};

// Finds the servers for an address from where its domain receives mail; "microsoft" means
// Outlook or Microsoft 365, which connect with Microsoft sign in instead of a password.
export async function detectSettings(address: string): Promise<MailSettings | "microsoft"> {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  if (["outlook.com", "hotmail.com", "live.com"].includes(domain)) return "microsoft";
  const mx = (await dns.resolveMx(domain).catch(() => [])).map((record) => record.exchange.toLowerCase()).join(" ");
  if (/google(mail)?\.com/.test(mx)) return providers.google;
  if (mx.includes("outlook.com")) return "microsoft";
  if (mx.includes("zoho.in")) return providers.zoho_in;
  if (mx.includes("zoho.")) return providers.zoho;
  // Thunderbird's public list of mail providers, then the usual names.
  const xml = await fetch(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(5000) })
    .then((response) => (response.ok ? response.text() : ""))
    .catch(() => "");
  const server = (type: string, fallback: Server): Server => {
    const block = xml.match(new RegExp(`<(?:incoming|outgoing)Server type="${type}">([\\s\\S]*?)</`))?.[1] ?? "";
    const host = block.match(/<hostname>([^<]+)</)?.[1];
    const port = Number(block.match(/<port>(\d+)</)?.[1]);
    return host && port ? { host: host.replace("%EMAILDOMAIN%", domain), port } : fallback;
  };
  return { imap: server("imap", { host: `imap.${domain}`, port: 993 }), smtp: server("smtp", { host: `smtp.${domain}`, port: 465 }) };
}

const testServer = (host: string) => process.env.MAIL_ALLOW_LOCAL === "1" && (host === "127.0.0.1" || host === "localhost");

// A host typed by the owner must be a public mail server, never this server's own network.
async function isPublic(host: string) {
  if (testServer(host)) return true;
  const addresses = isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);
  const private4 = /^(0|10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./;
  return addresses.length > 0 && addresses.every((ip) => !private4.test(ip) && !/^(::1?$|f[cd]|fe[89ab]|::ffff:)/i.test(ip));
}

export const imapClient = (address: string, password: string, { host, port }: Server) =>
  new ImapFlow({
    host,
    port,
    secure: port === 993,
    doSTARTTLS: testServer(host) ? false : port === 993 ? undefined : true,
    auth: { user: address, pass: password },
    logger: false,
    connectionTimeout: 15_000,
  });

export const smtpTransport = (address: string, password: string, { host, port }: Server) =>
  nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465 && !testServer(host),
    ignoreTLS: testServer(host),
    auth: { user: address, pass: password },
    connectionTimeout: 15_000,
  });

const signInFailed = (error: unknown) => {
  const failure = error as { authenticationFailed?: boolean; responseCode?: number; code?: string };
  return !!failure.authenticationFailed || failure.responseCode === 535 || failure.code === "EAUTH";
};

// Signs in to both servers. Reading starts from the next new message, so no old mail is
// read (no backfill); the cursor is "UIDVALIDITY:UIDNEXT" of the inbox.
export async function checkMailbox(address: string, password: string, settings: MailSettings): Promise<MailCheck> {
  if (!(await isPublic(settings.imap.host)) || !(await isPublic(settings.smtp.host))) return { error: "server" };
  const imap = imapClient(address, password, settings.imap);
  try {
    await imap.connect();
    const inbox = await imap.status("INBOX", { uidNext: true, uidValidity: true });
    await imap.logout();
    if (!inbox) return { error: "server" };
    await smtpTransport(address, password, settings.smtp).verify();
    return { cursor: `${inbox.uidValidity}:${inbox.uidNext}` };
  } catch (error) {
    imap.close();
    return { error: signInFailed(error) ? "sign_in" : "server" };
  }
}

export type NewMail = { uid: number; messageId: string; threadId: string; from: string; receivedAt: string };
export type MailContent = { subject: string; text: string; attachments: string[] };

// The inbox's messages after the cursor, up to 200 a time, as envelopes. Only the ones
// `keep` chooses (mail from the firm's clients and contacts) are opened, in memory, for
// their subject, text and attachment names; nothing of any other message is read. If the
// mailbox was rebuilt (a new UIDVALIDITY), reading restarts from the next new message.
export async function readNewMail(
  address: string,
  password: string,
  server: Server,
  cursor: string | null,
  keep: (mail: NewMail[]) => Promise<NewMail[]>,
) {
  const imap = imapClient(address, password, server);
  try {
    await imap.connect();
    const box = await imap.mailboxOpen("INBOX", { readOnly: true });
    const [validity, next] = (cursor ?? "").split(":");
    let start = validity === String(box.uidValidity) ? Number(next) : box.uidNext;
    const all: NewMail[] = [];
    if (box.uidNext > start) {
      const last = Math.min(box.uidNext - 1, start + 199);
      for await (const message of imap.fetch(`${start}:${last}`, { uid: true, envelope: true, internalDate: true, headers: ["references"] }, { uid: true })) {
        const id = message.envelope?.messageId ?? `uid:${box.uidValidity}:${message.uid}`;
        const root = message.headers?.toString().match(/<[^>]+>/)?.[0];
        all.push({
          uid: message.uid,
          messageId: id,
          threadId: root ?? message.envelope?.inReplyTo ?? id,
          from: message.envelope?.from?.[0]?.address?.toLowerCase() ?? "",
          receivedAt: new Date(message.internalDate ?? Date.now()).toISOString(),
        });
      }
      start = last + 1;
    }
    const kept: (NewMail & { content: MailContent })[] = [];
    for (const mail of all.length ? await keep(all) : []) {
      const message = await imap.fetchOne(String(mail.uid), { source: true }, { uid: true });
      const parsed = message && message.source ? await simpleParser(message.source) : null;
      kept.push({
        ...mail,
        content: {
          subject: parsed?.subject ?? "",
          text: parsed?.text ?? "",
          attachments: parsed?.attachments.map((file) => file.filename ?? "").filter(Boolean) ?? [],
        },
      });
    }
    await imap.logout();
    return { cursor: `${box.uidValidity}:${start}`, mail: kept };
  } catch (error) {
    imap.close();
    return { error: signInFailed(error) ? ("sign_in" as const) : ("server" as const) };
  }
}

// One message's subject and attached files, found again by its Message-ID ("uid:<validity>:
// <uid>" for one that has none) and opened in memory for filing. Pictures shown inside the
// text, such as a signature's logo, are left out.
export async function readAttachments(address: string, password: string, server: Server, messageId: string) {
  const imap = imapClient(address, password, server);
  try {
    await imap.connect();
    const box = await imap.mailboxOpen("INBOX", { readOnly: true });
    const own = messageId.match(/^uid:(\d+):(\d+)$/);
    const uids = own ? (own[1] === String(box.uidValidity) ? [Number(own[2])] : []) : await imap.search({ header: { "message-id": messageId } }, { uid: true });
    const message = uids && uids.length ? await imap.fetchOne(String(uids[0]), { source: true }, { uid: true }) : null;
    const parsed = message && message.source ? await simpleParser(message.source) : null;
    await imap.logout();
    return {
      subject: parsed?.subject ?? "",
      files: (parsed?.attachments ?? []).filter((file) => !file.related).map((file) => ({ name: file.filename ?? "", bytes: new Uint8Array(file.content) })),
    };
  } catch (error) {
    imap.close();
    return { error: signInFailed(error) ? ("sign_in" as const) : ("server" as const) };
  }
}

// Whether a message with this Message-ID is in the mailbox's Sent folder: how a send that
// may or may not have happened before a crash is checked. A mailbox whose server does not
// keep sent mail answers no, and the message goes again.
export async function foundInSent(address: string, password: string, server: Server, messageId: string) {
  const imap = imapClient(address, password, server);
  try {
    await imap.connect();
    const sent = (await imap.list()).find((box) => box.specialUse === "\\Sent");
    if (!sent) {
      await imap.logout();
      return false;
    }
    await imap.mailboxOpen(sent.path, { readOnly: true });
    const found = await imap.search({ header: { "message-id": messageId } }, { uid: true });
    await imap.logout();
    return !!found && found.length > 0;
  } catch {
    imap.close();
    return false;
  }
}
