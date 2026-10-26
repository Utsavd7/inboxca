import { serverCrypto } from "./crypto";
import { personName } from "./roles";
import { supabaseAdmin, type supabaseServer } from "./supabase";

// A paper as the pages read it; prepared is set on a form InboxCA prepared.
export type Arrived = { id: string; client_id: string; name: string; status: string; work_type: string; document_type: string; period_key: string; received_at: string; email_event_id: string | null; prepared?: unknown; sha256?: string; clients?: { name: string } | null };
// How a paper got where it is, in words: a short line for lists, the whole line and when, the
// email it came in (only for those who may open it), its place before the first import, and
// why it waits when it is under To check.
export type Origin = { short: string; how: string; at: string; mail?: string; from?: string; why?: string };
type Line = { action: string; actor_id: string | null; details: unknown };

const whose = (name: string) => `${name}${name.endsWith("s") ? "'" : "'s"}`;
// "26 Oct, 10:42" in India, with the year when it is not this one.
const when = (at: string) =>
  new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: at.slice(0, 4) === new Date().toISOString().slice(0, 4) ? undefined : "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

// Why a paper waits under To check (PLAN.md 5.5.0): the same file came in before, else what
// InboxCA could not tell from its name.
export function waitsFor(paper: { document_type: string; period_key: string }, twin: boolean) {
  if (twin) return "the same file came in before";
  const unknown = [paper.document_type === "Document" && "type", !paper.period_key && "period"].filter(Boolean).join(" and ");
  return unknown ? `InboxCA could not tell its ${unknown}` : "InboxCA was not sure of its type";
}

// One paper's way in, from what InboxCA recorded: the email's sender, the first log line of who
// brought it in (an upload with no person came through the client's upload link), or the first
// import. A GSTR-2A or 2B JSON is a portal file however it came.
export function originOf(paper: Arrived, seen: { sender?: string; mail?: boolean; line?: Line; by?: string; imported?: boolean; from?: string; twin?: boolean }) {
  const { line, by = "Someone" } = seen;
  const portal = (line?.details as { from?: string } | null)?.from === "portal" || (paper.work_type === "gst" && /^GSTR-2[AB]$/.test(paper.document_type) && /\.json$/i.test(paper.name));
  const sender = seen.sender || paper.clients?.name || "the client";
  const [short, how] = paper.email_event_id
    ? [`Email from ${sender}`, `Filed by InboxCA from ${whose(sender)} email`]
    : paper.prepared
      ? ["Prepared in InboxCA", "Prepared in InboxCA"]
      : line?.action === "document.uploaded"
        ? !line.actor_id
          ? ["Client's upload link", "Sent by the client through their upload link"]
          : portal ? [`Portal file, added by ${by}`, `Added as a portal file by ${by}`] : [`Uploaded by ${by}`, `Uploaded by ${by}`]
        : line?.action === "document.filed"
          ? [`Filed from the drive by ${by}`, `Found in the drive and filed by ${by}`]
          : line?.action === "document.added"
            ? [`Added by ${by}`, `${(line.details as { kind?: string } | null)?.kind === "acknowledgement" ? "Acknowledgement added" : "Filing record written"} by ${by}`]
            : seen.imported ? ["From your old files", "Moved here from your old files"] : ["From the drive", "From the drive"];
  const origin: Origin = { short, how, at: when(paper.received_at) };
  if (seen.mail) origin.mail = paper.email_event_id!;
  if (seen.from) origin.from = seen.from;
  if (paper.status === "to_check") origin.why = waitsFor(paper, !!seen.twin);
  return origin;
}

// Where each of these papers came from, for the person looking: their own access decides which
// emails they may open. The activity log, the first import's plan and other copies of the same
// file are read with the admin client, for this firm and these papers only, which the person
// already sees. old is the one paper whose place before the first import is read.
export async function paperOrigins(supabase: Awaited<ReturnType<typeof supabaseServer>>, firmId: string, papers: Arrived[], old?: string) {
  const admin = supabaseAdmin();
  const events = [...new Set(papers.flatMap((paper) => (paper.email_event_id ? [paper.email_event_id] : [])))];
  const others = papers.filter((paper) => !paper.email_event_id && !paper.prepared).map((paper) => paper.id);
  const waiting = papers.filter((paper) => paper.status === "to_check" && paper.sha256);
  const [{ data: mails }, { data: lines }, { data: people }, { count: imports }, { data: plans }, { data: copies }] = await Promise.all([
    events.length ? supabase.from("email_events").select("id, contact_id, contacts(name_enc)").in("id", events) : Promise.resolve({ data: [] }),
    others.length ? admin.from("activity_log").select("entity_id, action, actor_id, details").eq("firm_id", firmId).in("action", ["document.uploaded", "document.added", "document.filed"]).in("entity_id", others).order("at") : Promise.resolve({ data: [] }),
    others.length ? supabase.rpc("firm_people", { target_firm: firmId }) : Promise.resolve({ data: [] }),
    others.length ? admin.from("requests").select("id", { count: "exact", head: true }).eq("firm_id", firmId).eq("kind", "import") : Promise.resolve({ count: 0 }),
    old && others.includes(old) ? admin.from("requests").select("moved:details->moved").eq("firm_id", firmId).eq("kind", "import").contains("details", { moved: [{ document: old }] }).limit(1) : Promise.resolve({ data: [] }),
    waiting.length ? admin.from("documents").select("id, client_id, sha256").eq("firm_id", firmId).in("client_id", waiting.map((paper) => paper.client_id)).in("sha256", waiting.map((paper) => paper.sha256!)) : Promise.resolve({ data: [] }),
  ]);
  const crypto = serverCrypto();
  const senders = new Map(
    await Promise.all((mails ?? []).map(async (mail) => [mail.id, mail.contact_id && mail.contacts ? await crypto.decrypt(firmId, `contacts/${mail.contact_id}/name`, mail.contacts.name_enc) : ""] as const)),
  );
  const first = new Map<string, Line>();
  for (const line of lines ?? []) if (line.entity_id && !first.has(line.entity_id)) first.set(line.entity_id, line);
  const from = (plans?.[0]?.moved as { document: string; from: string }[] | undefined)?.find((moved) => moved.document === old)?.from;
  return new Map(
    papers.map((paper) => {
      const line = first.get(paper.id);
      const twin = copies?.some((copy) => copy.id !== paper.id && copy.client_id === paper.client_id && copy.sha256 === paper.sha256);
      const by = personName(people?.find((person) => person.user_id === line?.actor_id)?.email);
      return [paper.id, originOf(paper, { sender: senders.get(paper.email_event_id ?? ""), mail: senders.has(paper.email_event_id ?? ""), line, by, imported: !!imports, from: paper.id === old ? from : undefined, twin })] as const;
    }),
  );
}
