import { createHash, randomBytes } from "node:crypto";
import { INCOMING, type Drive } from "./drive";

// Dropbox (PLAN.md 5.5.1): InboxCA's app has Full Dropbox access and signs in with PKCE,
// so it holds no app secret. The owner's refresh token is kept encrypted; each use gets a
// short access token from it. New files go under /InboxCA; nothing else is touched
// except the folders the owner ticks.
const ROOT = "/InboxCA";
const appKey = () => process.env.DROPBOX_APP_KEY ?? "";

// The PKCE pair: the verifier stays with the owner's browser, the challenge goes to Dropbox.
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function dropboxSignIn(state: string, challenge: string, redirectUri: string) {
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  for (const [key, value] of Object.entries({
    client_id: appKey(),
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    redirect_uri: redirectUri,
    state,
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

async function token(body: Record<string, string>) {
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: appKey(), ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`dropbox_token_${response.status}`);
  return (await response.json()) as { access_token: string; refresh_token?: string };
}

// Exchanges the code Dropbox returned for a refresh token and the account's email.
export async function dropboxConnect(code: string, verifier: string, redirectUri: string) {
  const { access_token, refresh_token } = await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
  const account = await call(access_token, "users/get_current_account", null);
  return { refreshToken: refresh_token ?? "", email: String((account as { email?: string }).email ?? "") };
}

async function call(accessToken: string, route: string, body: unknown) {
  const response = await fetch(`https://api.dropboxapi.com/2/${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, ...(body === null ? {} : { "Content-Type": "application/json" }) },
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) return { error: String((result.error_summary as string) ?? response.status) };
  return result;
}

// A header value Dropbox accepts: JSON with every character outside ASCII escaped.
const apiArg = (value: object) => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export const dropboxAccessToken = async (refreshToken: string) => (await token({ grant_type: "refresh_token", refresh_token: refreshToken })).access_token;

export function dropboxDrive(refreshToken: string): Drive {
  let access: Promise<string> | null = null;
  const accessToken = () => (access ??= token({ grant_type: "refresh_token", refresh_token: refreshToken }).then((t) => t.access_token));
  return {
    async ensureFolder(folders) {
      let path = ROOT;
      for (const folder of ["", ...folders]) {
        path = folder ? `${path}/${folder}` : path;
        const made = await call(await accessToken(), "files/create_folder_v2", { path, autorename: false });
        if ("error" in made && !String(made.error).startsWith("path/conflict/folder")) throw new Error("dropbox_folder");
      }
      return path;
    },
    async save(folderId, name, bytes) {
      const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": apiArg({ path: `${folderId}/${name}`, mode: "add", autorename: false, mute: true }),
        },
        body: new Blob([new Uint8Array(bytes)]),
        signal: AbortSignal.timeout(120_000),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: string; error_summary?: string };
      if (result.error_summary?.startsWith("path/conflict")) return "taken";
      if (!response.ok || !result.id) throw new Error("dropbox_upload");
      return { id: result.id };
    },
    async move(fileId, folderId, name) {
      const moved = await call(await accessToken(), "files/move_v2", { from_path: fileId, to_path: `${folderId}/${name}`, autorename: false });
      if ("error" in moved) {
        if (String(moved.error).startsWith("to/conflict")) return "taken";
        throw new Error("dropbox_move");
      }
      return { id: String((moved.metadata as { id?: string }).id) };
    },
    async files(folder) {
      const token = await accessToken();
      const files: { id: string; path: string; size: number }[] = [];
      let page = await call(token, "files/list_folder", { path: folder, recursive: true, limit: 2000 });
      for (;;) {
        if ("error" in page) throw new Error("dropbox_list");
        for (const entry of page.entries as { ".tag": string; id: string; path_display: string; size?: number }[])
          if (entry[".tag"] === "file") files.push({ id: entry.id, path: entry.path_display, size: entry.size ?? 0 });
        if (!page.has_more) break;
        page = await call(token, "files/list_folder/continue", { cursor: page.cursor });
      }
      return files;
    },
    async folders() {
      const [top, incoming] = await Promise.all([
        call(await accessToken(), "files/list_folder", { path: "", limit: 2000 }),
        call(await accessToken(), "files/get_metadata", { path: `${ROOT}/${INCOMING}` }),
      ]);
      if ("error" in top) throw new Error("dropbox_list");
      const own = (top.entries as { ".tag": string; path_display: string }[]).filter((entry) => entry[".tag"] === "folder" && entry.path_display !== ROOT).map((entry) => entry.path_display);
      return "error" in incoming ? own : [...own, String(incoming.path_display)];
    },
    // A one-time link, good for four hours and one file of up to 150 MB, that the browser
    // posts the file to; the access token never leaves the server.
    async incomingLink(relative) {
      const link = await call(await accessToken(), "files/get_temporary_upload_link", { commit_info: { path: `${ROOT}/${INCOMING}/${relative}`, mode: "add", autorename: false, mute: true }, duration: 14400 });
      if ("error" in link) throw new Error("dropbox_upload_link");
      return String(link.link);
    },
    async incomingFile(relative) {
      const file = await call(await accessToken(), "files/get_metadata", { path: `${ROOT}/${INCOMING}/${relative}` });
      if ("error" in file) {
        if (String(file.error).startsWith("path/not_found")) return null;
        throw new Error("dropbox_metadata");
      }
      return { id: String(file.id), hash: String(file.content_hash ?? "") };
    },
    async check() {
      const token = await accessToken();
      const files = (await this.files(ROOT)).map(({ id, path }) => ({ id, path }));
      const [folder, links, space] = await Promise.all([
        call(token, "files/get_metadata", { path: ROOT }),
        call(token, "sharing/list_shared_links", { path: ROOT, direct_only: false }),
        call(token, "users/get_space_usage", null),
      ]);
      const sharing = (folder as { sharing_info?: { shared_folder_id?: string; parent_shared_folder_id?: string } }).sharing_info;
      const shared = !!(sharing?.shared_folder_id || sharing?.parent_shared_folder_id) || ((links as { links?: unknown[] }).links?.length ?? 0) > 0;
      const usage = space as { used?: number; allocation?: { allocated?: number } };
      const freeBytes = usage.allocation?.allocated && usage.used !== undefined ? usage.allocation.allocated - usage.used : null;
      return { files, shared, freeBytes };
    },
    async trash(fileId) {
      const removed = await call(await accessToken(), "files/delete_v2", { path: fileId });
      if ("error" in removed && !String(removed.error).startsWith("path_lookup/not_found")) throw new Error("dropbox_delete");
    },
    async read(fileId) {
      const response = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: { Authorization: `Bearer ${await accessToken()}`, "Dropbox-API-Arg": apiArg({ path: fileId }) },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error("dropbox_download");
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
