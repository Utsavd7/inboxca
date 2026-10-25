import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { queueRead } from "@/src/jobs/read-document";
import { todayInIndia } from "@/src/lib/calendar";
import { serverCrypto } from "@/src/lib/crypto";
import { describeFile, folderFor, gstinFor, periodChoices, periodName, placeUnderFreeName, receivedLabel, settleVersions } from "@/src/lib/documents";
import { safeName, workTypes, type Drive, type DriveEntry, type FolderOrder, type Naming, type WorkType } from "@/src/lib/drive";
import { openDrive } from "@/src/lib/drive-account";
import { access, clientFolders, kindOf, placeOf, viewable } from "@/src/lib/drive-browse";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { supabaseAdmin } from "@/src/lib/supabase";

const PAGE = 200;
const FRESH = 8_000;

// The drive opened once per account for half an hour, so Dropbox gives a short access token
// once rather than on every folder; it stays in this server's memory and never reaches a browser.
// Each folder's listing for a few seconds, in memory only (never a file's contents), so moving
// around the tree and coming back is instant. Oldest out first. Both are kept on the process,
// so the folder reads and the actions that change the drive share them.
type Kept = { inboxcaDrives: Map<string, { at: number; drive: Promise<Drive> }>; inboxcaListings: Map<string, { at: number; page: ReturnType<Drive["list"]> }> };
const kept = globalThis as typeof globalThis & Partial<Kept>;
const opened: Kept["inboxcaDrives"] = (kept.inboxcaDrives ??= new Map());
const listings: Kept["inboxcaListings"] = (kept.inboxcaListings ??= new Map());

function listPage(account: string, drive: Drive, folder: string, cursor = "", limit = PAGE) {
  const key = [account, folder, cursor, limit].join("\n");
  const now = Date.now();
  const hit = listings.get(key);
  if (hit && now - hit.at < FRESH) return hit.page;
  for (const [old, { at }] of listings) if (now - at >= FRESH || listings.size > 400) listings.delete(old); else break;
  const page = drive.list(folder, cursor || undefined, limit);
  listings.set(key, { at: now, page });
  page.catch(() => listings.delete(key));
  return page;
}

// After InboxCA changes the drive, its listings are read again.
export function forget(account: string) {
  for (const key of listings.keys()) if (key.startsWith(`${account}\n`)) listings.delete(key);
}

// Who is looking, the firm's drive, and the clients whose folders they may open: null when
// they see every client (the database's own rule, open_firms), else their clients by folder.
export async function browseContext() {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) return null;
  const admin = supabaseAdmin();
  const [{ data: account }, { data: open }] = await Promise.all([
    admin.from("connected_accounts").select("id, provider, credentials_enc, settings").eq("firm_id", membership.firmId).eq("kind", "drive").maybeSingle(),
    supabase.rpc("open_firms"),
  ]);
  let clients: Map<string, { id: string; name: string }[]> | null = null;
  if (!open?.includes(membership.firmId)) {
    const mine: { id: string; name: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("clients").select("id, name").eq("firm_id", membership.firmId).order("id").range(from, from + 999);
      mine.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    clients = clientFolders(mine);
  }
  let drive: Drive | null = null;
  if (account) {
    const key = `${account.id}:${account.credentials_enc.slice(-24)}`;
    const hit = opened.get(key);
    if (!hit || Date.now() - hit.at > 30 * 60_000) opened.set(key, { at: Date.now(), drive: openDrive(membership.firmId, account) });
    drive = await opened.get(key)!.drive.catch((error) => {
      opened.delete(key);
      throw error;
    });
  }
  const settings = (account?.settings ?? {}) as { folder_order?: FolderOrder; naming?: Naming };
  return { supabase, admin, userId, membership, account, drive, clients, owner: membership.role === "owner", order: settings.folder_order ?? "year_client_work", naming: settings.naming };
}
export type Context = NonNullable<Awaited<ReturnType<typeof browseContext>>>;

// Every entry of a folder, for a person who sees only some clients: up to 50,000.
async function everything(ctx: Context, folder: string) {
  const entries: DriveEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 25; page++) {
    const next = await listPage(ctx.account!.id, ctx.drive!, folder, cursor, 2000);
    entries.push(...next.entries);
    if (!next.cursor) break;
    cursor = next.cursor;
  }
  return entries;
}

// Whether a year or work folder holds a folder of one of the person's clients.
async function holds(ctx: Context, parts: string[]): Promise<boolean> {
  const inside = (await everything(ctx, parts.join("/"))).filter((entry) => entry.folder);
  const verdicts = await Promise.all(inside.map((entry) => {
    const verdict = access([...parts, entry.name], ctx, ctx.order, true);
    return verdict === "probe" ? holds(ctx, [...parts, entry.name]) : verdict === "yes";
  }));
  return verdicts.some(Boolean);
}

