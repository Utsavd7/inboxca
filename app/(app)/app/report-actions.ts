"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { deviceName } from "@/src/lib/device";
import { log } from "@/src/lib/logger";
import { currentMember } from "@/src/lib/member";
import { reportFiles, reportFileType, reportKinds, type ReportKind } from "@/src/lib/report";
import { roleLabel } from "@/src/lib/roles";
import { contactEmail } from "@/src/lib/site";
import { sendSystemMail, systemMailReady } from "@/src/lib/system-mail";

const line = (most: number) => z.string().trim().max(most).transform((text) => text.replace(/\s+/g, " "));
const fields = z.object({
  kind: z.enum(Object.keys(reportKinds) as [ReportKind, ...ReportKind[]]),
  subject: line(120).pipe(z.string().min(1)),
  details: z.string().trim().max(4000),
  which: line(120),
  // The page without its query, and the screen's size, from the browser.
  path: z.string().max(300).transform((path) => path.split(/[?#]/)[0]).transform((path) => (/^\/app(\/[\w\-./]*)?$/.test(path) ? path : "")),
  screen: z.string().regex(/^\d{2,5}x\d{2,5}$/).or(z.literal("")),
});

// Each person's recent reports, at most 5 a day and 1 a minute. It lives in the server's memory
// and resets when the server restarts, which is fine for one server.
const sent = new Map<string, number[]>();
function room(person: string, now = Date.now()) {
  const recent = (sent.get(person) ?? []).filter((at) => now - at < 86_400_000);
  if (recent.length >= 5 || recent.some((at) => now - at < 60_000)) return false;
  sent.set(person, [...recent, now]);
  return true;
}

// A report from any active member of a firm, whatever their role (Help, Report a problem or
// idea): checked again here, then emailed to Orelu support with its files and the person as the
// reply address. Nothing of it is kept: the files stay in memory until the email goes. Only what
// the person typed and attached and where they were go with it, never the page's content.
export async function sendReport(form: FormData): Promise<{ error?: string }> {
  const { userId, membership } = await currentMember();
  if (!membership) return { error: "Sign in to your firm first." };
  const read = (name: string) => String(form.get(name) ?? "");
  const parsed = fields.safeParse({ kind: read("kind"), subject: read("subject"), details: read("details"), which: read("which"), path: read("path"), screen: read("screen") });
  if (!parsed.success) return { error: "Choose what it is and type a short subject." };
  const { kind, subject, details, which, path, screen } = parsed.data;
  if (kind === "old" && !which) return { error: "Say which form, rule, due date or file is out of date." };
  const files = form.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
  if (files.length > reportFiles.most || files.reduce((sum, file) => sum + file.size, 0) > reportFiles.bytes) return { error: "Attach at most 3 files, 10 MB in all." };
  const attachments = [];
  for (const [index, file] of files.entries()) {
    const content = Buffer.from(await file.arrayBuffer());
    const type = reportFileType(content);
    if (!type) return { error: `${file.name} is not a picture, a screen recording or a PDF.` };
    const name = file.name.replace(/\.[^.]*$/, "").replace(/[^\w ()-]+/g, " ").trim().slice(0, 60) || `file ${index + 1}`;
    attachments.push({ filename: `${name}.${type.ext}`, content, contentType: type.type });
  }
  if (!systemMailReady()) return { error: `Reports cannot be sent from InboxCA yet. Please write to ${contactEmail}.` };
  if (!room(userId)) return { error: "You have sent several reports already. Please try again later." };

  const agent = (await headers()).get("user-agent") ?? "";
  const version = agent.match(/(?:Edg|Firefox|Chrome|Version)\/(\d+)/)?.[1];
  const browser = `${deviceName(agent)}${version ? `, version ${version}` : ""}`;
  const time = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const text = [
    `${reportKinds[kind]}: ${subject}`,
    details,
    which && `Out of date: ${which}`,
    [`From: ${membership.name} <${membership.email}>, ${roleLabel(membership.role)} at ${membership.firmName}`, `Page: ${path || "Not known"}`, `Browser: ${browser}`, screen && `Screen: ${screen}`, `Time in India: ${time}`, `Files: ${attachments.length || "None"}`].filter(Boolean).join("\n"),
  ].filter(Boolean).join("\n\n");
  try {
    if (!(await sendSystemMail(contactEmail, `[InboxCA] ${reportKinds[kind]}: ${subject}`, text, undefined, { replyTo: membership.email, attachments }))) throw new Error("not sent");
  } catch {
    log.warn("report.not_sent");
    return { error: "It did not send. Please try again in a minute." };
  }
  return {};
}
