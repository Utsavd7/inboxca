import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

// A fake of each mail provider InboxCA signs in to: the sign in page and token endpoints of
// Google, Microsoft and Zoho, and the parts of the Gmail, Microsoft Graph and Zoho Mail APIs
// InboxCA calls, over one invented mailbox kept in memory. InboxCA reaches it through
// MAIL_API_TEST_URL (with MAIL_ALLOW_LOCAL), so no test touches the internet. Like Gmail's
// API, the fake Gmail gives mail sent through it a Message-ID of its own.
type Box = "inbox" | "sent";
type Message = { id: string; box: Box; raw: string; at: number; thread: string; history: number; messageId: string; inReplyTo: string; from: string; to: string[]; subject: string; text: string };
type Provider = "gmail" | "outlook" | "zoho";
export const fakeKeys = { gmail: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], outlook: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], zoho: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"] } as const;
export const fakeKeyValues = Object.fromEntries(Object.entries(fakeKeys).flatMap(([provider, [id, secret]]) => [[id, `test-${provider}-client`], [secret, `test-${provider}-secret`]]));

export function fakeMail() {
  const mailbox = {
    address: "office@invented.test",
    messages: [] as Message[],
    // What a test can read back: each send as the provider received it, and revoked tokens.
    sends: [] as { provider: Provider; raw: string; json?: Record<string, unknown>; parent?: string }[],
    revoked: [] as string[],
    refreshes: 0,
    // What the provider's sign in page does: allow, or come back with an error.
    answer: "allow" as "allow" | "deny",
  };
  const codes = new Map<string, { provider: Provider; challenge: string; redirect: string }>();
  const access = new Map<string, Provider>();
  const refresh = new Map<string, Provider>();
  let history = 1;
  let next = 1_000_000;
  // Each message a second after the last, as Microsoft keeps times to the second.
  let clock = 0;
  const uploads = new Map<string, Buffer>();

  const root = (inReplyTo: string) => mailbox.messages.find((message) => message.messageId === inReplyTo)?.thread;
  async function keep(box: Box, raw: string) {
    const parsed = await simpleParser(raw);
    const id = String(next++);
    const messageId = parsed.messageId ?? `<fake-${id}@invented.test>`;
    const to = [parsed.to, parsed.cc].flatMap((list) => (Array.isArray(list) ? list : list ? [list] : [])).flatMap((list) => list.value.map((entry) => entry.address?.toLowerCase() ?? ""));
    const message: Message = { id, box, raw, at: (clock = Math.max(Date.now(), clock + 1000)), thread: root(parsed.inReplyTo ?? "") ?? id, history: box === "inbox" ? ++history : history, messageId, inReplyTo: parsed.inReplyTo ?? "", from: parsed.from?.value[0]?.address?.toLowerCase() ?? "", to, subject: parsed.subject ?? "", text: parsed.text ?? "" };
    mailbox.messages.push(message);
    return message;
  }
  const compose = async (mail: Parameters<ReturnType<typeof nodemailer.createTransport>["sendMail"]>[0]) =>
    String((await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(mail)).message);

  // Test helpers: mail that arrives in the inbox, or that the firm sent from elsewhere.
  const deliver = async (mail: Parameters<typeof compose>[0], box: Box = "inbox") => keep(box, await compose({ to: mailbox.address, date: new Date(), ...mail }));

  const header = (message: Message, name: string) => message.raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).find((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim() ?? "";
  const matches = (message: Message, text: string) => `${message.subject} ${message.text} ${message.from} ${message.to.join(" ")}`.toLowerCase().includes(text.toLowerCase());
  const newest = (list: Message[]) => [...list].sort((a, b) => b.at - a.at || Number(b.id) - Number(a.id));
  const json = (value: unknown, status = 200) => ({ status, body: JSON.stringify(value), type: "application/json" });

  // Gmail's search: in:, rfc822msgid:, to:, after:, before:, a quoted phrase, and {a b} for any of.
  function gmailQuery(q: string) {
    const term = (word: string): ((message: Message) => boolean) => {
      if (word.startsWith("{")) {
        const parts = word.slice(1, -1).split(" ").filter(Boolean).map(term);
        return (message) => parts.some((part) => part(message));
      }
      const [key, value = ""] = word.split(/:(.*)/);
      if (word.startsWith('"')) return (message) => matches(message, word.slice(1, -1).trim());
      if (key === "in") return (message) => message.box === value;
      if (key === "rfc822msgid") return (message) => message.messageId.replace(/^<|>$/g, "") === value;
      if (key === "to") return (message) => message.to.includes(value.toLowerCase());
      if (key === "after") return (message) => message.at >= Number(value) * 1000;
      if (key === "before") return (message) => message.at < Number(value) * 1000;
      return (message) => matches(message, word);
    };
    const words = q.match(/\{[^}]*\}|"[^"]*"|\S+/g) ?? [];
    return (message: Message) => words.every((word) => term(word)(message));
  }
  const gmailJson = (message: Message, format: string, names: string[]) => ({
    id: message.id,
    threadId: message.thread,
    labelIds: [message.box === "sent" ? "SENT" : "INBOX"],
    ...(format !== "minimal" && { snippet: message.text.slice(0, 100).replace(/'/g, "&#39;"), internalDate: String(message.at), sizeEstimate: message.raw.length, historyId: String(message.history) }),
    ...(format === "raw" && { raw: Buffer.from(message.raw).toString("base64url") }),
    ...(format === "metadata" && { payload: { headers: names.map((name) => ({ name, value: header(message, name) })).filter((entry) => entry.value) } }),
  });

  // Microsoft Graph's $filter for what InboxCA asks: field eq|ge|lt value, joined by and/or.
  function graphFilter(filter: string) {
    const value = (message: Message, field: string) =>
      field === "internetMessageId" ? message.messageId : field === "conversationId" ? message.thread : new Date(message.at).toISOString().replace(/\.\d+Z$/, "Z");
    const clause = (text: string) => {
      const [, field, op, raw] = text.trim().match(/^(\w+) (eq|ge|lt) (.+)$/) ?? [];
      const wanted = raw?.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
      return (message: Message) => (op === "eq" ? value(message, field) === wanted : op === "ge" ? value(message, field) >= wanted : value(message, field) < wanted);
    };
    const all = filter.split(" and ").map((part) => part.split(" or ").map(clause));
    return (message: Message) => all.every((any) => any.some((test) => test(message)));
  }
  const graphJson = (message: Message, select: string) => ({
    id: message.id,
    internetMessageId: message.messageId,
    conversationId: message.thread,
    parentFolderId: message.box === "sent" ? "folder-sent" : "folder-inbox",
    from: { emailAddress: { address: message.from } },
    toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
    ccRecipients: [],
    subject: message.subject,
    bodyPreview: message.text.slice(0, 255),
    receivedDateTime: new Date(message.at).toISOString().replace(/\.\d+Z$/, "Z"),
    sentDateTime: new Date(message.at).toISOString().replace(/\.\d+Z$/, "Z"),
    ...(select.includes("internetMessageHeaders") && { internetMessageHeaders: [{ name: "X-InboxCA-Id", value: header(message, "X-InboxCA-Id") }].filter((entry) => entry.value) }),
  });

  const zohoFolder = (box: Box) => (box === "sent" ? "f-sent" : "f-inbox");
  const zohoJson = (message: Message) => ({
    messageId: message.id,
    folderId: zohoFolder(message.box),
    threadId: message.thread,
    fromAddress: message.from,
    toAddress: message.to.map((address) => `&quot;${address.split("@")[0]}&quot;&lt;${address}&gt;`).join(","),
    ccAddress: "Not Provided",
    subject: message.subject,
    summary: message.text.slice(0, 100),
    receivedTime: String(message.at),
    sentDateInGMT: String(message.at),
    size: String(message.raw.length),
  });

  async function answer(method: string, url: URL, headers: Record<string, string | string[] | undefined>, body: Buffer): Promise<{ status: number; body?: string; type?: string; location?: string }> {
    const path = url.pathname;
    const query = url.searchParams;
    const form = new URLSearchParams(body.toString());
    const provider: Provider | null = path.includes("google") || path.includes("gmail") ? "gmail" : path.includes("microsoft") ? "outlook" : path.includes("zoho") ? "zoho" : null;
    if (!provider) return { status: 404 };

    // Sign in pages: they answer at once, as if the owner pressed Allow.
    if (/\/(o\/oauth2\/v2\/auth|oauth2\/v2\.0\/authorize|oauth\/v2\/auth)$/.test(path)) {
      const redirect = query.get("redirect_uri") ?? "";
      if (query.get("client_id") !== `test-${provider}-client` || query.get("code_challenge_method") !== "S256" || !query.get("code_challenge")) return { status: 400 };
      const back = new URL(redirect);
      back.searchParams.set("state", query.get("state") ?? "");
      if (mailbox.answer === "deny") back.searchParams.set("error", "access_denied");
      else {
        const code = randomUUID();
        codes.set(code, { provider, challenge: query.get("code_challenge")!, redirect });
        back.searchParams.set("code", code);
        if (provider === "zoho") back.searchParams.set("accounts-server", "https://accounts.zoho.in");
      }
      return { status: 302, location: back.toString() };
    }
    if (path.endsWith("/v2.0/adminconsent")) {
      const back = new URL(query.get("redirect_uri") ?? "");
      back.searchParams.set("admin_consent", "True");
      back.searchParams.set("state", query.get("state") ?? "");
      return { status: 302, location: back.toString() };
    }
    if (/\/(token|oauth2\/v2\.0\/token|oauth\/v2\/token)$/.test(path) && method === "POST") {
      const refused = provider === "zoho" ? json({ error: "invalid_code" }) : json({ error: "invalid_grant" }, 400);
      if (form.get("client_id") !== `test-${provider}-client` || form.get("client_secret") !== `test-${provider}-secret`) return refused;
      let refreshToken: string | undefined;
      if (form.get("grant_type") === "authorization_code") {
        const asked = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        if (!asked || asked.provider !== provider || asked.redirect !== form.get("redirect_uri") || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== asked.challenge) return refused;
        refreshToken = `refresh-${randomUUID()}`;
      } else {
        const old = form.get("refresh_token") ?? "";
        if (refresh.get(old) !== provider) return refused;
        mailbox.refreshes++;
        // Microsoft gives a new refresh token each time; the old one keeps working.
        if (provider === "outlook") refreshToken = `refresh-${randomUUID()}`;
      }
      if (refreshToken) refresh.set(refreshToken, provider);
      const token = `access-${randomUUID()}`;
      access.set(token, provider);
      return json({ access_token: token, expires_in: 3600, ...(refreshToken && { refresh_token: refreshToken }) });
    }
    if (path.endsWith("/revoke") && method === "POST") {
      const token = query.get("token") ?? "";
      if (!refresh.delete(token)) return { status: 400 };
      mailbox.revoked.push(token);
      return { status: 200, body: "{}" };
    }

    const auth = String(headers.authorization ?? "").split(" ")[1] ?? "";
    if (access.get(auth) !== provider) return json({ error: "unauthorized" }, 401);

    if (provider === "gmail") {
      const api = path.replace(/^\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\//, "");
      const names = query.getAll("metadataHeaders");
      if (api === "profile") return json({ emailAddress: mailbox.address, historyId: String(history) });
      if (api === "history") {
        const start = Number(query.get("startHistoryId"));
        if (!start) return { status: 404 };
        const added = mailbox.messages.filter((message) => message.box === "inbox" && message.history > start);
        return json({ history: added.map((message) => ({ id: String(message.history), messagesAdded: [{ message: gmailJson(message, "minimal", []) }] })), historyId: String(history) });
      }
      if (api === "messages" && method === "GET") {
        const found = newest(mailbox.messages.filter(gmailQuery(query.get("q") ?? ""))).slice(0, Number(query.get("maxResults") ?? 100));
        return json(found.length ? { messages: found.map((message) => ({ id: message.id, threadId: message.thread })) } : { resultSizeEstimate: 0 });
      }
      if (api === "messages/send" && method === "POST") {
        const sent = JSON.parse(body.toString()) as { raw: string; threadId?: string };
        const raw = Buffer.from(sent.raw, "base64url").toString().replace(/^Message-ID: .*$/im, `Message-ID: <gmail-${randomUUID()}@mail.gmail.com>`);
        mailbox.sends.push({ provider, raw, json: sent });
        const message = await keep("sent", raw);
        if (sent.threadId) message.thread = sent.threadId;
        return json({ id: message.id, threadId: message.thread });
      }
      const one = api.match(/^messages\/(\d+)$/)?.[1];
      const message = mailbox.messages.find((entry) => entry.id === one);
      if (message) return json(gmailJson(message, query.get("format") ?? "full", names));
      const thread = api.match(/^threads\/(\d+)$/)?.[1];
      if (thread) return json({ id: thread, messages: mailbox.messages.filter((entry) => entry.thread === thread).map((entry) => gmailJson(entry, query.get("format") ?? "full", names)) });
      return { status: 404 };
    }

    if (provider === "outlook") {
      const api = path.replace(/^\/graph\.microsoft\.com\/v1\.0\/me\/?/, "");
      const select = query.get("$select") ?? "";
      if (api === "") return json({ mail: mailbox.address, userPrincipalName: mailbox.address });
      if (api === "sendMail" && method === "POST") {
        if (!String(headers["content-type"]).startsWith("text/plain")) return { status: 400 };
        const raw = Buffer.from(body.toString(), "base64").toString();
        mailbox.sends.push({ provider, raw });
        await keep("sent", raw);
        return { status: 202 };
      }
      const folder = api.match(/^mailFolders\/(inbox|sentitems)$/)?.[1];
      if (folder) return json({ id: folder === "inbox" ? "folder-inbox" : "folder-sent" });
      const listed = api.match(/^(?:mailFolders\/(inbox|sentitems)\/)?messages$/);
      if (listed) {
        const box = listed[1] === "sentitems" ? "sent" : listed[1] === "inbox" ? "inbox" : null;
        const search = query.get("$search")?.replace(/^"|"$/g, "").trim();
        let found = mailbox.messages.filter((message) => (!box || message.box === box) && (!search || matches(message, search)) && (!query.get("$filter") || graphFilter(query.get("$filter")!)(message)));
        found = query.get("$orderby")?.endsWith("asc") ? newest(found).reverse() : newest(found);
        return json({ value: found.slice(0, Number(query.get("$top") ?? 10)).map((message) => graphJson(message, select)) });
      }
      const [, id, value] = api.match(/^messages\/(\d+)(\/\$value)?$/) ?? [];
      const message = mailbox.messages.find((entry) => entry.id === id);
      if (message && value) return { status: 200, body: message.raw, type: "message/rfc822" };
      if (message) return json(graphJson(message, select));
      return { status: 404 };
    }

    const api = path.replace(/^\/mail\.zoho\.in\/api\/accounts\/?/, "");
    if (api === "") return json({ data: [{ accountId: "zoho-account", type: "ZOHO_ACCOUNT", primaryEmailAddress: mailbox.address }] });
    if (api === "zoho-account/folders") return json({ data: [{ folderId: "f-inbox", folderName: "Inbox", folderType: "Inbox", path: "/Inbox" }, { folderId: "f-sent", folderName: "Sent", folderType: "Sent", path: "/Sent" }, { folderId: "f-own", folderName: "Clients", folderType: "Inbox", path: "/Clients" }] });
    if (api === "zoho-account/messages/view") {
      const threadId = query.get("threadId");
      const found = newest(mailbox.messages.filter((message) => (threadId ? message.thread === threadId && (message.box === "inbox" || query.get("includesent") === "true") : zohoFolder(message.box) === query.get("folderId"))));
      const start = Number(query.get("start") ?? 1) - 1;
      return json({ data: found.slice(start, start + Number(query.get("limit") ?? 10)).map(zohoJson) });
    }
    if (api === "zoho-account/messages/search") {
      const key = query.get("searchKey") ?? "";
      return json({ data: newest(mailbox.messages.filter((message) => matches(message, key.replace(/^entire:/, "")))).slice(0, Number(query.get("limit") ?? 10)).map(zohoJson) });
    }
    if (api === "zoho-account/messages/attachments" && method === "POST") {
      const store = randomUUID();
      uploads.set(store, body);
      return json({ data: { storeName: store, attachmentPath: `/Mail/${store}`, attachmentName: query.get("fileName") } });
    }
    const details = api.match(/^zoho-account\/folders\/([\w-]+)\/messages\/(\d+)\/details$/);
    const original = api.match(/^zoho-account\/messages\/(\d+)\/originalmessage$/);
    const found = mailbox.messages.find((message) => message.id === (details?.[2] ?? original?.[1]));
    if (found && details) return json({ data: { ...zohoJson(found), threadId: undefined } });
    if (found && original) return json({ data: { messageId: found.id, content: found.raw } });
    const reply = api.match(/^zoho-account\/messages(?:\/(\d+))?$/);
    if (reply && method === "POST") {
      const sent = JSON.parse(body.toString()) as { fromAddress: string; toAddress: string; subject: string; content: string; action?: string; attachments?: { storeName: string; attachmentName: string }[] };
      const parent = mailbox.messages.find((message) => message.id === reply[1]);
      if (reply[1] && (!parent || sent.action !== "reply")) return { status: 400 };
      // Zoho writes the message and chooses its Message-ID.
      const raw = await compose({ from: sent.fromAddress, to: sent.toAddress, subject: sent.subject, text: sent.content, messageId: `<zoho-${randomUUID()}@zoho.in>`, ...(parent && { inReplyTo: parent.messageId, references: parent.messageId }), attachments: (sent.attachments ?? []).map((file) => ({ filename: file.attachmentName, content: uploads.get(file.storeName) })) });
      mailbox.sends.push({ provider, raw, json: sent, parent: reply[1] });
      await keep("sent", raw);
      return json({ status: { code: 200 }, data: {} });
    }
    return { status: 404 };
  }

  const reply = (method: string, url: URL, headers: Record<string, string | string[] | undefined>, body: Buffer) =>
    answer(method, url, headers, body).catch(() => ({ status: 500 }) as { status: number; body?: string; type?: string; location?: string });
  const replyHeaders = (found: { type?: string; location?: string }) => ({ ...(found.type && { "Content-Type": found.type }), ...(found.location && { Location: found.location }) });
  let server: ReturnType<typeof createServer> | null = null;
  return {
    mailbox,
    deliver,
    // Unit tests answer fetch in memory; the end to end tests listen on a port.
    async fetch(input: string | URL | Request, init?: RequestInit) {
      const request = new Request(input, init);
      const found = await reply(request.method, new URL(request.url), Object.fromEntries(request.headers), Buffer.from(await request.arrayBuffer()));
      return new Response(found.status === 202 ? null : (found.body ?? ""), { status: found.status, headers: replyHeaders(found) });
    },
    async listen(port = 0) {
      server = createServer(async (incoming, outgoing) => {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(chunk as Buffer);
        const found = await reply(incoming.method ?? "GET", new URL(incoming.url ?? "/", "http://fake"), incoming.headers, Buffer.concat(chunks));
        outgoing.writeHead(found.status, replyHeaders(found)).end(found.body ?? "");
      });
      await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    // A token that stops working, as when the owner removes InboxCA at the provider.
    forget: () => {
      access.clear();
      refresh.clear();
    },
    reset(address: string) {
      Object.assign(mailbox, { address, messages: [], sends: [], revoked: [], refreshes: 0, answer: "allow" });
    },
    close: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  };
}
