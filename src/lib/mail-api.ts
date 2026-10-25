import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { mailLimits, snippet, type ApiSettings, type ListAsk, type MailApi, type MailItem, type MailMessage, type ThreadAsk } from "./mail-view.ts";
import type { MailContent, NewMail } from "./mailbox.ts";

// The firm's mailbox over its provider's own API, for a mailbox connected with Google,
// Microsoft or Zoho sign in (PLAN.md 5.13, 8.7): the same reads and sends as over IMAP, with a
// short access token. Messages are opened in memory and never kept. Gmail and Microsoft find
// a message by its Message-ID; Zoho's API cannot, so a Zoho message is named by Zoho's own
// ids ("zoho:<folder>:<message>:<thread>"). Gmail may change the Message-ID of mail sent
// through its API, so InboxCA's own id also goes in an X-InboxCA-Id header.
export type ApiMailbox = { provider: MailApi; token: string; settings: ApiSettings };
type Box = MailItem["box"];
type Item = MailItem & { ref: string; size?: number };
type Heads = { ids?: string[]; q?: string; to?: string[]; since?: string; before?: string; limit: number };
type Mail = { from: string; to: string; subject: string; text: string; messageId?: string; inReplyTo?: string; references?: string | string[]; attachments?: { filename: string; content: Buffer }[]; date?: Date };
type Driver = {
  start(): Promise<string>;
  since(cursor: string): Promise<{ cursor: string; mail: (NewMail & { ref: string })[] } | null>;
  raw(ref: string, cap?: number): Promise<Buffer | null>;
  find(box: Box, messageId: string): Promise<string | null>;
  head(ref: string, box: Box): Promise<Item | null>;
  heads(box: Box, ask: Heads): Promise<Item[]>;
  thread(ref: string): Promise<Item[]>;
  send(mail: Mail, raw: Buffer): Promise<void>;
};
type Header = { name: string; value: string };

// Tests send every provider call to a fake server on this machine, only with MAIL_ALLOW_LOCAL.
export const providerUrl = (url: string) =>
  process.env.MAIL_ALLOW_LOCAL === "1" && process.env.MAIL_API_TEST_URL ? url.replace("https://", `${process.env.MAIL_API_TEST_URL}/`) : url;

