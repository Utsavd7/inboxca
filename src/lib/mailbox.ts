import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { ImapFlow, type SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { mailLimits, snippet, threadKeys, type ListAsk, type MailItem, type MailMessage, type ThreadAsk } from "./mail-view.ts";

// The firm's own mailbox over IMAP and SMTP (PLAN.md 5.13): settings found from the
// address, both sign ins checked before anything is saved, always over TLS. Only a test
// mail server on this machine may skip TLS, when the tests set MAIL_ALLOW_LOCAL; no
// deployment sets it.
export type Server = { host: string; port: number };
export type MailSettings = { imap: Server; smtp: Server };
export type MailCheck = { cursor: string } | { error: "sign_in" | "server" };

// The providers Indian firms use most, with each one's published servers: found by the
// address's own domain, or by where a firm's own domain receives mail.
const zohoHelp = "Zoho Mail needs an app password, not your usual password. Make one in Zoho Accounts under Security, then App passwords. Then turn on IMAP access in Zoho Mail settings.";
const providers: (MailSettings & { name: string; domains: string[]; mx: RegExp; help: string })[] = [
  { name: "Gmail", domains: ["gmail.com", "googlemail.com"], mx: /google(mail)?\.com/, imap: { host: "imap.gmail.com", port: 993 }, smtp: { host: "smtp.gmail.com", port: 465 }, help: "Gmail needs an app password, not your usual password. Make one in your Google Account under Security, then App passwords." },
  { name: "Zoho Mail", domains: ["zoho.in", "zohomail.in"], mx: /zoho\.in/, imap: { host: "imap.zoho.in", port: 993 }, smtp: { host: "smtp.zoho.in", port: 465 }, help: zohoHelp },
  { name: "Zoho Mail", domains: ["zoho.com", "zohomail.com"], mx: /zoho(mail)?\.com/, imap: { host: "imap.zoho.com", port: 993 }, smtp: { host: "smtp.zoho.com", port: 465 }, help: zohoHelp },
  { name: "Yahoo Mail", domains: ["yahoo.com", "yahoo.co.in", "ymail.com", "rocketmail.com"], mx: /yahoodns\.net/, imap: { host: "imap.mail.yahoo.com", port: 993 }, smtp: { host: "smtp.mail.yahoo.com", port: 465 }, help: "Yahoo Mail needs an app password, not your usual password. Make one in Account info under Account security, then Generate app password." },
  { name: "GoDaddy email", domains: [], mx: /secureserver\.net/, imap: { host: "imap.secureserver.net", port: 993 }, smtp: { host: "smtpout.secureserver.net", port: 465 }, help: "Use this email address's own password, the one set for it at GoDaddy." },
  { name: "Hostinger email", domains: [], mx: /hostinger\.com/, imap: { host: "imap.hostinger.com", port: 993 }, smtp: { host: "smtp.hostinger.com", port: 465 }, help: "Use this email address's own password, the one set for it at Hostinger." },
];
export const providerFor = (imapHost: string) => providers.find((provider) => provider.imap.host === imapHost);

// Finds the servers for an address: the list above, then Thunderbird's public list of mail
// providers and the domain's own published settings, then where the domain receives mail,
// then the usual names. "microsoft" means Outlook or Microsoft 365, which connect with
// Microsoft sign in instead of a password.
export async function detectSettings(address: string): Promise<(MailSettings & { name?: string }) | "microsoft"> {
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  if (["outlook.com", "hotmail.com", "live.com"].includes(domain)) return "microsoft";
  const listed = providers.find((provider) => provider.domains.includes(domain));
  if (listed) return listed;
  // A domain's own settings are asked for only from a public server, never this network.
  const config = async (url: string) =>
    (await isPublic(new URL(url).hostname))
      ? fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) }).then((response) => (response.ok ? response.text() : "")).catch(() => "")
      : "";
  const [xmls, mx] = await Promise.all([
    Promise.all([
      `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`,
      `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(address)}`,
      `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
    ].map((url) => config(url).catch(() => ""))),
    dns.resolveMx(domain).then((records) => records.map((record) => record.exchange.toLowerCase()).join(" "), () => ""),
  ]);
  const server = (xml: string, type: string): Server | undefined => {
    const block = xml.match(new RegExp(`<(?:incoming|outgoing)Server type="${type}">([\\s\\S]*?)</(?:incoming|outgoing)Server>`))?.[1] ?? "";
    const host = block.match(/<hostname>([^<]+)</)?.[1];
    const port = Number(block.match(/<port>(\d+)</)?.[1]);
    return host && port ? { host: host.replace("%EMAILDOMAIN%", domain), port } : undefined;
  };
  const xml = xmls.find((text) => server(text, "imap") && server(text, "smtp"));
  if (xml) return { name: xml.match(/<displayShortName>([^<]+)</)?.[1], imap: server(xml, "imap")!, smtp: server(xml, "smtp")! };
  if (mx.includes("outlook.com")) return "microsoft";
  return providers.find((provider) => provider.mx.test(mx)) ?? { imap: { host: `imap.${domain}`, port: 993 }, smtp: { host: `smtp.${domain}`, port: 465 } };
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

export const signInFailed = (error: unknown) => {
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

export type NewMail = { uid: number; messageId: string; threadId: string; from: string; receivedAt: string; auth: string };
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
      for await (const message of imap.fetch(`${start}:${last}`, { uid: true, envelope: true, internalDate: true, headers: ["references", "authentication-results"] }, { uid: true })) {
        const id = message.envelope?.messageId ?? `uid:${box.uidValidity}:${message.uid}`;
        // Each header with its folded lines; the mailbox's own SPF and DKIM results are kept
        // for the official sender check (src/lib/gov-mail.ts).
        const headers = (message.headers?.toString() ?? "").split(/\r?\n(?!\s)/);
        const root = headers.find((line) => /^references:/i.test(line))?.match(/<[^>]+>/)?.[0];
        all.push({
          uid: message.uid,
          messageId: id,
          threadId: root ?? message.envelope?.inReplyTo ?? id,
          from: message.envelope?.from?.[0]?.address?.toLowerCase() ?? "",
          receivedAt: new Date(message.internalDate ?? Date.now()).toISOString(),
          auth: headers.filter((line) => /^authentication-results:/i.test(line)).join("\n"),
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

// One message's subject, text and attached files, found again by its Message-ID ("uid:<validity>:
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
      text: parsed?.text ?? "",
      files: (parsed?.attachments ?? []).filter((file) => !file.related).map((file) => ({ name: file.filename ?? "", bytes: new Uint8Array(file.content) })),
    };
  } catch (error) {
    imap.close();
    return { error: signInFailed(error) ? ("sign_in" as const) : ("server" as const) };
  }
}

// Whether a message with this Message-ID is in the mailbox's Sent folder: how a send that
// may or may not have happened before a crash is checked. An unavailable Sent folder
// must never be treated as evidence that the email did not go.
export async function foundInSent(address: string, password: string, server: Server, messageId: string) {
  const imap = imapClient(address, password, server);
  try {
    await imap.connect();
    const sent = (await imap.list()).find((box) => box.specialUse === "\\Sent");
    if (!sent) {
      await imap.logout();
      throw new Error("sent_folder_missing");
    }
    await imap.mailboxOpen(sent.path, { readOnly: true });
    const found = await imap.search({ header: { "message-id": messageId } }, { uid: true });
    await imap.logout();
    return !!found && found.length > 0;
  } catch {
    imap.close();
    throw new Error("sent_not_read");
  }
}

// Gmail supports searching for the original Message-ID. Other providers need their own link.
export const opensInMailbox = (host:string) => host.toLowerCase() === "imap.gmail.com";
export const mailboxLink = (host:string,address:string,messageId:string) => opensInMailbox(host)
  ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#search/${encodeURIComponent(`rfc822msgid:${messageId.replace(/^<|>$/g, "")}`)}` : null;

// The Inbox page's live reads (run by the file worker): only what the page shows, opened in
// memory and returned, never kept. The text of a message is read from its first megabyte;
// attachment names come from its structure, so no attachment is downloaded.
type Part = { disposition?: string; dispositionParameters?: Record<string, string>; parameters?: Record<string, string>; childNodes?: Part[] };
const fileNames = (part?: Part): string[] =>
  !part ? [] : [...(part.childNodes ?? []).flatMap(fileNames), ...(part.disposition === "attachment" || (part.disposition !== "inline" && part.dispositionParameters?.filename) ? [part.dispositionParameters?.filename ?? part.parameters?.name ?? ""] : [])].filter(Boolean);
const emails = (list?: { address?: string }[]) => (list ?? []).map((entry) => entry.address?.toLowerCase() ?? "").filter(Boolean);
const textOr = (q: string): SearchObject => ({ or: [{ subject: q }, { from: q }, { to: q }, { body: q }] });
const anyOf = (criteria: SearchObject[]): SearchObject => (criteria.length === 1 ? criteria[0] : { or: criteria });

async function readItems(imap: ImapFlow, box: MailItem["box"], uids: number[], full = false) {
  const read: MailMessage[] = [];
  if (!uids.length) return read;
  for await (const message of imap.fetch(uids, { uid: true, envelope: true, internalDate: true, bodyStructure: full, source: { maxLength: full ? 1_000_000 : 16_384 } }, { uid: true })) {
    const parsed = message.source ? await simpleParser(message.source).catch(() => null) : null;
    const text = (parsed?.text ?? "").slice(0, mailLimits.text);
    const references = parsed?.references ?? [];
    read.push({
      box,
      messageId: message.envelope?.messageId ?? "",
      from: emails(message.envelope?.from)[0] ?? "",
      to: emails([...(message.envelope?.to ?? []), ...(message.envelope?.cc ?? [])]),
      date: new Date(message.envelope?.date ?? message.internalDate ?? 0).toISOString(),
      subject: message.envelope?.subject ?? "",
      snippet: snippet(text),
      inReplyTo: message.envelope?.inReplyTo ?? "",
      references: typeof references === "string" ? [references] : references,
      text: full ? text : "",
      attachments: full ? fileNames(message.bodyStructure as Part) : [],
    });
  }
  return read;
}

const sentFolder = async (imap: ImapFlow) => (await imap.list()).find((box) => box.specialUse === "\\Sent")?.path;

// The live reads keep each mailbox's signed in connection for a minute after a read, so the
// next page view skips the TLS and sign in. Only an idle connection is kept, so each one runs
// one read at a time; the key holds a hash of the password, never the password, so a changed
// password never reuses an old session. A kept connection that fails may have gone stale, so
// the read runs once more on a new one; a refused sign in is never tried again.
const idle = new Map<string, { imap: ImapFlow; timer: NodeJS.Timeout }>();
const take = (key: string) => {
  const kept = idle.get(key);
  idle.delete(key);
  clearTimeout(kept?.timer);
  return kept?.imap;
};
const park = (key: string, imap: ImapFlow) => {
  if (idle.has(key) || !imap.usable) return void imap.logout().catch(() => {});
  if (idle.size >= 50) take(idle.keys().next().value!)?.logout().catch(() => {});
  idle.set(key, { imap, timer: setTimeout(() => take(key)?.logout().catch(() => {}), 60_000).unref() });
};
async function reuse<T>(address: string, password: string, server: Server, read: (imap: ImapFlow) => Promise<T>, fresh = false): Promise<T | { error: "sign_in" | "server" }> {
  const key = [server.host, server.port, address, createHash("sha256").update(password).digest("hex")].join(" ");
  const kept = fresh ? undefined : take(key);
  // One the server dropped while kept is closed already: its error only closes it, so an
  // idle connection's error never stops the worker.
  const imap = kept?.usable ? kept : imapClient(address, password, server).on("error", () => {});
  try {
    if (imap !== kept) await imap.connect();
    const result = await read(imap);
    park(key, imap);
    return result;
  } catch (error) {
    imap.close();
    if (imap === kept && !signInFailed(error)) return reuse(address, password, server, read, true);
    return { error: signInFailed(error) ? "sign_in" : "server" };
  }
}

export async function listMail(address: string, password: string, server: Server, ask: ListAsk) {
  return reuse(address, password, server, async (imap) => {
    let inbox: MailItem[] = [];
    if (ask.inbox.length) {
      await imap.mailboxOpen("INBOX", { readOnly: true });
      const ids = new Set(ask.inbox);
      let uids = (await imap.search(ask.q ? textOr(ask.q) : anyOf(ask.inbox.map((id) => ({ header: { "message-id": id } }))), { uid: true })) || [];
      // A search may match mail of anyone: only the asked messages are opened.
      if (ask.q) {
        const kept: number[] = [];
        for await (const message of imap.fetch(uids.slice(-300), { uid: true, envelope: true }, { uid: true })) if (ids.has(message.envelope?.messageId ?? "")) kept.push(message.uid);
        uids = kept;
      }
      inbox = (await readItems(imap, "inbox", uids.slice(-mailLimits.sent))).filter((item) => ids.has(item.messageId));
    }
    let sent: MailItem[] | null = null;
    const { sent: want } = ask;
    if (want) {
      const folder = await sentFolder(imap);
      sent = [];
      if (folder) {
        await imap.mailboxOpen(folder, { readOnly: true });
        const base: SearchObject = {
          ...(ask.q && textOr(ask.q)),
          ...(want.since && { since: new Date(Date.parse(want.since) - 86_400_000) }),
          ...(want.before && { before: new Date(Date.parse(want.before) + 86_400_000) }),
          ...(want.reminders && { header: { "message-id": "<reminder-" } }),
        };
        const found: number[] = [];
        for (const to of want.to ?? [null]) found.push(...((await imap.search(to ? { ...base, to } : Object.keys(base).length ? base : { all: true }, { uid: true })) || []));
        const uids = [...new Set(found)].sort((a, b) => a - b).slice(-want.limit);
        sent = (await readItems(imap, "sent", uids)).filter((item) => (!want.since || item.date >= want.since) && (!want.before || item.date < want.before));
      }
    }
    return { inbox: inbox.map(({ box, messageId, from, to, date, subject, snippet }) => ({ box, messageId, from, to, date, subject, snippet })), sent: sent?.map(({ box, messageId, from, to, date, subject, snippet }) => ({ box, messageId, from, to, date, subject, snippet })) ?? null };
  });
}

// One message and its conversation: every message in the inbox or the Sent folder that it
// replies to or that replies to it, by Message-ID, In-Reply-To and References, oldest first.
export async function readThread(address: string, password: string, server: Server, ask: ThreadAsk) {
  return reuse(address, password, server, async (imap) => {
    const boxes = { inbox: "INBOX", sent: await sentFolder(imap) };
    const open = async (box: MailItem["box"]) => !!boxes[box] && !!(await imap.mailboxOpen(boxes[box]!, { readOnly: true }));
    const messages = new Map<string, MailMessage>();
    if (await open(ask.box)) {
      const uids = (await imap.search({ header: { "message-id": ask.messageId } }, { uid: true })) || [];
      const opened = (await readItems(imap, ask.box, uids.slice(-1), true)).find((item) => item.messageId === ask.messageId);
      if (opened) {
        messages.set(opened.messageId, opened);
        const criteria: SearchObject[] = threadKeys(opened.messageId, opened.inReplyTo, opened.references).flatMap((key) => ["message-id", "references", "in-reply-to"].map((name) => ({ header: { [name]: key } })));
        for (const box of ["inbox", "sent"] as const) {
          if (!(await open(box))) continue;
          const found = ((await imap.search(anyOf(criteria), { uid: true })) || []).slice(-mailLimits.thread);
          for (const message of await readItems(imap, box, found, true)) if (message.messageId && !messages.has(message.messageId)) messages.set(message.messageId, message);
        }
      }
    }
    return { messages: [...messages.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-mailLimits.thread) };
  });
}

// A copy of a message the app sent, put in the Sent folder unless the provider already put
// it there (Gmail, Zoho and Microsoft do), so the conversation shows the reply. Says
// whether the Sent folder has it.
export async function keepInSent(address: string, password: string, server: Server, raw: Buffer, messageId: string) {
  const imap = imapClient(address, password, server);
  try {
    await imap.connect();
    const folder = await sentFolder(imap);
    if (!folder) {
      await imap.logout();
      return false;
    }
    await imap.mailboxOpen(folder);
    const found = await imap.search({ header: { "message-id": messageId } }, { uid: true });
    if (!found || !found.length) await imap.append(folder, raw, ["\\Seen"]);
    await imap.logout();
    return true;
  } catch {
    imap.close();
    return false;
  }
}