export async function mayOpen(ctx: Context, parts: string[]) {
  const verdict = access(parts, ctx, ctx.order, true);
  return verdict === "yes" || (verdict === "probe" && (await holds(ctx, parts)));
}

// A file by its name in a folder the person may open, with its drive id (kept on the server).
export async function driveFile(ctx: Context, parts: string[], name: string) {
  if (!ctx.drive || !(await mayOpen(ctx, parts)) || access([...parts, name], ctx, ctx.order, false) !== "yes") return null;
  return (await everything(ctx, parts.join("/"))).find((entry) => !entry.folder && entry.name === name) ?? null;
}

// The client a client folder is for: the one client of the person's with that folder name.
async function clientNamed(ctx: Context, folder: string) {
  if (ctx.clients) return ctx.clients.get(folder)?.length === 1 ? ctx.clients.get(folder)![0] : null;
  const { data } = await ctx.supabase
    .from("clients")
    .select("id, name")
    .eq("firm_id", ctx.membership.firmId)
    .ilike("name", `${folder.replace(/[\\%_]/g, "\\$&").replace(/ /g, "%")}%`)
    .order("name")
    .limit(50);
  const same = (data ?? []).filter((client) => safeName(client.name, 80) === folder);
  return same.length === 1 ? same[0] : null;
}

export type Paper = { id: string; type: string; work: string; period: string; status: string; client: string; view: boolean; send: boolean; download: boolean };
export type Entry = { name: string; kind: string; size: number; modified: string; paper?: Paper; guess?: { type: string; work: string; period: string } };
export type Listing = { path: string[]; entries: Entry[]; cursor: string | null; client: { id: string; name: string } | null; upload: boolean; file: boolean };

// One folder as the person may see it, a page at a time: its folders and files, each file
// with its paper when InboxCA filed it, and a guess at what it is when not. Null when the
// person may not open the folder.
export async function listing(ctx: Context, parts: string[], cursor?: string): Promise<Listing | null> {
  if (!ctx.drive || !(await mayOpen(ctx, parts))) return null;
  const folder = parts.join("/");
  const place = placeOf(parts, ctx.order);
  // Someone who sees only some clients gets a folder above theirs whole, to pick theirs out.
  const page = ctx.clients && !place.client ? { entries: await everything(ctx, folder), cursor: null } : await listPage(ctx.account!.id, ctx.drive, folder, cursor);
  const inFolder = page.entries.filter((entry) => entry.path.toLowerCase() === [...parts, entry.name].join("/").toLowerCase());
  const seen = await Promise.all(inFolder.map(async (entry) => {
    const verdict = access([...parts, entry.name], ctx, ctx.order, entry.folder);
    return verdict === "yes" || (verdict === "probe" && (await holds(ctx, [...parts, entry.name])));
  }));
  const shown = inFolder.filter((_, at) => seen[at]);
  const ids = shown.filter((entry) => !entry.folder).map((entry) => entry.id);
  const [found, client] = await Promise.all([
    Promise.all(
      Array.from({ length: Math.ceil(ids.length / 40) }, (_, n) =>
        ctx.admin.from("documents").select("id, client_id, drive_file_id, document_type, work_type, period_key, status, share_policy, prepared").eq("firm_id", ctx.membership.firmId).in("drive_file_id", ids.slice(n * 40, n * 40 + 40)),
      ),
    ),
    place.client ? clientNamed(ctx, place.client) : null,
  ]);
  const papers = new Map(found.flatMap(({ data }) => data ?? []).map((paper) => [paper.drive_file_id, paper]));
  const mine = ctx.clients && new Set([...ctx.clients.values()].flat().map((one) => one.id));
  const write = !ctx.membership.viewOnlyUntil;
  const today = todayInIndia();
  const periods = periodChoices(today);
  const entries = shown.flatMap((entry): Entry[] => {
    const base = { name: entry.name, kind: entry.folder ? "folder" : kindOf(entry.name), size: entry.size, modified: entry.modified };
    if (entry.folder) return [base];
    const paper = papers.get(entry.id);
    // A paper filed for a client the person does not see stays hidden, even in a shared folder name.
    if (paper && mine && !mine.has(paper.client_id)) return [];
    if (paper)
      return [{
        ...base,
        paper: {
          id: paper.id, type: paper.document_type, work: workTypes[paper.work_type as WorkType] ?? "", period: periodName(paper.period_key), status: paper.status, client: paper.client_id,
          view: viewable(entry.name) && paper.status !== "deleted",
          send: write && paper.status === "filed" && paper.share_policy !== "internal" && ctx.membership.may("send", paper.client_id),
          download: ctx.owner && !paper.prepared && paper.status !== "deleted",
        },
      }];
    const guess = describeFile(entry.name, "", null, today);
    return [{ ...base, guess: { type: guess.type === "Document" ? "" : guess.type, work: place.work ?? (guess.work === "other" ? "" : guess.work), period: periods.includes(guess.period) ? guess.period : "" } }];
  });
  return {
    path: parts,
    entries,
    cursor: page.cursor,
    client,
    upload: write && !!client && ctx.membership.may("upload", client.id),
    file: write && (!client || ctx.membership.may("rename", client.id)),
  };
}

