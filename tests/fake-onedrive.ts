import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { quickXorHash } from "../src/lib/onedrive-upload";

// A fake of Microsoft's sign in and of the parts of Microsoft Graph's drive API InboxCA calls,
// over one invented OneDrive kept in memory. InboxCA reaches it through ONEDRIVE_TEST_URL (with
// MAIL_ALLOW_LOCAL), so no test touches the internet. Like OneDrive it refuses a name already
// taken, keeps an item's id through renames and moves, takes big files in an upload session,
// and pages its listings and its change list (delta), here three items a page. Its watches for
// change notices are only kept, never sent, and the address is not checked.
export const fakeOneDriveKeys = { MS_DRIVE_CLIENT_ID: "test-onedrive-client", MS_DRIVE_CLIENT_SECRET: "test-onedrive-secret" };
type Item = { id: string; name: string; parent: string | null; bytes?: Buffer; hash?: string; modified: string };
type Watch = { id: string; changeType: string; resource: string; notificationUrl: string; lifecycleNotificationUrl?: string; expirationDateTime: string; clientState: string };
const PAGE = 3;

export function fakeOneDrive() {
  const drive = {
    id: `invented-drive-${randomUUID()}`,
    email: `owner-${randomUUID().slice(0, 8)}@invented.test`,
    items: new Map<string, Item>([["root", { id: "root", name: "root", parent: null, modified: "" }]]),
    // Shared with someone else, as when the owner shares InboxCA's folder in OneDrive.
    shared: false,
    remaining: 1024 ** 4 as number | undefined,
    // What a test can read back: the pieces each upload session was sent.
    pieces: [] as string[],
    // The watches for change notices (subscriptions) InboxCA made, by id.
    watches: new Map<string, Watch>(),
  };
  const codes = new Map<string, { challenge: string; redirect: string }>();
  const refresh = new Set<string>();
  const access = new Set<string>();
  const sessions = new Map<string, { parent: string; name: string; parts: Buffer[] }>();

  const child = (parent: string, name: string) => [...drive.items.values()].find((item) => item.parent === parent && item.name.toLowerCase() === name.toLowerCase());
  const walk = (parts: string[]) => parts.reduce<Item | undefined>((at, name) => at && child(at.id, name), drive.items.get("root"));
  const shown = (item: Item) => ({
    id: item.id,
    name: item.name,
    lastModifiedDateTime: item.modified,
    ...(item.parent && { parentReference: { id: item.parent } }),
    ...(item.id === "root" && { root: {} }),
    ...(item.bytes ? { size: item.bytes.length, file: { hashes: { quickXorHash: item.hash } } } : { folder: {} }),
  });
  async function put(parent: string, name: string, bytes?: Buffer) {
    if (child(parent, name)) return null;
    const item: Item = { id: `item-${randomUUID()}`, name, parent, modified: new Date().toISOString(), ...(bytes && { bytes, hash: await quickXorHash(new Blob([new Uint8Array(bytes)])) }) };
    drive.items.set(item.id, item);
    return item;
  }
  const paged = (all: unknown[], url: URL) => {
    const from = Number(url.searchParams.get("$skiptoken") ?? 0) || 0;
    const next = new URL(url);
    next.searchParams.set("$skiptoken", String(from + PAGE));
    return Response.json({ value: all.slice(from, from + PAGE), ...(from + PAGE < all.length && { "@odata.nextLink": next.toString() }) });
  };
  const taken = () => Response.json({ error: { code: "nameAlreadyExists" } }, { status: 409 });
  const missing = () => Response.json({ error: { code: "itemNotFound" } }, { status: 404 });

  async function answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.endsWith("/oauth2/v2.0/authorize")) {
      const asked = url.searchParams;
      if (asked.get("client_id") !== fakeOneDriveKeys.MS_DRIVE_CLIENT_ID || asked.get("code_challenge_method") !== "S256" || !asked.get("scope")?.includes("Files.ReadWrite")) return new Response(null, { status: 400 });
      const code = randomUUID();
      codes.set(code, { challenge: asked.get("code_challenge") ?? "", redirect: asked.get("redirect_uri") ?? "" });
      const back = new URL(asked.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", asked.get("state") ?? "");
      return Response.redirect(back.toString(), 302);
    }
    if (path.endsWith("/oauth2/v2.0/token")) {
      const form = new URLSearchParams(await request.text());
      const refused = Response.json({ error: "invalid_grant" }, { status: 400 });
      if (form.get("client_id") !== fakeOneDriveKeys.MS_DRIVE_CLIENT_ID || form.get("client_secret") !== fakeOneDriveKeys.MS_DRIVE_CLIENT_SECRET) return refused;
      if (form.get("grant_type") === "authorization_code") {
        const asked = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        if (!asked || asked.redirect !== form.get("redirect_uri") || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== asked.challenge) return refused;
      } else if (!refresh.has(form.get("refresh_token") ?? "")) return refused;
      // A new refresh token each time; the old one keeps working, as Microsoft's.
      const [accessToken, refreshToken] = [`access-${randomUUID()}`, `refresh-${randomUUID()}`];
      access.add(accessToken);
      refresh.add(refreshToken);
      return Response.json({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 });
    }
    // An upload session's own address: no sign in, the pieces in order.
    const upload = path.match(/^\/upload\/(.+)$/);
    if (upload && request.method === "PUT") {
      const session = sessions.get(upload[1]);
      const range = request.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!session || !range || request.headers.has("authorization")) return new Response(null, { status: 400 });
      const bytes = Buffer.from(await request.arrayBuffer());
      const had = session.parts.reduce((sum, part) => sum + part.length, 0);
      if (Number(range[1]) !== had || Number(range[2]) - Number(range[1]) + 1 !== bytes.length) return new Response(null, { status: 416 });
      session.parts.push(bytes);
      drive.pieces.push(range[0]);
      if (Number(range[2]) + 1 < Number(range[3])) return Response.json({ nextExpectedRanges: [`${Number(range[2]) + 1}-`] }, { status: 202 });
      sessions.delete(upload[1]);
      const item = await put(session.parent, session.name, Buffer.concat(session.parts));
      return item ? Response.json(shown(item), { status: 201 }) : taken();
    }
    const graph = path.match(/^\/graph\.microsoft\.com\/v1\.0\/(.+)$/)?.[1];
    if (!graph) return new Response(null, { status: 404 });
    if (!access.has(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")) return Response.json({ error: { code: "InvalidAuthenticationToken" } }, { status: 401 });
    if (graph === "me") return Response.json({ mail: drive.email, userPrincipalName: drive.email });
    if (graph === "me/drive") return Response.json({ id: drive.id, quota: { remaining: drive.remaining } });
    if (graph === "me/drive/root/delta") return paged([...drive.items.values()].map(shown), url);

    // Like Graph, one watch per resource and app, on an https address, for at most 42,300 minutes.
    const watch = graph.match(/^subscriptions(?:\/([^/]+))?$/);
    if (watch) {
      const asked = ["POST", "PATCH"].includes(request.method) ? ((await request.json()) as Partial<Watch>) : {};
      if (asked.expirationDateTime && !(Date.parse(asked.expirationDateTime) <= Date.now() + 42_300 * 60_000)) return Response.json({ error: { code: "InvalidRequest" } }, { status: 400 });
      if (!watch[1] && request.method === "GET") return Response.json({ value: [...drive.watches.values()] });
      if (!watch[1] && request.method === "POST") {
        if (asked.resource !== "me/drive/root" || asked.changeType !== "updated" || !asked.notificationUrl?.startsWith("https://") || !asked.clientState || !asked.expirationDateTime) return Response.json({ error: { code: "InvalidRequest" } }, { status: 400 });
        if ([...drive.watches.values()].some((kept) => kept.resource === asked.resource)) return Response.json({ error: { code: "ExtensionError" } }, { status: 409 });
        const made = { ...asked, id: randomUUID() } as Watch;
        drive.watches.set(made.id, made);
        return Response.json(made, { status: 201 });
      }
      const kept = drive.watches.get(decodeURIComponent(watch[1] ?? ""));
      if (!kept) return missing();
      if (request.method === "DELETE") return (drive.watches.delete(kept.id), new Response(null, { status: 204 }));
      if (request.method === "PATCH" && asked.expirationDateTime) return Response.json(Object.assign(kept, { expirationDateTime: asked.expirationDateTime }));
      return Response.json(kept);
    }

    const byId = graph.match(/^me\/drive\/items\/([^/]+)(\/content)?$/);
    if (byId) {
      const item = drive.items.get(decodeURIComponent(byId[1]));
      if (!item) return missing();
      if (byId[2]) return item.bytes ? new Response(new Uint8Array(item.bytes)) : missing();
      if (request.method === "DELETE") return drive.items.delete(item.id) ? new Response(null, { status: 204 }) : missing();
      if (request.method === "PATCH") {
        const change = (await request.json()) as { parentReference?: { id?: string }; name?: string };
        const parent = change.parentReference?.id ?? item.parent!;
        const name = change.name ?? item.name;
        if (!drive.items.has(parent)) return missing();
        if (url.searchParams.get("@microsoft.graph.conflictBehavior") === "fail" && child(parent, name) && child(parent, name) !== item) return taken();
        Object.assign(item, { parent, name });
        return Response.json(shown(item));
      }
      return Response.json(shown(item));
    }

    const byPath = graph.match(/^me\/drive\/root(?::\/([^:]+)(?::(\/\w+))?)?(\/\w+)?$/);
    if (!byPath) return new Response(null, { status: 404 });
    const parts = byPath[1] ? byPath[1].split("/").map(decodeURIComponent) : [];
    const then = byPath[2] ?? byPath[3] ?? "";
    const found = walk(parts);
    if (then === "/content" || then === "/createUploadSession") {
      const parent = walk(parts.slice(0, -1));
      const name = parts[parts.length - 1];
      if (!parent) return missing();
      if (child(parent.id, name)) return taken();
      if (then === "/createUploadSession") {
        const id = randomUUID();
        sessions.set(id, { parent: parent.id, name, parts: [] });
        return Response.json({ uploadUrl: `${url.origin}/upload/${id}` });
      }
      if (url.searchParams.get("@microsoft.graph.conflictBehavior") !== "fail") return new Response(null, { status: 400 });
      const item = await put(parent.id, name, Buffer.from(await request.arrayBuffer()));
      return item ? Response.json(shown(item), { status: 201 }) : taken();
    }
    if (!found) return missing();
    if (then === "/children" && request.method === "POST") {
      const asked = (await request.json()) as { name: string; folder?: object };
      const item = asked.folder && (await put(found.id, asked.name));
      return item ? Response.json(shown(item), { status: 201 }) : taken();
    }
    if (then === "/children") return paged([...drive.items.values()].filter((item) => item.parent === found.id).map(shown), url);
    if (then === "/permissions") return Response.json({ value: [{ id: "owner", roles: ["owner"] }, ...(drive.shared ? [{ id: "link", roles: ["read"], link: { type: "view" } }] : [])] });
    return then ? new Response(null, { status: 404 }) : Response.json(shown(found));
  }

  let server: Server | undefined;
  return {
    drive,
    // The file at a path below the drive's top, or undefined.
    file: (path: string) => walk(path.split("/").filter(Boolean)),
    // Unit tests answer fetch in memory; the end to end tests listen on a port.
    fetch: (input: string | URL | Request, init?: RequestInit) => answer(new Request(input, init)),
    async listen(port: number) {
      server = createServer(async (incoming, outgoing) => {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(chunk as Buffer);
        const headers = Object.fromEntries(["authorization", "content-type", "content-range"].flatMap((name) => (incoming.headers[name] ? [[name, String(incoming.headers[name])]] : [])));
        const body = ["GET", "HEAD"].includes(incoming.method ?? "GET") ? undefined : Buffer.concat(chunks);
        const found = await answer(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers, body }));
        outgoing.writeHead(found.status, Object.fromEntries(found.headers)).end(Buffer.from(await found.arrayBuffer()));
      });
      await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));
    },
    close: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  };
}
