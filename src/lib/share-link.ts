import { intakeLimits } from "./file-worker";

// A sharing link a client sends instead of an attachment (owner, 3 Nov 2026): only a file on
// Google Drive, Dropbox or OneDrive that anyone with the link may open is fetched, over https,
// from these hosts and through redirects inside them alone; never any other address. A folder,
// a Google Doc, a OneDrive for Business link (its Shares API needs a sign in) or a file that
// answers with a sign in page is not fetched: the client is asked for the file attached or the
// link set to anyone with the link. What is fetched was not checked by the firm's email
// provider, so it waits for a person (src/jobs/file-mail.ts).
export type Shared = { url: string; fetch: string | null };
const hosts = /^(drive\.google\.com|docs\.google\.com|(www\.)?dropbox\.com|1drv\.ms|onedrive\.live\.com|[a-z0-9-]+-my\.sharepoint\.com)$/i;
const through = /(^|\.)(google\.com|googleusercontent\.com|dropbox\.com|dropboxusercontent\.com|1drv\.ms|1drv\.com|live\.com|onedrive\.com)$/i;
export const MOST_LINKS = 5;

// Where the file's bytes are: Drive's download address by the file's id, Dropbox's link
// with dl=1 (help.dropbox.com/share/force-download), OneDrive's shares API by the encoded
// link (learn.microsoft.com/graph/api/shares-get). null when it is not a file to fetch.
function fetchAddress(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "drive.google.com") {
    const id = url.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1] ?? (url.pathname === "/open" || url.pathname === "/uc" ? url.searchParams.get("id") : null);
    return id && /^[\w-]{10,}$/.test(id) ? `https://drive.google.com/uc?export=download&id=${id}` : null;
  }
  if (host.endsWith("dropbox.com")) {
    if (!/^\/(s|scl\/fi)\//.test(url.pathname)) return null;
    url.searchParams.set("dl", "1");
    return url.href;
  }
  if (host === "1drv.ms" || host === "onedrive.live.com") {
    if (/^\/f\//.test(url.pathname) || url.searchParams.has("cid") && !url.searchParams.has("resid")) return null;
    return `https://api.onedrive.com/v1.0/shares/u!${Buffer.from(url.href).toString("base64url")}/root/content`;
  }
  return null;
}

// The sharing links in an email's text, at most MOST_LINKS, each once.
export function sharedLinks(text: string): Shared[] {
  const found = new Map<string, Shared>();
  for (const match of text.match(/https:\/\/[^\s<>"')\]]+/gi) ?? []) {
    let url: URL;
    try { url = new URL(match.replace(/[.,;:!?]+$/, "")); } catch { continue; }
    if (url.protocol !== "https:" || !hosts.test(url.hostname) || found.has(url.href)) continue;
    found.set(url.href, { url: url.href, fetch: fetchAddress(new URL(url.href)) });
    if (found.size === MOST_LINKS) break;
  }
  return [...found.values()];
}

export type Fetched = { name: string; bytes: Uint8Array } | "private" | "large" | "error";
// The file behind a link that may be fetched: at most 5 redirects, each to an allowed host over
// https; a sign in or confirmation page (HTML) means it is not open to anyone with the link;
// at most the intake size, counted as it arrives; a minute in all.
export async function fetchShared(address: string, timeout = 60_000): Promise<Fetched> {
  const signal = AbortSignal.timeout(timeout);
  let url = address, response: Response | undefined;
  try {
    for (let hop = 0; hop < 6; hop++) {
      const at = new URL(url);
      if (at.protocol !== "https:" || !through.test(at.hostname)) return "private";
      response = await fetch(url, { signal, redirect: "manual", headers: { Accept: "*/*" } });
      if (response.status < 300 || response.status >= 400) break;
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) return "error";
      url = new URL(next, url).href;
      response = undefined;
    }
    if (!response) return "private";
    if (response.status === 401 || response.status === 403 || response.status === 404) { await response.body?.cancel(); return "private"; }
    if (!response.ok || !response.body) { await response.body?.cancel(); return "error"; }
    if (/text\/html/i.test(response.headers.get("content-type") ?? "")) { await response.body.cancel(); return "private"; }
    if (Number(response.headers.get("content-length")) > intakeLimits.bytes) { await response.body.cancel(); return "large"; }
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > intakeLimits.bytes) return "large";
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.length; }
    const disposition = response.headers.get("content-disposition") ?? "";
    const named = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const name = (named ? decodeURIComponent(named) : decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "")).replace(/[\\/]/g, " ").trim().slice(0, 255) || "file";
    return { name, bytes };
  } catch {
    return "error";
  }
}