// Where a paper came from, in words: the email's sender, a prepared form, who uploaded or
// filed it, or the drive itself.
export async function cameFrom(ctx: Context, id: string) {
  const { data: paper } = await ctx.supabase.from("documents").select("id, email_event_id, prepared, clients(name), email_events(contact_id, contacts(name_enc))").eq("firm_id", ctx.membership.firmId).eq("id", id).maybeSingle();
  if (!paper) return null;
  if (paper.email_event_id) {
    const contact = paper.email_events?.contact_id && paper.email_events.contacts;
    const sender = contact ? await serverCrypto().decrypt(ctx.membership.firmId, `contacts/${paper.email_events!.contact_id}/name`, contact.name_enc) : "";
    return `Email from ${sender || paper.clients?.name || "the client"}`;
  }
  if (paper.prepared) return "Prepared in InboxCA";
  const { data: line } = await ctx.admin.from("activity_log").select("action, actor_id").eq("firm_id", ctx.membership.firmId).eq("entity_id", id).in("action", ["document.uploaded", "document.added", "document.filed"]).order("at").limit(1).maybeSingle();
  if (!line) return "From the drive";
  if (!line.actor_id) return "Client upload link";
  const { data: people } = await ctx.supabase.rpc("firm_people", { target_firm: ctx.membership.firmId });
  const who = personName(people?.find((person) => person.user_id === line.actor_id)?.email);
  return line.action === "document.filed" ? `Found in the drive, filed by ${who}` : `Uploaded by ${who}`;
}

// Files one paper for a client, like an upload: refused when the client already has the same
// file, else placed in the client's folder under InboxCA's name (never over another file),
// recorded, logged with who did it, made the current version when filed, and read for search.
export async function fileForClient(
  ctx: Context,
  client: { id: string; name: string },
  values: { work_type: WorkType; document_type: string; period_key: string; status: "filed" | "to_check" },
  file: { name: string; bytes: Uint8Array },
  place: (folder: string, name: string) => Promise<{ id: string } | "taken">,
  action: "document.uploaded" | "document.filed",
) {
  const { admin, membership } = ctx;
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const { data: twin } = await admin.from("documents").select("id").eq("client_id", client.id).eq("sha256", sha256).neq("status", "deleted").limit(1);
  if (twin?.length) return "twin" as const;
  const now = new Date().toISOString();
  const folder = folderFor(ctx.order, client.name, { work: values.work_type, period: values.period_key, receivedAt: now, toCheck: values.status === "to_check" });
  const target = await ctx.drive!.ensureFolder(folder);
  const placed = await placeUnderFreeName(
    { client: client.name, type: values.document_type, period: periodName(values.period_key), extension: path.extname(file.name) },
    receivedLabel(now),
    (name) => place(target, name),
    ctx.naming,
  );
  if (placed === "taken") return "drive" as const;
  const id = randomUUID();
  const { data: gstins } = values.work_type === "gst" ? await admin.from("client_registrations").select("id").eq("client_id", client.id).eq("kind", "gstin") : { data: [] };
  const registration_id = gstinFor(values.work_type, (gstins ?? []).map((row) => row.id));
  await admin.from("documents").insert({
    id,
    firm_id: membership.firmId,
    client_id: client.id,
    ...values,
    registration_id,
    drive_file_id: placed.id,
    name: placed.name,
    original_name_enc: await serverCrypto().encrypt(membership.firmId, `documents/${id}/original_name`, file.name),
    size: file.bytes.length,
    sha256,
    received_at: now,
  });
  await admin.from("activity_log").insert({ firm_id: membership.firmId, actor_id: ctx.userId, action, entity_type: "document", entity_id: id, ...(action === "document.filed" && { details: { from: "drive" } }) });
  if (values.status === "filed") await settleVersions(admin, { client_id: client.id, ...values, registration_id });
  await queueRead(membership.firmId, id);
  return { id, name: placed.name, folder };
}
