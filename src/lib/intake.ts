import { createHash } from "node:crypto";
import { KEPT_OUT_FOLDER, safeName, type Drive } from "./drive";
import { intakeLimits, isZip, readFrames, signView, unsafeFile } from "./file-worker";
import { supabaseAdmin } from "./supabase";

export type Paper = { name: string; bytes: Uint8Array };
export type Unsafe = "program" | "large" | "zip" | "zip_password" | "zip_large";

// Why a file sent in was not saved, in a sentence for the person who sent it.
export const unsafeText: Record<Unsafe, string> = {
  program: "InboxCA takes PDFs, pictures, Excel, CSV, XML, JSON, Word and ZIP files only, never programs, scripts or Office files with macros.",
  large: "Files can be up to 50 MB each.",
  zip: "This ZIP holds another archive, a program or damaged files. Unzip it and send the papers on their own.",
  zip_password: "This ZIP has a password. Send the papers without one.",
  zip_large: "A ZIP can hold up to 1,000 files and 500 MB once unpacked.",
};

// Every file a client or the team sends in (PLAN.md 5.15, 8.6), before it is saved: a file
// of a kind InboxCA does not take, a program, a script or a macro file is refused here, and
// the file worker opens a ZIP, giving each file in it as a paper of its own. Without the
// worker a ZIP is saved as it is; a worker that does not answer throws worker_unavailable,
// so the person tries again. Viruses are the email provider's check, before InboxCA reads
// the mailbox (content/security.ts).
export async function checkFile(file: Paper, openZip = true): Promise<{ unsafe: Unsafe } | { papers: Iterable<Paper> | AsyncIterable<Paper> }> {
  if (file.bytes.length > intakeLimits.bytes) return { unsafe: "large" };
  if (unsafeFile(file.name, file.bytes)) return { unsafe: "program" };
  const url = process.env.FILE_WORKER_URL, secret = process.env.FILE_WORKER_SECRET;
  const zip = openZip && isZip(file.name, file.bytes);
  if (!url || !secret || !zip) return { papers: [file] };
  const ticket = JSON.stringify({ size: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex"), zip, expires: Math.floor(Date.now() / 1000) + 60 });
  const response = await fetch(`${url.replace(/\/$/, "")}/intake`, {
    method: "POST", body: file.bytes as BodyInit, cache: "no-store", signal: AbortSignal.timeout(900_000),
    headers: { Authorization: await signView(ticket, secret), "X-InboxCA-Intake": ticket, "Content-Type": "application/octet-stream" },
  });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("worker_unavailable"); }
  const frames = readFrames(response.body, intakeLimits.bytes);
  const first = await frames.next();
  const said = JSON.parse(new TextDecoder().decode(first.value ?? new Uint8Array())) as { refused?: Unsafe; files?: string[] };
  if (said.refused) { await frames.return(undefined); return { unsafe: said.refused in unsafeText ? said.refused : "zip" }; }
  return {
    papers: (async function* () {
      try {
        for (const name of said.files ?? []) {
          const next = await frames.next();
          if (next.done) throw new Error("worker_unavailable");
          yield { name: name.slice(0, 255), bytes: next.value };
        }
      } finally { await frames.return(undefined); }
    })(),
  };
}

// A file the checks refused is never shown or downloaded (D18, 8.6): it goes to the drive's
// Files kept out folder, which only the owner sees, and the owner is told on Today. The same
// file for the same client (or for none known yet) is saved and told once; sent again, the
// owner is told again. Logged with why it was kept out. A file already in the drive is moved
// there instead (place).
export async function quarantine(firmId: string, actor: string | null, client: { id: string; name: string } | null, file: Paper, found: string, drive: Drive, place = (folder: string, name: string) => drive.save(folder, name, file.bytes)) {
  const admin = supabaseAdmin();
  const key = createHash("sha256").update(`${client?.id ?? firmId}:${createHash("sha256").update(file.bytes).digest("hex")}`).digest("hex");
  const entity = `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20, 32)}`;
  const { data: told } = await admin.from("requests").select("details").eq("kind", "alert").eq("entity_type", "virus").eq("entity_id", entity).maybeSingle();
  let name = (told?.details as { name?: string } | undefined)?.name;
  if (!name) {
    const folder = await drive.ensureFolder([KEPT_OUT_FOLDER]);
    const wanted = safeName(client ? `${client.name} - ${file.name}` : file.name);
    for (const candidate of [wanted, `${key.slice(0, 6)} ${wanted}`]) if ((await place(folder, candidate)) !== "taken") { name = candidate; break; }
    if (!name) throw new Error("drive_taken");
  }
  const { data: alert, error } = await admin.from("requests").upsert({ firm_id: firmId, client_id: client?.id ?? null, kind: "alert", entity_type: "virus", entity_id: entity, reason_code: "virus", status: "pending", details: { name, client: client?.name ?? null, found } }, { onConflict: "kind,entity_type,entity_id" }).select("id").single();
  if (error) throw error;
  await admin.from("activity_log").insert({ firm_id: firmId, actor_id: actor, action: "document.virus", entity_type: "request", entity_id: alert.id, details: { found } });
}

// checkFile, with a program, script or macro file a client sent (no person behind it) put
// away for the owner to see; a person's own is only refused.
export async function receive(firmId: string, actor: string | null, client: { id: string; name: string } | null, file: Paper, drive: Drive, openZip = true) {
  const checked = await checkFile(file, openZip);
  if ("unsafe" in checked && checked.unsafe === "program" && !actor) await quarantine(firmId, actor, client, file, "program", drive);
  return checked;
}