// A refused token reads as a refused sign in (code EAUTH, as SMTP's), which the callers count.
const refused = () => Object.assign(new Error("mail_api_sign_in"), { code: "EAUTH" });
async function call(mailbox: ApiMailbox, url: string, init: RequestInit = {}) {
  const response = await fetch(providerUrl(url), {
    ...init,
    headers: { Authorization: `${mailbox.provider === "zoho" ? "Zoho-oauthtoken" : "Bearer"} ${mailbox.token}`, ...init.headers },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (response.status === 401) throw refused();
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`mail_api_${response.status}`);
  return response;
}
async function json<T>(mailbox: ApiMailbox, url: string, init?: RequestInit): Promise<T | null> {
  const response = await call(mailbox, url, init);
  return response && response.status !== 202 && response.status !== 204 ? ((await response.json()) as T) : null;
}
// At most `cap` bytes of a message, so a conversation never downloads a large attachment.
async function capped(response: Response, cap = Infinity) {
  if (cap === Infinity || !response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts).subarray(0, cap);
}

const bare = (id: string) => id.replace(/^<|>$/g, "");
const unescape = (text: string) => text.replace(/&(#39|quot|amp|lt|gt);/g, (_, name: string) => ({ "#39": "'", quot: '"', amp: "&", lt: "<", gt: ">" })[name] ?? "");
const emails = (text = "") => [...unescape(text).matchAll(/[^\s<>"',;:]+@[^\s<>"',;:]+/g)].map((found) => found[0].toLowerCase());
const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, at) => list.slice(at * size, at * size + size));
const header = (headers: Header[] | undefined, name: string) => headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const quoted = (text: string) => `"${text.replace(/["\\]/g, " ")}"`;
const iso = (date: string) => new Date(date).toISOString().replace(/\.\d+Z$/, "Z");
// The name InboxCA gives a message: its own id on mail it sent, else the Message-ID, else
// the provider's own id.
const nameOf = (provider: MailApi, ref: string, box: Box, messageId?: string, own?: string) => (box === "sent" && own) || messageId || `${provider}:${ref}`;
// The provider's own id in a name InboxCA gave, only if it is made of id characters.
const native = (provider: MailApi, name: string) => {
  const ref = name.startsWith(`${provider}:`) ? name.slice(provider.length + 1) : "";
  return /^[\w=+-]+(:[\w=+-]*)*$/.test(ref) ? ref : null;
};
// A Message-ID that Gmail's search can be asked for exactly: no spaces, quotes or groups.
const searchable = (messageId: string) => !/[\s{}()"]/.test(messageId);

// For the providers that list by time: a cursor of a time and the ids already read at it.
function byTime<T extends { id: string; at: string }>(cursor: string, rows: T[]) {
  const [time, seen = ""] = cursor.split("|");
  const known = new Set(seen.split(",").filter(Boolean));
  const fresh = rows.filter((row) => row.at >= time && !known.has(row.id)).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 200);
  const last = fresh.at(-1)?.at ?? time;
  return { fresh, cursor: `${last}|${[...(last === time ? known : []), ...fresh.filter((row) => row.at === last).map((row) => row.id)].join(",")}` };
}

type GmailMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; sizeEstimate?: number; raw?: string; payload?: { headers?: Header[] } };
function gmail(mailbox: ApiMailbox): Driver {
  const api = "https://gmail.googleapis.com/gmail/v1/users/me";
  const get = <T,>(path: string) => json<T>(mailbox, `${api}/${path}`);
  const metadata = (names: string[]) => `format=metadata&${names.map((name) => `metadataHeaders=${name}`).join("&")}`;
  const listed = metadata(["Message-ID", "From", "To", "Cc", "Date", "Subject", "X-InboxCA-Id"]);
  const item = (message: GmailMessage): Item => {
    const headers = message.payload?.headers;
    const box = message.labelIds?.includes("SENT") ? "sent" : "inbox";
    return {
      ref: message.id,
      size: message.sizeEstimate,
      box,
      messageId: nameOf("gmail", message.id, box, header(headers, "Message-ID"), header(headers, "X-InboxCA-Id")),
      from: emails(header(headers, "From"))[0] ?? "",
      to: emails(`${header(headers, "To")} ${header(headers, "Cc")}`),
      date: new Date(Number(message.internalDate) || Date.parse(header(headers, "Date")) || 0).toISOString(),
      subject: header(headers, "Subject"),
      snippet: snippet(unescape(message.snippet ?? "")),
    };
  };
  const search = async (q: string, limit: number) => (await get<{ messages?: { id: string }[] }>(`messages?q=${encodeURIComponent(q)}&maxResults=${limit}`))?.messages?.map((found) => found.id) ?? [];
  const heads = async (ids: string[]) => (await Promise.all(ids.map((id) => get<GmailMessage>(`messages/${id}?${listed}`)))).flatMap((message) => (message ? [item(message)] : []));
  const driver: Driver = {
    start: async () => String((await get<{ historyId: string }>("profile"))?.historyId ?? ""),
    // New inbox mail since the cursor, a mailbox history id. An expired one starts again.
    async since(cursor) {
      const page = await get<{ history?: { id: string; messagesAdded?: { message: GmailMessage }[] }[]; historyId: string; nextPageToken?: string }>(
        `history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&labelId=INBOX&maxResults=200`,
      );
      if (!page) return null;
      const added = [...new Map((page.history ?? []).flatMap((entry) => entry.messagesAdded ?? []).map(({ message }) => [message.id, message])).values()].filter((message) => message.labelIds?.includes("INBOX"));
      const envelopes = await Promise.all(added.slice(0, 200).map((message) => get<GmailMessage>(`messages/${message.id}?${metadata(["From", "Message-ID"])}`)));
      return {
        cursor: page.nextPageToken ? String(page.history?.at(-1)?.id ?? page.historyId) : String(page.historyId),
        mail: envelopes.flatMap((message) =>
          message
            ? [{ uid: 0, ref: message.id, messageId: nameOf("gmail", message.id, "inbox", header(message.payload?.headers, "Message-ID")), threadId: message.threadId, from: emails(header(message.payload?.headers, "From"))[0] ?? "", receivedAt: new Date(Number(message.internalDate) || Date.now()).toISOString() }]
            : [],
        ),
      };
    },
    raw: async (ref) => {
      const message = await get<GmailMessage>(`messages/${ref}?format=raw`);
      return message?.raw ? Buffer.from(message.raw, "base64url") : null;
    },
    find: async (box, messageId) => (searchable(messageId) ? (await search(`${box === "sent" ? "in:sent " : ""}rfc822msgid:${bare(messageId)}`, 1))[0] ?? null : null),
    head: async (ref) => (await heads([ref]))[0] ?? null,
    async heads(box, ask) {
      const terms = [
        ...(ask.ids ? [] : [`in:${box}`]),
        ...(ask.q ? [quoted(ask.q)] : []),
        ...(ask.to?.length ? [`{${ask.to.map((to) => `to:${to}`).join(" ")}}`] : []),
        ...(ask.since ? [`after:${Math.floor(Date.parse(ask.since) / 1000)}`] : []),
        ...(ask.before ? [`before:${Math.floor(Date.parse(ask.before) / 1000)}`] : []),
      ];
      const queries = ask.ids ? chunks(ask.ids.filter(searchable), 40).map((ids) => [...terms, `{${ids.map((id) => `rfc822msgid:${bare(id)}`).join(" ")}}`].join(" ")) : [terms.join(" ")];
      const found = [...new Set((await Promise.all(queries.map((q) => search(q, ask.limit)))).flat())].slice(0, ask.limit);
      return heads(found);
    },
    async thread(ref) {
      const message = await get<GmailMessage>(`messages/${ref}?format=minimal`);
      const thread = message && (await get<{ messages?: GmailMessage[] }>(`threads/${message.threadId}?${listed}`));
      return (thread?.messages ?? []).filter((entry) => !entry.labelIds?.some((label) => ["DRAFT", "SPAM", "TRASH"].includes(label))).map(item);
    },
    // A reply joins the conversation in the firm's Gmail too.
    async send(mail, raw) {
      const parent = mail.inReplyTo ? await driver.find("inbox", mail.inReplyTo) : null;
      const threadId = parent ? (await get<GmailMessage>(`messages/${parent}?format=minimal`))?.threadId : undefined;
      await call(mailbox, `${api}/messages/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw: raw.toString("base64url"), ...(threadId && { threadId }) }) });
    },
  };
  return driver;
}

type GraphAddress = { emailAddress?: { address?: string } };
type GraphMessage = { id: string; internetMessageId?: string; conversationId?: string; parentFolderId?: string; from?: GraphAddress; toRecipients?: GraphAddress[]; ccRecipients?: GraphAddress[]; subject?: string; bodyPreview?: string; receivedDateTime?: string; sentDateTime?: string; internetMessageHeaders?: Header[] };
function outlook(mailbox: ApiMailbox): Driver {
  const api = "https://graph.microsoft.com/v1.0/me";
  const get = <T,>(path: string) => json<T>(mailbox, `${api}/${path}`);
  const folder = (box: Box) => (box === "sent" ? "sentitems" : "inbox");
  const fields = "id,internetMessageId,conversationId,parentFolderId,from,toRecipients,ccRecipients,subject,bodyPreview,receivedDateTime,sentDateTime";
  const select = (box: Box) => `$select=${fields}${box === "sent" ? ",internetMessageHeaders" : ""}`;
  const odata = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const item = (message: GraphMessage, box: Box): Item => ({
    ref: message.id,
    box,
    messageId: nameOf("outlook", message.id, box, message.internetMessageId, header(message.internetMessageHeaders, "X-InboxCA-Id")),
    from: message.from?.emailAddress?.address?.toLowerCase() ?? "",
    to: [...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])].map((entry) => entry.emailAddress?.address?.toLowerCase() ?? "").filter(Boolean),
    date: (box === "sent" ? message.sentDateTime : message.receivedDateTime) ?? new Date(0).toISOString(),
    subject: message.subject ?? "",
    snippet: snippet(message.bodyPreview ?? ""),
  });
  const list = async (path: string, box: Box) => ((await get<{ value?: GraphMessage[] }>(path))?.value ?? []).map((message) => item(message, box));
  const short = (id: string) => createHash("sha256").update(id).digest("base64url").slice(0, 12);
  return {
    start: async () => `${iso(new Date().toISOString())}|`,
    async since(cursor) {
      const page = await get<{ value?: GraphMessage[] }>(`mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${cursor.split("|")[0]}`)}&$orderby=receivedDateTime asc&$top=200&$select=id,internetMessageId,conversationId,from,receivedDateTime`);
      const read = byTime(cursor, (page?.value ?? []).map((message) => ({ message, id: short(message.id), at: message.receivedDateTime ?? "" })));
      return {
        cursor: read.cursor,
        mail: read.fresh.map(({ message }) => ({ uid: 0, ref: message.id, messageId: nameOf("outlook", message.id, "inbox", message.internetMessageId), threadId: message.conversationId ?? "", from: message.from?.emailAddress?.address?.toLowerCase() ?? "", receivedAt: message.receivedDateTime ?? new Date().toISOString() })),
      };
    },
    raw: async (ref, cap) => {
      const response = await call(mailbox, `${api}/messages/${ref}/$value`);
      return response && capped(response, cap);
    },
    // Mail moved out of the inbox is still found, as Gmail finds it.
    find: async (box, messageId) =>
      (await get<{ value?: { id: string }[] }>(`${box === "sent" ? "mailFolders/sentitems/" : ""}messages?$filter=${encodeURIComponent(`internetMessageId eq ${odata(messageId)}`)}&$select=id&$top=1`))?.value?.[0]?.id ?? null,
    head: async (ref, box) => {
      const message = await get<GraphMessage>(`messages/${ref}?${select(box)}`);
      return message && item(message, box);
    },
    async heads(box, ask) {
      // Microsoft's search cannot be joined with a filter, so a search reads its matches.
      if (ask.q) return list(`mailFolders/${folder(box)}/messages?$search=${encodeURIComponent(quoted(ask.q))}&$top=${ask.ids ? 250 : ask.limit}&${select(box)}`, box);
      if (ask.ids) return (await Promise.all(chunks(ask.ids, 10).map((ids) => list(`messages?$filter=${encodeURIComponent(ids.map((id) => `internetMessageId eq ${odata(id)}`).join(" or "))}&$top=10&${select(box)}`, box)))).flat();
      const field = box === "sent" ? "sentDateTime" : "receivedDateTime";
      const filter = [`${field} ge ${ask.since ? iso(ask.since) : "1900-01-01T00:00:00Z"}`, ...(ask.before ? [`${field} lt ${iso(ask.before)}`] : [])].join(" and ");
      return list(`mailFolders/${folder(box)}/messages?$filter=${encodeURIComponent(filter)}&$orderby=${field} desc&$top=${ask.limit}&${select(box)}`, box);
    },
    async thread(ref) {
      const opened = await get<GraphMessage>(`messages/${ref}?$select=conversationId`);
      if (!opened?.conversationId) return [];
      const [found, inbox, sent] = await Promise.all([
        get<{ value?: GraphMessage[] }>(`messages?$filter=${encodeURIComponent(`conversationId eq ${odata(opened.conversationId)}`)}&$top=50&$select=${fields},internetMessageHeaders`),
        get<{ id: string }>("mailFolders/inbox?$select=id"),
        get<{ id: string }>("mailFolders/sentitems?$select=id"),
      ]);
      return (found?.value ?? []).flatMap((message) => (message.parentFolderId === sent?.id ? [item(message, "sent")] : message.parentFolderId === inbox?.id ? [item(message, "inbox")] : []));
    },
    // The whole message as written, so its Message-ID, In-Reply-To and References go too;
    // Microsoft keeps the copy in Sent Items.
    async send(_mail, raw) {
      await call(mailbox, `${api}/sendMail`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: raw.toString("base64") });
    },
  };
}

type ZohoRow = { messageId: string; folderId: string; threadId?: string; fromAddress?: string; toAddress?: string; ccAddress?: string; subject?: string; summary?: string; receivedTime?: string; sentDateInGMT?: string; size?: string };
function zoho(mailbox: ApiMailbox): Driver {
  const { domain = "https://mail.zoho.in", account = "", inbox = "", sent = "" } = mailbox.settings;
  const api = `${domain}/api/accounts/${account}`;
  const get = async <T,>(path: string) => (await json<{ data?: T }>(mailbox, `${api}/${path}`))?.data ?? null;
  const post = <T,>(path: string, body: BodyInit, type = "application/json") => json<{ data?: T }>(mailbox, `${api}/${path}`, { method: "POST", headers: { "Content-Type": type }, body });
  const item = (row: ZohoRow, threadId = row.threadId ?? ""): Item => {
    const box = row.folderId === sent ? "sent" : "inbox";
    const ref = `${row.folderId}:${row.messageId}:${threadId}`;
    return {
      ref,
      size: Number(row.size) || undefined,
      box,
      messageId: `zoho:${ref}`,
      from: emails(row.fromAddress)[0] ?? "",
      to: emails(`${row.toAddress ?? ""} ${row.ccAddress ?? ""}`),
      date: new Date(Number(box === "sent" ? row.sentDateInGMT || row.receivedTime : row.receivedTime) || 0).toISOString(),
      subject: unescape(row.subject ?? ""),
      snippet: snippet(unescape(row.summary ?? "")),
    };
  };
  const view = async (query: string) => (await get<ZohoRow[]>(`messages/view?${query}&includeto=true`)) ?? [];
  const driver: Driver = {
    start: async () => `${Date.now()}|`,
    // The newest inbox mail, newest first, back to the cursor's time (at most 1,000).
    async since(cursor) {
      const after = cursor.split("|")[0];
      const rows: ZohoRow[] = [];
      for (let start = 1; start < 1000; start += 200) {
        const page = await view(`folderId=${inbox}&start=${start}&limit=200&sortorder=false`);
        rows.push(...page.filter((row) => (row.receivedTime ?? "") >= after));
        if (page.length < 200 || (page.at(-1)?.receivedTime ?? "") < after) break;
      }
      const read = byTime(cursor, rows.map((row) => ({ row, id: row.messageId, at: row.receivedTime ?? "" })));
      return {
        cursor: read.cursor,
        mail: read.fresh.map(({ row }) => {
          const { ref, messageId, from } = item(row);
          return { uid: 0, ref, messageId, threadId: row.threadId ?? "", from, receivedAt: new Date(Number(row.receivedTime)).toISOString() };
        }),
      };
    },
    raw: async (ref) => {
      const message = await get<{ content?: string }>(`messages/${ref.split(":")[1]}/originalmessage`);
      return message?.content ? Buffer.from(message.content) : null;
    },
    find: async () => null,
    head: async (ref) => {
      const [folderId, messageId, threadId] = ref.split(":");
      const row = await get<ZohoRow>(`folders/${folderId}/messages/${messageId}/details`);
      return row && item({ ...row, folderId, messageId }, threadId);
    },
    async heads(box, ask) {
      const folderId = box === "sent" ? sent : inbox;
      // A search names a message as the asked name that has its folder and message ids.
      const asked = new Map(ask.ids?.map((id) => [id.split(":").slice(0, 3).join(":"), id]));
      if (ask.q)
        return ((await get<ZohoRow[]>(`messages/search?searchKey=${encodeURIComponent(`entire:${ask.q}`)}&limit=200&includeto=true`)) ?? [])
          .filter((row) => row.folderId === folderId)
          .map((row) => item(row))
          .map((found) => ({ ...found, messageId: asked.get(found.messageId.split(":").slice(0, 3).join(":")) ?? found.messageId }));
      if (ask.ids) return (await Promise.all(ask.ids.flatMap((id) => (native("zoho", id) ? [driver.head(native("zoho", id)!, box)] : [])))).flatMap((found) => (found ? [found] : []));
      return (await view(`folderId=${folderId}&start=1&limit=${Math.min(200, ask.limit)}&sortorder=false`)).map((row) => item(row));
    },
    async thread(ref) {
      const threadId = ref.split(":")[2];
      return threadId ? (await view(`folderId=${inbox}&threadId=${threadId}&includesent=true&limit=50`)).map((row) => item(row)) : [];
    },
    // Zoho's API writes the message itself: a reply answers the message it names, files go up
    // first, and Zoho chooses the Message-ID.
    async send(mail) {
      const attachments = await Promise.all((mail.attachments ?? []).map(async (file) => (await post<{ storeName: string; attachmentPath: string; attachmentName: string }>(`messages/attachments?fileName=${encodeURIComponent(file.filename)}`, new Blob([new Uint8Array(file.content)]), "application/octet-stream"))?.data));
      const parent = mail.inReplyTo && native("zoho", mail.inReplyTo)?.split(":")[1];
      await post(parent ? `messages/${parent}` : "messages", JSON.stringify({
        ...(parent && { action: "reply" }),
        fromAddress: emails(mail.from)[0],
        toAddress: mail.to,
        subject: mail.subject,
        content: mail.text,
        mailFormat: "plaintext",
        ...(attachments.length && { attachments }),
      }));
    },
  };
  return driver;
}

const drivers: Record<MailApi, (mailbox: ApiMailbox) => Driver> = { gmail, outlook, zoho };

async function guard<T>(work: () => Promise<T>): Promise<T | { error: "sign_in" | "server" }> {
  try {
    return await work();
  } catch (error) {
    return { error: (error as { code?: string }).code === "EAUTH" ? ("sign_in" as const) : ("server" as const) };
  }
}
const view =({ box, messageId, from, to, date, subject, snippet }: MailItem): MailItem => ({ box, messageId, from, to, date, subject, snippet });

// What InboxCA keeps of a mailbox when it connects: its address, the provider's ids for
// it, and where reading starts, the next new message (no backfill).
export async function apiAccount(provider: MailApi, token: string, settings: ApiSettings) {
  const mailbox = { provider, token, settings };
  if (provider === "gmail") {
    const profile = await json<{ emailAddress: string; historyId: string }>(mailbox, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
    return { address: profile?.emailAddress ?? "", settings, cursor: String(profile?.historyId ?? "") };
  }
  if (provider === "outlook") {
    const me = await json<{ mail?: string; userPrincipalName?: string }>(mailbox, "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName");
    return { address: me?.mail ?? me?.userPrincipalName ?? "", settings, cursor: await outlook(mailbox).start() };
  }
  const api = `${settings.domain}/api/accounts`;
  const own = (await json<{ data?: { accountId: string; type?: string; primaryEmailAddress?: string }[] }>(mailbox, api))?.data?.find((entry) => entry.type !== "IMAP_ACCOUNT");
  const folders = own && (await json<{ data?: { folderId: string; folderType?: string; path?: string }[] }>(mailbox, `${api}/${own.accountId}/folders`))?.data;
  return {
    address: own?.primaryEmailAddress ?? "",
    settings: { ...settings, account: own?.accountId, inbox: folders?.find((entry) => entry.path === "/Inbox")?.folderId ?? folders?.find((entry) => entry.folderType === "Inbox")?.folderId, sent: folders?.find((entry) => entry.folderType === "Sent")?.folderId },
    cursor: `${Date.now()}|`,
  };
}

export function readNewMail(mailbox: ApiMailbox, cursor: string | null, keep: (mail: NewMail[]) => Promise<NewMail[]>) {
  return guard(async () => {
    const driver = drivers[mailbox.provider](mailbox);
    const read = (cursor && (await driver.since(cursor))) || { cursor: await driver.start(), mail: [] };
    const kept: (NewMail & { content: MailContent })[] = [];
    for (const mail of (read.mail.length ? await keep(read.mail) : []) as (NewMail & { ref: string })[]) {
      const raw = await driver.raw(mail.ref);
      const parsed = raw ? await simpleParser(raw) : null;
      kept.push({ ...mail, content: { subject: parsed?.subject ?? "", text: parsed?.text ?? "", attachments: parsed?.attachments.map((file) => file.filename ?? "").filter(Boolean) ?? [] } });
    }
    return { cursor: read.cursor, mail: kept };
  });
}

export function readAttachments(mailbox: ApiMailbox, messageId: string) {
  return guard(async () => {
    const driver = drivers[mailbox.provider](mailbox);
    const ref = native(mailbox.provider, messageId) ?? (await driver.find("inbox", messageId));
    const raw = ref ? await driver.raw(ref) : null;
    const parsed = raw ? await simpleParser(raw) : null;
    return {
      subject: parsed?.subject ?? "",
      text: parsed?.text ?? "",
      files: (parsed?.attachments ?? []).filter((file) => !file.related).map((file) => ({ name: file.filename ?? "", bytes: new Uint8Array(file.content) })),
    };
  });
}

// The Inbox page's live reads, as over IMAP: only the asked inbox messages, and the newest
// sent ones that match.
export function listMail(mailbox: ApiMailbox, ask: ListAsk) {
  return guard(async () => {
    const driver = drivers[mailbox.provider](mailbox);
    const ids = new Set(ask.inbox);
    const inbox = ask.inbox.length ? (await driver.heads("inbox", { ids: ask.q ? ask.inbox : ask.inbox.slice(0, mailLimits.sent), q: ask.q, limit: 100 })).filter((item) => ids.has(item.messageId)) : [];
    const want = ask.sent;
    const to = want?.to?.map((address) => address.toLowerCase());
    const sent = want
      ? (await driver.heads("sent", { q: ask.q, to, since: want.since, before: want.before, limit: to || want.reminders ? 100 : want.limit }))
          .filter((item) => (!want.since || Date.parse(item.date) >= Date.parse(want.since)) && (!want.before || Date.parse(item.date) < Date.parse(want.before)) && (!to || item.to.some((address) => to.includes(address))) && (!want.reminders || /^<reminder-/.test(item.messageId)))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, want.limit)
      : null;
    return { inbox: inbox.map(view), sent: sent?.map(view) ?? null };
  });
}

// One message and its conversation in the inbox and Sent, oldest first. Each message's text
// is read from its first megabyte.
export function readThread(mailbox: ApiMailbox, ask: ThreadAsk) {
  return guard(async () => {
    const driver = drivers[mailbox.provider](mailbox);
    const ref = native(mailbox.provider, ask.messageId) ?? (await driver.find(ask.box, ask.messageId)) ?? (ask.box === "sent" ? (await driver.heads("sent", { limit: 50 })).find((item) => item.messageId === ask.messageId)?.ref : null);
    if (!ref) return { messages: [] as MailMessage[] };
    const thread = await driver.thread(ref);
    const opened = thread.find((item) => item.ref === ref) ?? (await driver.head(ref, ask.box));
    // Only the asked message opens its conversation, as over IMAP.
    if (opened?.messageId !== ask.messageId) return { messages: [] as MailMessage[] };
    const items = [{ ...opened, box: ask.box }, ...thread.filter((item) => item.ref !== ref).sort((a, b) => a.date.localeCompare(b.date)).slice(1 - mailLimits.thread)];
    const messages = await Promise.all(
      items.map(async (item): Promise<MailMessage> => {
        const raw = (item.size ?? 0) <= 1_000_000 ? await driver.raw(item.ref, 1_000_000) : null;
        const parsed = raw ? await simpleParser(raw).catch(() => null) : null;
        const text = (parsed?.text ?? item.snippet).slice(0, mailLimits.text);
        const references = parsed?.references ?? [];
        return { ...view(item), snippet: snippet(text), inReplyTo: parsed?.inReplyTo ?? "", references: typeof references === "string" ? [references] : references, text, attachments: parsed?.attachments.filter((file) => !file.related).map((file) => file.filename ?? "").filter(Boolean) ?? [] };
      }),
    );
    return { messages: messages.sort((a, b) => a.date.localeCompare(b.date)) };
  });
}

// Whether a message InboxCA sent is in Sent, by its Message-ID or its X-InboxCA-Id. Zoho's
// API keeps neither, so a send there that may have happened is never repeated blindly.
export async function foundInSent(mailbox: ApiMailbox, messageId: string) {
  if (mailbox.provider === "zoho") throw new Error("sent_not_read");
  try {
    const driver = drivers[mailbox.provider](mailbox);
    return !!(await driver.find("sent", messageId)) || (await driver.heads("sent", { limit: 50 })).some((item) => item.messageId === messageId);
  } catch {
    throw new Error("sent_not_read");
  }
}

// Sends from the firm's address; the provider keeps the copy in Sent.
export async function sendMail(mailbox: ApiMailbox, mail: Mail) {
  const raw = mailbox.provider === "zoho" ? Buffer.alloc(0) : ((await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({ ...mail, ...(mail.messageId && { headers: { "X-InboxCA-Id": mail.messageId } }) })).message as Buffer);
  await drivers[mailbox.provider](mailbox).send(mail, raw);
}
