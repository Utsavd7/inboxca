import { createHash } from "node:crypto";
import { INCOMING, type Drive } from "./drive";
import { sendPieces } from "./onedrive-upload";

// OneDrive (PLAN.md 5.5.1), on home and work or school accounts alike (Microsoft's common sign
// in). InboxCA's own Microsoft app for the drive (MS_DRIVE_CLIENT_ID and its secret, not the
// mail app's) asks for the owner's own files (Files.ReadWrite: the whole drive, as Full Dropbox,
// since the owner ticks folders already in it, which the app folder permission would hide),
// the owner's address (User.Read) and a refresh token (offline_access). It signs in with PKCE
// and the app's secret, so a refresh token is no use alone and a password change does not end
// it. The refresh token is kept encrypted; Microsoft gives a new one at each use and ends each
// 90 days after it was given, so the caller keeps the newest. New files go under /InboxCA;
// nothing else is touched except the folders the owner ticks. Folders are named by their path
// below the drive's top, as on Dropbox, and files by their ids.
const ROOT = "/InboxCA";
const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPE = "offline_access User.Read Files.ReadWrite";
// Microsoft's advice: an upload session for a file over 10 MiB, one request below that.
const SMALL = 10 * 1024 * 1024;
export const onedriveReady = () => !!process.env.MS_DRIVE_CLIENT_ID && !!process.env.MS_DRIVE_CLIENT_SECRET;
// Tests send every call to a fake on this machine, only with MAIL_ALLOW_LOCAL, as Dropbox's.
const at = (url: string) => (process.env.MAIL_ALLOW_LOCAL === "1" && process.env.ONEDRIVE_TEST_URL ? url.replace("https://", `${process.env.ONEDRIVE_TEST_URL}/`) : url);
// An item by its path below the drive's top, as Graph addresses it, and what follows it. A
// "." or ".." would climb out of the folder, so it is refused.
const node = (path: string, then = "") => {
  const names = path.split("/").filter(Boolean);
  if (names.some((name) => name === "." || name === "..")) throw new Error("onedrive_path");
  return names.length ? `${GRAPH}/me/drive/root:/${names.map(encodeURIComponent).join("/")}${then && `:${then}`}` : `${GRAPH}/me/drive/root${then}`;
};
// A next page Graph named, followed only on Graph itself, as the access token goes with it.
const graphLink = (link: unknown) => (typeof link === "string" && link.startsWith(`${at(GRAPH)}/`) ? link : null);
// A folder's next page as the browser keeps it: only Graph's page token, so a page is always of
// the folder asked for.
const pageToken = (link: unknown) => {
  const next = graphLink(link);
  return next && (new URL(next).searchParams.get("$skiptoken") ?? new URL(next).searchParams.get("$skipToken"));
};

type Item = { id: string; name: string; size?: number; folder?: object; file?: { hashes?: { quickXorHash?: string } }; root?: object; deleted?: object; parentReference?: { id?: string }; lastModifiedDateTime?: string };
type Answer = Record<string, unknown> & { status: number };

