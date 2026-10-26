import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { signView, validSignature } from "./file-worker";
import { supabaseAdmin } from "./supabase";

// The official files InboxCA fills (D42): the copies shipped in reference/official, and the
// files the daily check downloaded with the same layout, which Orelu's admin uses without an
// app release. Those are kept in the database by their SHA-256, written once and read only by
// the server: the daily check here, and the file worker through a link the app signs.
export type Store = { keep: (bytes: Buffer) => Promise<void>; read: (sha256: string) => Promise<Buffer | null> };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const shipped = (file: string) => {
  if (!/^[A-Za-z0-9_./-]+$/.test(file) || file.includes("..") || file.startsWith("/")) throw new Error("Unknown official file");
  return join(process.cwd(), "reference/official", file);
};

export const officialStore = (): Store => ({
  keep: async (bytes) => {
    const { error } = await supabaseAdmin().from("official_files").upsert({ sha256: sha(bytes), bytes: `\\x${bytes.toString("hex")}` }, { onConflict: "sha256", ignoreDuplicates: true });
    if (error) throw new Error("The file could not be kept");
  },
  read: async (sha256) => {
    const { data, error } = await supabaseAdmin().from("official_files").select("bytes").eq("sha256", sha256).maybeSingle();
    if (error) throw new Error("The file store could not be read");
    return data ? Buffer.from(data.bytes.slice(2), "hex") : null;
  },
});

// A template's official file: the shipped copy, else the stored one by its hash. The hash is
// checked every time, so a copy that changed is refused, never used.
export async function officialFile(file: string, sha256: string, store: Store = officialStore()) {
  const bytes = await readFile(shipped(file)).catch(() => store.read(sha256));
  if (!bytes) throw new Error("The official file is not in the store");
  if (sha(bytes) !== sha256) throw new Error("The official file changed");
  return bytes;
}

// The file worker fetches a stored file (one the app does not ship) with this link, signed with
// its secret for 75 seconds like its other requests. None when the file ships with the app.
export async function officialLink(source: { file: string; sha256: string }) {
  const secret = process.env.FILE_WORKER_SECRET, base = process.env.APP_BASE_URL;
  if (!secret || !base || await access(shipped(source.file)).then(() => true, () => false)) return undefined;
  const until = Math.floor(Date.now() / 1000) + 75;
  return `${base.replace(/\/$/, "")}/api/official/${source.sha256}?until=${until}&sig=${await signView(`official:${source.sha256}:${until}`, secret)}`;
}

export async function linkAllowed(sha256: string, until: string | null, signature: string | null, now = Date.now() / 1000) {
  const at = Number(until);
  return /^[a-f0-9]{64}$/.test(sha256) && /^\d{10}$/.test(until ?? "") && at > now && at <= now + 75 && validSignature(`official:${sha256}:${until}`, signature ?? "", process.env.FILE_WORKER_SECRET ?? "");
}
