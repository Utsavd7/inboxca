"use server";
import { todayInIndia } from "@/src/lib/calendar";
import { describeFile, documentTypes, periodChoices } from "@/src/lib/documents";
import { workTypes, type WorkType } from "@/src/lib/drive";
import { parsePath, placeOf } from "@/src/lib/drive-browse";
import { browseContext, driveFile, fileForClient, forget, listing, type Context } from "./data";

type Result = { ok?: string; error?: string; folder?: string[] };
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_FILING = 100 * 1024 * 1024;

// The person, their drive and the folder a form names, when they may change it.
async function writable(form: FormData): Promise<{ ctx: Context; parts: string[] } | Result> {
  const ctx = await browseContext();
  const parts = parsePath(String(form.get("path") ?? ""));
  if (!ctx || !parts) return { error: "That folder is not open to you." };
  if (ctx.membership.viewOnlyUntil) return { error: "This device can only view papers." };
  if (!ctx.drive || !ctx.account) return { error: "Connect the firm's drive in Settings first." };
  return { ctx, parts };
}

// Files a paper someone put in the drive by hand (D18: filing work, as a rename is): the
// person names its client, type, work and period, as in To check, and it moves to its client's
// folder under InboxCA's name. Only a file in a folder the person may open, not filed yet.
export async function fileDrivePaper(_previous: Result | null, form: FormData): Promise<Result> {
  const found = await writable(form);
  if (!("ctx" in found)) return found;
  const { ctx, parts } = found;
  forget(ctx.account!.id);
  const file = await driveFile(ctx, parts, String(form.get("name") ?? ""));
  if (!file) return { error: "That file is no longer in this folder." };
  const { data: filed } = await ctx.admin.from("documents").select("id").eq("firm_id", ctx.membership.firmId).eq("drive_file_id", file.id).limit(1);
  if (filed?.length) return { error: "This paper is already filed." };
  const { data: client } = await ctx.supabase.from("clients").select("id, name").eq("firm_id", ctx.membership.firmId).eq("id", String(form.get("client") ?? "")).maybeSingle();
  if (!client) return { error: "Choose the client this paper is for." };
  if (!ctx.membership.may("rename", client.id)) return { error: "Ask the owner to let you file papers for this client." };
  const type = String(form.get("type") ?? "");
  const work = String(form.get("work") ?? "");
  const period = form.get("period") === "none" ? "" : String(form.get("period") ?? "");
  const types = [...documentTypes, ...((ctx.membership.settings.document_types ?? []) as string[])];
  if (!types.includes(type) || !(work in workTypes) || (period && !periodChoices(todayInIndia()).includes(period))) return { error: "Choose the paper's type, work and period." };
  if (file.size > MAX_FILING) return { error: "This file is too large to file here." };
  try {
    const bytes = await ctx.drive!.read(file.id);
    const filed = await fileForClient(ctx, client, { work_type: work as WorkType, document_type: type, period_key: period, status: "filed" }, { name: file.name, bytes }, (folder, name) => ctx.drive!.move(file.id, folder, name), "document.filed");
    if (filed === "twin") return { error: `${client.name} already has this same file. It stays where it is.` };
    if (filed === "drive") return { error: "The drive did not take the file. Try again." };
    forget(ctx.account!.id);
    return { ok: `Filed as ${filed.name}`, folder: filed.folder };
  } catch {
    return { error: "The drive could not be reached. Try again in a minute." };
  }
}

// Papers dropped or chosen for a client's folder: each is filed for that client like an
// upload, its type and period read from its name; one the name does not say waits in the
// client's To check. Uploading follows the person's upload right (5.17.2).
export async function uploadToFolder(form: FormData): Promise<Result> {
  const found = await writable(form);
  if (!("ctx" in found)) return found;
  const { ctx, parts } = found;
  const here = await listing(ctx, parts);
  if (!here?.client) return { error: "Open a client's folder to upload papers there." };
  if (!here.upload) return { error: "Ask the owner to let you upload papers for this client." };
  const files = form.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
  if (!files.length || files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD) return { error: "Upload up to 20 papers, 25 MB together." };
  const work = placeOf(parts, ctx.order).work;
  const today = todayInIndia();
  const count = { filed: 0, check: 0, twin: 0 };
  try {
    for (const file of files) {
      const guess = describeFile(file.name.slice(0, 255), "", null, today);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sure = guess.sure && periodChoices(today).includes(guess.period);
      const values = { work_type: work ?? guess.work, document_type: guess.type, period_key: sure ? guess.period : "", status: sure ? ("filed" as const) : ("to_check" as const) };
      const saved = await fileForClient(ctx, here.client, values, { name: file.name, bytes }, (folder, name) => ctx.drive!.save(folder, name, bytes), "document.uploaded");
      if (saved === "drive") return { error: "The drive did not take the file. Try again." };
      count[saved === "twin" ? "twin" : sure ? "filed" : "check"]++;
    }
  } catch {
    return { error: "The drive could not be reached. Try again in a minute." };
  }
  forget(ctx.account!.id);
  const said = [
    count.filed && `${count.filed} ${count.filed === 1 ? "paper" : "papers"} filed for ${here.client.name}`,
    count.check && `${count.check} ${count.check === 1 ? "waits" : "wait"} in To check`,
    count.twin && `${count.twin} ${count.twin === 1 ? "was" : "were"} there already`,
  ].filter(Boolean);
  return { ok: `${said.join(". ")}.` };
}