export function onedriveSignIn(state: string, challenge: string, redirectUri: string) {
  const url = new URL(at(`${LOGIN}/authorize`));
  for (const [key, value] of Object.entries({
    client_id: process.env.MS_DRIVE_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    state,
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

async function token(body: Record<string, string>) {
  const response = await fetch(at(`${LOGIN}/token`), {
    method: "POST",
    body: new URLSearchParams({ client_id: process.env.MS_DRIVE_CLIENT_ID ?? "", client_secret: process.env.MS_DRIVE_CLIENT_SECRET ?? "", scope: SCOPE, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`onedrive_token_${response.status}`);
  return (await response.json()) as { access_token: string; refresh_token?: string };
}

async function call(accessToken: string, url: string, method = "GET", body?: unknown): Promise<Answer> {
  const response = await fetch(at(url), {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { ...((await response.json().catch(() => ({}))) as object), status: response.status };
}

// Exchanges the code Microsoft returned for a refresh token, the owner's address, and the drive
// as InboxCA keeps it to know it again at Reconnect: only its id's hash.
export async function onedriveConnect(code: string, verifier: string, redirectUri: string) {
  const { access_token, refresh_token } = await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
  const [me, drive] = await Promise.all([call(access_token, `${GRAPH}/me?$select=mail,userPrincipalName`), call(access_token, `${GRAPH}/me/drive?$select=id`)]);
  if (me.status !== 200 || drive.status !== 200) throw new Error("onedrive_account");
  return { refreshToken: refresh_token ?? "", email: String(me.mail || me.userPrincipalName || ""), account: createHash("sha256").update(String(drive.id)).digest("hex") };
}

// A short access token from the saved refresh token; keep is given the new refresh token.
export async function onedriveAccessToken(refreshToken: string, keep?: (refreshToken: string) => Promise<unknown>) {
  const fresh = await token({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (fresh.refresh_token && keep) await keep(fresh.refresh_token).catch(() => undefined);
  return fresh.access_token;
}

export function onedriveDrive(refreshToken: string, keep?: (refreshToken: string) => Promise<unknown>): Drive {
  let access: Promise<string> | null = null;
  const accessToken = () => (access ??= onedriveAccessToken(refreshToken, keep));
  const go = async (url: string, method?: string, body?: unknown) => call(await accessToken(), url, method, body);
  // Every file below a folder, from the drive's change list (delta) read from the start: Graph's
  // one sure full list, for home and work drives alike. It names each item's parent only by id.
  async function files(folder: string) {
    const items = new Map<string, Item>();
    for (let url: string | null = `${GRAPH}/me/drive/root/delta?$select=id,name,size,file,folder,root,deleted,parentReference`; url; ) {
      const page = await go(url);
      if (page.status !== 200) throw new Error("onedrive_list");
      for (const item of page.value as Item[])
        if (item.deleted) items.delete(item.id);
        else items.set(item.id, item);
      url = graphLink(page["@odata.nextLink"]);
    }
    const pathOf = (item: Item): string => {
      const parent = items.get(item.parentReference?.id ?? "");
      return !parent || parent.root ? `/${item.name}` : `${pathOf(parent)}/${item.name}`;
    };
    return [...items.values()].flatMap((item) => (item.file ? [{ id: item.id, path: pathOf(item), size: item.size ?? 0 }] : [])).filter((file) => file.path.startsWith(`${folder}/`));
  }
  const drive: Drive = {
    async ensureFolder(folders) {
      let path = "";
      for (const name of [ROOT.slice(1), ...folders]) {
        const made = await go(node(path, "/children"), "POST", { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
        if (made.status >= 300 && made.status !== 409) throw new Error("onedrive_folder");
        path = `${path}/${name}`;
      }
      return path;
    },
    async save(folderId, name, bytes) {
      const file = new Blob([new Uint8Array(bytes)]);
      const token = await accessToken();
      let done: Response;
      if (bytes.length <= SMALL)
        done = await fetch(at(`${node(`${folderId}/${name}`, "/content")}?@microsoft.graph.conflictBehavior=fail`), {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
          body: file,
          signal: AbortSignal.timeout(120_000),
        });
      else {
        const session = await call(token, node(`${folderId}/${name}`, "/createUploadSession"), "POST", { item: { "@microsoft.graph.conflictBehavior": "fail" } });
        if (session.status === 409) return "taken";
        if (typeof session.uploadUrl !== "string") throw new Error("onedrive_upload");
        done = await sendPieces(at(session.uploadUrl), file, 120_000);
      }
      if (done.status === 409) return "taken";
      const saved = (await done.json().catch(() => ({}))) as { id?: string };
      if (!done.ok || !saved.id) throw new Error("onedrive_upload");
      return { id: saved.id };
    },
    async move(fileId, folderId, name) {
      const folder = await go(`${node(folderId)}?$select=id`);
      if (folder.status !== 200) throw new Error("onedrive_move");
      const moved = await go(`${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}?@microsoft.graph.conflictBehavior=fail`, "PATCH", { parentReference: { id: folder.id }, name });
      if (moved.status === 409) return "taken";
      if (moved.status !== 200) throw new Error("onedrive_move");
      return { id: String(moved.id) };
    },
    files,
    async list(folder, cursor, limit = 200) {
      const page = await go(`${node(folder ? `${ROOT}/${folder}` : ROOT, "/children")}?$top=${Math.min(limit, 1000)}&$select=id,name,size,folder,lastModifiedDateTime${cursor ? `&$skiptoken=${encodeURIComponent(cursor)}` : ""}`);
      if (!cursor && page.status === 404) return { entries: [], cursor: null };
      if (page.status !== 200) throw new Error("onedrive_list");
      const entries = (page.value as Item[]).map((item) => ({ id: item.id, name: item.name, path: folder ? `${folder}/${item.name}` : item.name, folder: !!item.folder, size: item.folder ? 0 : (item.size ?? 0), modified: item.folder ? "" : (item.lastModifiedDateTime ?? "") }));
      return { entries, cursor: pageToken(page["@odata.nextLink"]) };
    },
    async folders() {
      const [top, incoming] = await Promise.all([go(`${node("", "/children")}?$top=1000&$select=name,folder`), go(`${node(`${ROOT}/${INCOMING}`)}?$select=id`)]);
      if (top.status !== 200) throw new Error("onedrive_list");
      const own = (top.value as Item[]).filter((item) => item.folder && item.name !== ROOT.slice(1)).map((item) => `/${item.name}`);
      return incoming.status === 200 ? [...own, `${ROOT}/${INCOMING}`] : own;
    },
    // An upload session in Incoming, good for days, that the browser sends the file to in
    // pieces (sendPieces); the access token never leaves the server.
    async incomingLink(relative) {
      await drive.ensureFolder([INCOMING, ...relative.split("/").slice(0, -1)]);
      const session = await go(node(`${ROOT}/${INCOMING}/${relative}`, "/createUploadSession"), "POST", { item: { "@microsoft.graph.conflictBehavior": "fail" } });
      if (typeof session.uploadUrl !== "string") throw new Error("onedrive_upload_link");
      return session.uploadUrl;
    },
    async incomingFile(relative) {
      const file = await go(`${node(`${ROOT}/${INCOMING}/${relative}`)}?$select=id,file`);
      if (file.status === 404) return null;
      if (file.status !== 200) throw new Error("onedrive_metadata");
      return { id: String(file.id), hash: String((file.file as Item["file"])?.hashes?.quickXorHash ?? "") };
    },
    // Shared when anyone but the owner has a permission on InboxCA's folder, its own or from a
    // folder above it, a link included.
    async check() {
      const [found, permissions, space] = await Promise.all([files(ROOT), go(node(ROOT, "/permissions")), go(`${GRAPH}/me/drive?$select=quota`)]);
      if (permissions.status !== 200 || space.status !== 200) throw new Error("onedrive_check");
      const remaining = (space.quota as { remaining?: unknown } | undefined)?.remaining;
      return {
        files: found.map(({ id, path }) => ({ id, path })),
        shared: (permissions.value as { roles?: string[] }[]).some((permission) => !permission.roles?.includes("owner")),
        freeBytes: typeof remaining === "number" ? remaining : null,
      };
    },
    async trash(fileId) {
      const removed = await go(`${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}`, "DELETE");
      if (removed.status >= 300 && removed.status !== 404) throw new Error("onedrive_delete");
    },
    async read(fileId) {
      const response = await fetch(at(`${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}/content`), {
        headers: { Authorization: `Bearer ${await accessToken()}` },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error("onedrive_download");
      return new Uint8Array(await response.arrayBuffer());
    },
  };
  return drive;
}
