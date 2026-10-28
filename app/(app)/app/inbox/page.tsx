import { AlarmClock, CheckCheck, ChevronDown, Clock, Ellipsis, ExternalLink, FileSearch, FolderInput, Inbox as InboxIcon, Info, KeyRound, Mail, MailOpen, PenLine, Reply, Search, Send, ShieldCheck, SlidersHorizontal, Tag as TagIcon, UserRound, X } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import { decidePermission, decideShare, manageEmail, undoPermission } from "@/app/(app)/actions";
import { supabaseAdmin } from "@/src/lib/supabase";
import { rightWords, switchable, type Right } from "@/src/lib/rights";
import { personName } from "@/src/lib/roles";
import { addDays, todayInIndia } from "@/src/lib/calendar";
import { canManageClients } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { documentTypes, folderFor } from "@/src/lib/documents";
import type { FolderOrder } from "@/src/lib/drive";
import { aiReady } from "@/src/lib/ai";
import { aiDraftOf } from "@/src/lib/ai-reply";
import { mailLive } from "@/src/lib/mail-live";
import { paragraphs, sentKind, suggestPapers, whenRange, whens, type MailItem } from "@/src/lib/mail-view";
import { currentMember, myQuestions } from "@/src/lib/member";
import { opensInMailbox } from "@/src/lib/mailbox";
import { askedPaper } from "@/src/lib/records";
import { answerEvent, draftAnswer, statusKind, type Delivery } from "@/src/jobs/answer-mail";
import { answerOf, answerWords } from "@/src/lib/answers";
import { awake, labels, replyReasons } from "@/src/lib/triage";
import { suggestedReply, waitingWords } from "@/src/lib/team-replies";
import { LinkTabs } from "../link-tabs";
import { Item, List, Presence } from "../motion";
import { Pending } from "../pending";
import { Avatar, Badge, Empty, PageHead, Row as ListRow, SidePanel, Toast, storage } from "../ui";
import { clientsOf, contactName, conversation } from "./conversation";
import { manageAnswer } from "./actions";
import { ComposeBox, InboxKeys, LinkBusy, Reading, ReplyBox, ReplyButton } from "./inbox-client";
import "./inbox.css";

const PAGE = 30;
const shows = { "": "All", reply: "Needs reply", mine: "Mine", in: "From clients", out: "Sent to clients" } as const;
const statuses = { reply: "Needs reply", snoozed: "Snoozed", approval: "Waiting for approval", draft: "Reply ready to send", queued: "Sending soon", check: "To check", answered: "Answered by InboxCA", replied: "Answered by your team", notice: "Notice recorded", filed: "Papers saved", none: "Done", reminder: "Reminder sent", team: "Sent by team" } as const;
const sentTags = { reminder: "Reminder sent", inboxca: "Sent by InboxCA", team: "Sent by team" } as const;
type Tag = { text: string; tone: "warn" | "done" | "blue" | "late" | "" };
// What InboxCA did with an email it read (email_outcomes, the most pressing first), in
// a word or two; an email with none of them needed no reply. Snoozed shows its day.
const outcomeTags: Record<string, Tag> = {
  reply: { text: "Needs reply", tone: "warn" },
  approval: { text: "Waiting for approval", tone: "warn" },
  draft: { text: "Reply ready", tone: "warn" },
  check: { text: "To check", tone: "warn" },
  unanswered: { text: "Not answered yet", tone: "blue" },
  queued: { text: "Sending soon", tone: "blue" },
  answered: { text: "Answered by InboxCA", tone: "done" },
  replied: { text: "Answered by your team", tone: "done" },
  notice: { text: "Notice recorded", tone: "blue" },
  filed: { text: "Papers saved", tone: "done" },
  none: { text: "Done", tone: "" },
};
const outcomeKeys = ["reply", "snoozed", "approval", "draft", "queued", "check", "answered", "replied", "notice", "filed", "none"];
// A row carries one chip, the most pressing thing about the email; waits marks one that needs a reply.
type Row = { key: string; href: string; dir: "in" | "out"; client: string; clientId: string | null; at: string; messageId: string; subject: string; snippet: string; tag: Tag; waits?: boolean; request?: string; assignee?: string };
// What a Needs reply request keeps besides its status: snoozed until a day, and who answers
// when a person chose (null for nobody).
type Ask = { snooze?: string; assignee?: string | null };

const india = (at: string, options: Intl.DateTimeFormatOptions) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...options });
const shortTime = (at: string, today: string) => {
  const day = new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return day === today ? india(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : day === addDays(today, -1) ? "Yesterday" : india(at, { day: "numeric", month: "short" });
};
const longTime = (at: string) => india(at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayName = (day: string) => india(`${day}T12:00:00+05:30`, { weekday: "short", day: "numeric", month: "short" });
const uuid = /^[0-9a-f-]{36}$/;
// Papers to attach. InboxCA's own prepared returns stay (a CA often sends a draft to check), named so staff can tell.
const attachable = (papers: { id: string; name: string; prepared: unknown }[] | null) =>
  (papers ?? []).map(({ id, name, prepared }) => ({ id, name: prepared ? `${name} (Prepared by InboxCA, not the filed copy)` : name }));

type Search = Record<"mail" | "sent" | "client" | "show" | "status" | "when" | "q" | "before" | "cq" | "cpage" | "compose" | "approved" | "error" | "replied" | "written" | "unsent" | "answer" | "decided" | "cleared" | "confirm" | "file" | "snoozed" | "assigned" | "filed" | "edit" | "went" | "stopped" | "panel", string | undefined>;

// What a slow part gives, once it has it, so the page around it shows at once (Suspense).
async function Later({ children }: { children: Promise<React.ReactNode> }) {
  return <>{await children}</>;
}

// The outline of an open email, while it is read from the mailbox.
const paneSkeleton = (on: boolean) => (
  <div className={`skeleton ib-skeleton${on ? " is-on" : ""}`} aria-hidden>
    <span className="skeleton-title" />
    <span className="ib-skel-meta" />
    <span className="ib-skel-acts" />
    {Array.from({ length: 4 }, (_, line) => <span key={line} />)}
  </div>
);

// Every email with the firm's clients, both ways (PLAN.md 5.5): the list from InboxCA's
// records (which client, when, what waits) shows at once; subjects and first lines read live
// from the firm's mailbox, sent mail read live from its Sent folder, and the open
// conversation read live too, each stream in after. InboxCA keeps no copy of any of it.
// Questions, papers and files waiting for the team sit in a short list above.
export default async function Inbox({ searchParams }: { searchParams: Promise<Partial<Search>> }) {
  const { supabase, membership, userId } = await currentMember();
  if (!membership) redirect("/app");
  const sp = await searchParams;
  const firm = membership.firmId;
  const today = todayInIndia();
  const show = (sp.show && sp.show in shows ? sp.show : "") as keyof typeof shows;
  const status = (sp.status && sp.status in statuses ? sp.status : show === "reply" || show === "mine" ? "reply" : "") as keyof typeof statuses | "";
  const when = sp.when && sp.when in whens ? sp.when : "";
  const q = (sp.q ?? "").trim().slice(0, 200);
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : "";
  // Which emails a status keeps: what InboxCA did with each (email_outcomes). Needs
  // reply leaves out what is snoozed to a later day; Mine is what waits for this person
  // (public.team_replies: who each waiting email is for, and how long it has waited).
  const [{ data: chosenClient }, { data: replies }] = await Promise.all([
    sp.client && uuid.test(sp.client) ? supabase.from("clients").select("id, name").eq("id", sp.client).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("team_replies", { target_firm: membership.firmId }),
  ]);
  const replyOf = new Map(replies?.map((reply) => [reply.email_id, reply]));
  const myReplies = (replies ?? []).filter((reply) => reply.assignee === userId);
  const only = show === "mine" ? myReplies.map((reply) => reply.email_id) : null;
  const mine = myReplies.filter((reply) => !chosenClient || reply.client_id === chosenClient.id).length;
  const filters = { client: chosenClient?.id, show: show || undefined, status: sp.status && sp.status in statuses ? sp.status : undefined, when: when || undefined, q: q || undefined };
  const href = (change: Partial<Search> = {}) => {
    const params = new URLSearchParams(Object.entries({ ...filters, ...change }).filter((entry): entry is [string, string] => !!entry[1]));
    return `/app/inbox${params.size ? `?${params}` : ""}`;
  };
  const wantIn = show !== "out" && status !== "reminder" && status !== "team";
  const wantOut = !["reply", "mine", "in"].includes(show) && !outcomeKeys.includes(status);
  const range = whenRange(when, today);
  const until = [range.until, before].filter(Boolean).sort()[0];
  let events = supabase.from("email_outcomes").select("id, client_id, contact_id, received_at, label, decision_source, provider_message_id, outcomes, clients(name), contacts(name_enc)").eq("firm_id", firm);
  if (chosenClient) events = events.eq("client_id", chosenClient.id);
  if (status === "none") events = events.filter("outcomes", "eq", "{}");
  else if (outcomeKeys.includes(status)) events = events.contains("outcomes", [status]);
  if (range.from) events = events.gte("received_at", range.from);
  if (until) events = events.lt("received_at", until);
  if (only) events = events.in("id", only);
  let needsCount = supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending").or(awake(today));
  let inCount = supabase.from("email_events").select("id", { count: "exact", head: true }).eq("firm_id", firm);
  if (chosenClient) [needsCount, inCount] = [needsCount.eq("client_id", chosenClient.id), inCount.eq("client_id", chosenClient.id)];
  const cq = (sp.cq ?? "").trim().slice(0, 80);
  const cpage = Math.min(Math.max(0, Number(sp.cpage) || 0), 500);
  let pick = supabase.from("clients").select("id, name").is("archived_at", null).order("name").range(cpage * 8, cpage * 8 + 8);
  if (cq) pick = pick.ilike("name", `%${cq.replace(/[\\%_]/g, "\\$&")}%`);
  const owner = membership.role === "owner";
  // InboxCA's answers that wait for a person (Ask me first) or go soon (Auto), oldest first,
  // unless a person answers the email instead.
  const answerList = supabase.from("email_events").select("id, label, delivery, clients(name)").eq("firm_id", firm).in("delivery->>ack", ["held", "queued", "sending", "ready"]).order("received_at").limit(20)
    .then(async ({ data }) => {
      const { data: taken } = data?.length ? await supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("entity_type", "email").in("entity_id", data.map((row) => row.id)) : { data: [] };
      return (data ?? []).filter((row) => !taken?.some((ask) => ask.entity_id === row.id)).map((row) => ({ ...row, delivery: row.delivery as Delivery }));
    });
  const [{ data: rows }, { count: needs }, { count: fromClients }, { data: pickList }, { data: waiting }, { data: toCheck }, { data: papers }, toAnswer, { data: people }, { data: accounts }, { data: decided }, { data: week }, { data: drafted }] = await Promise.all([
    wantIn && (!only || only.length) ? events.order("received_at", { ascending: false }).order("id").limit(q ? 500 : PAGE).overrideTypes<{ id: string; received_at: string; provider_message_id: string }[]>() : Promise.resolve({ data: [] as never[] }),
    needsCount,
    inCount,
    pick,
    supabase.from("requests").select("id, entity_id, reason_code, details").eq("kind", "team_reply").eq("status", "pending").limit(1000),
    supabase.from("documents").select("id, client_id, name, clients(name)").eq("status", "to_check").limit(50),
    supabase.from("shares").select("id, contact_id, documents(name, clients(name))").eq("status", "waiting").limit(50),
    // Questions this person may answer (5.17.2), the same ones Today counts.
    myQuestions(),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabaseAdmin().from("connected_accounts").select("kind, provider, status, settings").eq("firm_id", firm),
    sp.decided && uuid.test(sp.decided) ? supabase.from("requests").select("id, status, reason_code, details").eq("kind", "permission").eq("id", sp.decided).maybeSingle() : Promise.resolve({ data: null }),
    // The owner's week of approvals (5.17.3, #51): who approved what, newest first.
    owner
      ? supabaseAdmin().from("activity_log").select("at, actor_id, action, details").eq("firm_id", firm)
        .in("action", ["permission.allowed", "permission.always", "device.approved", "office.confirm", "office.today"])
        .gt("at", addDays(today, -7)).order("at", { ascending: false }).limit(50)
      : Promise.resolve({ data: null }),
    // Waiting emails with an AI draft kept: only whether one is there, never the draft.
    supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("status", "pending").not("draft_enc", "is", null).limit(1000),
  ]);
  const emailOf = new Map(people?.map((person) => [person.user_id, person.email]));
  // A question in words, with the person's name: "Sunil asks to upload a paper".
  const asking = (ask: { reason_code: string | null; details: unknown }) => {
    const details = ask.details as { by: string; until?: string };
    return { name: personName(emailOf.get(details.by)), what: ask.reason_code === "time" ? `work until ${details.until} today` : rightWords[ask.reason_code as Right] };
  };
  const answering = toAnswer.find((ask) => ask.id === sp.answer);
  const approvalWords = (action: string, details: { right?: string; for?: string; kind?: string }) =>
    ({
      "permission.allowed": details.right === "time" ? `gave ${personName(emailOf.get(details.for ?? ""))} more time` : `allowed ${personName(emailOf.get(details.for ?? ""))} once to ${rightWords[details.right as Right]}`,
      "permission.always": `always allowed ${personName(emailOf.get(details.for ?? ""))} to ${rightWords[details.right as Right]}`,
      "device.approved": details.kind === "personal" ? "allowed a laptop away from the office" : details.kind === "office" ? "approved an office PC" : "approved a laptop",
      "office.confirm": "approved an office internet connection",
      "office.today": "allowed a different internet connection for a day",
    })[action] ?? action;
  const approver = canManageClients(membership.role);
  const mailbox = accounts?.find((account) => account.kind === "mail");
  const drive = accounts?.find((account) => account.kind === "drive");
  const connected = mailbox?.status === "connected";
  const admin = supabaseAdmin();
  const crypto = serverCrypto();
  const events_ = rows ?? [];
  const pending = new Map((waiting ?? []).map((request) => [request.entity_id, request]));
  const labelTag = (label: string | null): Tag => ({ text: labels[(label ?? "other") as keyof typeof labels] ?? labels.other, tone: "" });
  const askOf = (eventId: string) => (pending.get(eventId)?.details ?? {}) as Ask;
  const snoozedTill = (eventId: string) => (askOf(eventId).snooze ?? "") > today ? askOf(eventId).snooze! : null;
  // A teammate an email is given to: their avatar's name, and how a line names them.
  const nameOf = (user: string) => personName(emailOf.get(user));
  const whoWords = (user: string) => (user === userId ? "you" : nameOf(user));
  // Who a waiting email is for: the client's person unless someone chose; a snoozed one only by choice.
  const forWho = (eventId: string) => (replyOf.has(eventId) ? replyOf.get(eventId)!.assignee : askOf(eventId).assignee) ?? undefined;
  // What InboxCA did with an email, as its badge: snoozed shows until when.
  const outcomeTag = (eventId: string, outcome = "none"): Tag =>
    outcome === "snoozed" ? { text: snoozedTill(eventId) ? `Snoozed until ${dayName(snoozedTill(eventId)!)}` : "Snoozed", tone: "blue" } : outcomeTags[outcome] ?? outcomeTags.none;
  // An email's one chip, the most pressing first: what InboxCA did, and for one that needs a
  // reply, red once past the firm's reply time, then an AI draft, then how long it waited.
  // Its label shows on the open email. Filtered by what InboxCA did, each says that.
  const chipOf = (event: { id: string; outcomes: string[] | null }): Tag => {
    const first = status && event.outcomes?.includes(status) ? status : event.outcomes?.[0] ?? "none";
    const reply = replyOf.get(event.id);
    const waited = reply && reply.days > 0 ? waitingWords(reply.days) : "";
    if (first !== "reply") return outcomeTag(event.id, first);
    if (waited && reply?.late) return { text: waited, tone: "late" };
    if (drafted?.some((ask) => ask.entity_id === event.id)) return { text: "AI draft ready", tone: "blue" };
    return waited ? { text: waited, tone: "warn" } : outcomeTags.reply;
  };
  // The emails' rows from InboxCA's own records: who, when and what InboxCA did. The subject
  // and first line are filled in from the mailbox.
  const storedRows = async (list: typeof events_): Promise<Row[]> => {
    return Promise.all(
      list.map(async (event) => {
        return {
          key: event.id,
          href: href({ mail: event.id }),
          dir: "in" as const,
          client: event.clients?.name ?? ((await contactName(firm, event)) || "A contact"),
          clientId: event.client_id,
          at: event.received_at,
          messageId: event.provider_message_id,
          subject: "",
          snippet: "",
          tag: chipOf(event),
          waits: event.outcomes?.[0] === "reply",
          request: pending.get(event.id)?.id,
          assignee: forWho(event.id),
        };
      }),
    );
  };
  // Without a search the newest emails are known at once; a search needs the mailbox first.
  const firstRows = q ? [] : await storedRows(events_.slice(0, PAGE));

  // The list as the mailbox has it: subjects and first lines of the listed emails, and the
  // newest sent ones that match, to a client the person may see. Only what this page shows
  // is read; nothing is kept.
  const listed = (async () => {
    if (!connected) return { list: [] as Row[], older: null, failed: "not_connected" };
    let addresses: string[] = [];
    if (chosenClient && wantOut) {
      // Sent mail of one client is searched by that client's own addresses.
      const [{ data: own }, { data: links }] = await Promise.all([
        admin.from("clients").select("email_enc").eq("id", chosenClient.id).single(),
        admin.from("contact_clients").select("contact_id, contacts(email_enc)").eq("client_id", chosenClient.id),
      ]);
      addresses = [
        ...(own?.email_enc ? [await crypto.decrypt(firm, `clients/${chosenClient.id}/email`, own.email_enc)] : []),
        ...(await Promise.all((links ?? []).filter((link) => link.contacts?.email_enc).map((link) => crypto.decrypt(firm, `contacts/${link.contact_id}/email`, link.contacts!.email_enc)))),
      ].slice(0, 20);
    }
    const sentAsk = wantOut && (!chosenClient || addresses.length) ? { limit: PAGE, ...(addresses.length && { to: addresses }), since: range.from, before: until, reminders: status === "reminder" } : null;
    const live = events_.length || sentAsk ? await mailLive(firm, "list", { inbox: events_.map((event) => event.provider_message_id), q: q || undefined, sent: sentAsk }) : { inbox: [], sent: null };
    const failed = "error" in live ? live.error : null;
    const liveIn = new Map(("error" in live ? [] : live.inbox).map((item) => [item.messageId, item]));
    const inRows = (q ? await storedRows(events_.filter((event) => liveIn.has(event.provider_message_id)).slice(0, PAGE)) : firstRows).map((row) => {
      const item = liveIn.get(row.messageId);
      return { ...row, subject: item?.subject ?? (failed ? "Subject not available just now" : "(no subject)"), snippet: item?.snippet ?? "" };
    });
    const sentItems = "error" in live ? [] : (live.sent ?? []).filter((item) => status !== "team" || sentKind(item.messageId) === "team");
    const parties = await clientsOf(firm, sentItems.flatMap((item) => item.to));
    const partyIds = [...new Set([...parties.values()].flat())];
    const { data: visible } = partyIds.length ? await supabase.from("clients").select("id, name").in("id", partyIds) : { data: [] };
    const sentClient = (item: MailItem) => visible?.find((row) => (!chosenClient || row.id === chosenClient.id) && item.to.some((address) => parties.get(address)?.includes(row.id)));
    const outRows: Row[] = sentItems.flatMap((item) => {
      const to = sentClient(item);
      return to ? [{ key: item.messageId, href: href({ sent: item.messageId }), dir: "out" as const, client: to.name, clientId: to.id, at: item.date, messageId: item.messageId, subject: item.subject || "(no subject)", snippet: item.snippet, tag: { text: sentTags[sentKind(item.messageId)], tone: "" as const } }] : [];
    });
    const list = [...inRows, ...outRows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, PAGE);
    const older = (events_.length >= PAGE || (!("error" in live) && (live.sent?.length ?? 0) >= PAGE)) && list.length ? href({ before: list.at(-1)!.at }) : null;
    return { list, older, failed };
  })();

  const openKey = sp.mail ?? sp.sent ?? "";
  // Where an action on this page comes back to: the same list, with the same email open.
  const here = href(sp.mail ? { mail: sp.mail } : sp.sent ? { sent: sp.sent } : {});
  const gmail = mailbox?.provider === "gmail" || opensInMailbox(((mailbox?.settings ?? {}) as { imap?: { host?: string } }).imap?.host ?? "");
  const errors: Record<string, string> = {
    mailbox: "The email could not be sent. Try again in a minute. If it fails again, the owner needs to check the firm email in Settings.",
    reply: "Write the reply first.",
    write: "Write a subject and the email first.",
    to: "Choose who gets the email.",
    needs: "You need permission to send papers or files to this client. Ask for permission on the client's Documents tab.",
    upload: "Files can be up to 25 MB together.",
    answer: "That reply is no longer waiting. Open the email to see where it stands.",
    started: "It had already gone, so it could not be stopped.",
  };
  const answers = await answerList;
  // What waits for the team besides email, as one line of counts under the title, each opening
  // its list beside the page (?panel=), where Undo, Send and Approve are one click away.
  const panelHref = (panel: string) => `${here}${here.includes("?") ? "&" : "?"}panel=${panel}`;
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const queued = answers.filter((row) => row.delivery.ack !== "held").length;
  const waits = [
    { panel: "asks", Icon: KeyRound, n: toAnswer.length, text: count(toAnswer.length, "permission request") },
    { panel: "papers", Icon: ShieldCheck, n: papers?.length ?? 0, text: `${count(papers?.length ?? 0, "paper")} to approve` },
    { panel: "replies", Icon: Send, n: answers.length, text: `${count(answers.length, "reply", "replies")} ${queued === answers.length ? "going out" : queued ? "by InboxCA" : "ready to send"}` },
    { panel: "check", Icon: FileSearch, n: toCheck?.length ?? 0, text: `${count(toCheck?.length ?? 0, "paper")} to check` },
  ].filter((wait) => wait.n);
  // The filters beyond the three views, each in use as a chip that removes it.
  const direction = show === "in" || show === "out" ? show : "";
  const active = ([
    [direction && shows[direction], href({ show: undefined })],
    [chosenClient?.name, href({ client: undefined })],
    [sp.status && sp.status in statuses && statuses[sp.status as keyof typeof statuses], href({ status: undefined })],
    [when && whens[when as keyof typeof whens], href({ when: undefined })],
  ] as const).filter((chip): chip is readonly [string, string] => !!chip[0]);
  const team = (people ?? []).filter((person) => person.status === "active").sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId));
  // Mark all as done takes every email of the list that waits for a reply, after a preview
  // (not for a search, whose list is only what the mailbox found).
  const clearable = firstRows.filter((row) => row.request);
  const cleared = (sp.cleared ?? "").split(".").filter((id) => uuid.test(id)).slice(0, 100);
  const touched = waiting?.find((row) => row.id === (sp.snoozed ?? sp.assigned));

  // Writing to a client: the client is picked like the filter's, then who gets the email is
  // picked from the client's own address and its contact people (row level security decides).
  const composing = connected && !!sp.compose;
  const { data: writeTo } = composing && uuid.test(sp.compose ?? "")
    ? await supabase.from("clients").select("id, name, email_enc, contact_clients(contact_id, contacts(name_enc, email_enc))").eq("id", sp.compose!).is("archived_at", null).maybeSingle()
    : { data: null };
  const recipients = writeTo
    ? [
        ...(writeTo.email_enc ? [{ value: "client", label: `${writeTo.name}, ${await crypto.decrypt(firm, `clients/${writeTo.id}/email`, writeTo.email_enc)}` }] : []),
        ...(await Promise.all(writeTo.contact_clients.filter((link) => link.contacts).map(async (link) => ({ value: link.contact_id, label: `${await crypto.decrypt(firm, `contacts/${link.contact_id}/name`, link.contacts!.name_enc)}, ${await crypto.decrypt(firm, `contacts/${link.contact_id}/email`, link.contacts!.email_enc)}` })))),
      ]
    : [];
  const mayWriteAttach = !!writeTo && membership.may("send", writeTo.id);
  const { data: writePapers } = mayWriteAttach ? await supabase.from("documents").select("id, name, prepared").eq("client_id", writeTo.id).eq("status", "filed").order("received_at", { ascending: false }).limit(50) : { data: [] };
  // The paging client picker, for the filter, for writing and for filing: a search, eight
  // names a page.
  const clientOptions = (keep: Partial<Search>, link: (id: string) => string, current?: string) => (
    <>
      <Form action="/app/inbox" scroll={false} role="search">
        {Object.entries(keep).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
        <input type="search" name="cq" defaultValue={cq} placeholder="Find a client" aria-label="Find a client" />
      </Form>
      {current && !keep.compose && <Link href={href({ client: undefined })}>All clients</Link>}
      {pickList?.slice(0, 8).map((row) => (
        <Link key={row.id} href={link(row.id)} aria-current={row.id === current ? "true" : undefined}><Avatar name={row.name} />{row.name}</Link>
      ))}
      {!pickList?.length && <span className="ib-note">No client by that name</span>}
      {(pickList?.length ?? 0) > 8 && <Link href={href({ compose: keep.compose, mail: keep.mail, file: keep.file, cq: cq || undefined, cpage: String(cpage + 1) })}>More clients</Link>}
    </>
  );
  const clientPicker = (summary: string, keep: Partial<Search>, link: (id: string) => string, current?: string, open = !!cq || !!sp.cpage) => (
    // A pick closes the menu: it opens afresh once the choice changes.
    <details key={`${summary}${current}${sp.file}`} className="ib-menu" open={open}>
      <summary>{summary}<ChevronDown size={14} aria-hidden /></summary>
      <div className="ib-pop">{clientOptions(keep, link, current)}</div>
    </details>
  );

  // The list: rows from InboxCA's records first, their subject and first line as an outline
  // until the mailbox answers (live false), then the whole list with sent mail in its place.
  const listView = (list: Row[], live: boolean, older?: string | null) => (
    <List label="Emails" rise={!live}>
      {list.map((row) => (
        <Item key={row.key} className="ib-row" aria-current={row.key === openKey ? "true" : undefined} data-waits={row.waits || undefined}>
          <Link href={row.href} scroll={false}>
            <Avatar name={row.client} />
            <span className="ib-row-main">
              <span className="ib-row-top">
                <strong>{row.dir === "out" && <span className="ib-sent-to">To </span>}{row.client}</strong>
                <time dateTime={row.at}>{shortTime(row.at, today)}</time>
              </span>
              {live ? <span className="ib-subject">{row.subject}</span> : <span className="skel ib-skel-line" aria-hidden />}
              <span className="ib-row-foot">
                {live ? <span className="ib-snippet">{row.snippet}</span> : <span className="skel ib-skel-line short" aria-hidden />}
                <Badge tone={row.tag.tone} plain={!row.tag.tone}>{row.tag.text}</Badge>
                {row.waits && row.tag !== outcomeTags.reply && <span className="sr-only">Needs reply</span>}
                {row.assignee && (
                  <span className="ib-who-has" title={`For ${whoWords(row.assignee)}`}>
                    <Avatar name={nameOf(row.assignee)} />
                    <span className="sr-only">For {whoWords(row.assignee)}</span>
                  </span>
                )}
              </span>
            </span>
          </Link>
          <span className="ib-acts">
            {row.request && (
              <form action={manageEmail}>
                <input type="hidden" name="request" value={row.request} />
                <input type="hidden" name="back" value={here} />
                <Pending className="b b-secondary b-icon" name="intent" value="done" aria-label="Mark done" title="Mark done"><CheckCheck size={16} aria-hidden /></Pending>
              </form>
            )}
            {row.clientId && <Link className="b b-secondary b-icon" href={`/app/clients/${row.clientId}`} aria-label="Open client" title={`Open ${row.client}`}><UserRound size={16} aria-hidden /></Link>}
          </span>
        </Item>
      ))}
      {older && <li key="older" className="ib-more"><Link href={older}>Older emails</Link></li>}
    </List>
  );
  const filtered = Object.values(filters).some(Boolean) || !!before;
  const listed_ = listed.then(({ list, older, failed }) => (
    <>
      {failed === "unreachable" && <p className="alert" role="alert">The firm email could not be reached just now, so subjects and text are missing. Try again in a minute.</p>}
      {list.length ? (
        listView(list, true, older)
      ) : q ? (
        <Empty Icon={Search} title="No emails match">
          <span>Try other words, or clear the search.</span>
          <Link className="b b-secondary" href={href({ q: undefined })}>Clear search</Link>
        </Empty>
      ) : status === "reply" && !before ? (
        <Empty Icon={CheckCheck} kind="done" title={show === "mine" ? "Nothing waits for you" : "No email needs a reply"}>
          <span>{show === "mine" ? "Emails given to you show here." : "You are all caught up. New questions from clients show here."}</span>
          <Link className="b b-secondary" href={href({ show: undefined, status: undefined })}>See all email</Link>
        </Empty>
      ) : (
        <Empty Icon={InboxIcon} kind="reply" title={filtered ? "No emails here" : "No client email yet"}>
          <span>{filtered ? "Nothing matches these filters." : "New emails from your clients show here, sorted."}</span>
          {filtered && <Link className="b b-secondary" href="/app/inbox">Show all email</Link>}
        </Empty>
      )}
    </>
  ));

  // The open email and its conversation, read live, while the rest of the page shows.
  const opening = openKey ? (async () => {
    const open = await conversation(supabase, firm, { mail: sp.mail && uuid.test(sp.mail) ? sp.mail : undefined, sent: sp.mail ? undefined : sp.sent?.slice(0, 998) });
    if (!open) return <p className="ib-pick">This email is not available.</p>;
    const { event, opened } = open;
    if (!opened) return <p className="ib-pick" role="alert">{open.error ? "The firm email could not be reached just now. Try again in a minute." : "This email is no longer in the firm email account."}</p>;
    const clientId = open.client?.id ?? null;
    const request = event ? pending.get(event.id) : undefined;
    const inIds = open.messages.filter((message) => message.box === "inbox").map((message) => message.messageId);
    const [{ data: threadEvents }, { data: clientPapers }, { data: links }, { data: fileTo }, { data: what }, { data: sends }, { data: notice }, sender, aiWork] = await Promise.all([
      inIds.length ? supabase.from("email_events").select("id, provider_message_id").eq("firm_id", firm).in("provider_message_id", inIds) : Promise.resolve({ data: [] as { id: string; provider_message_id: string }[] }),
      clientId && event ? supabase.from("documents").select("id, name, document_type, period_key, prepared").eq("client_id", clientId).eq("status", "filed").order("received_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] as { id: string; name: string; document_type: string; period_key: string; prepared: null }[] }),
      request?.reason_code === "client_unclear" && event ? supabase.from("contact_clients").select("client_id, clients(name)").eq("contact_id", event.contact_id ?? "") : Promise.resolve({ data: [] as { client_id: string; clients: { name: string } | null }[] }),
      // File to a client, for mail InboxCA could not match: the client picked, then confirmed.
      event && !event.client_id && sp.file && uuid.test(sp.file) ? supabase.from("clients").select("id, name").eq("id", sp.file).is("archived_at", null).maybeSingle() : Promise.resolve({ data: null }),
      // What InboxCA did with it, and the paper sent or waiting and the notice recorded that
      // its line links to.
      event ? supabase.from("email_outcomes").select("outcomes").eq("id", event.id).maybeSingle() : Promise.resolve({ data: null }),
      event ? supabase.from("shares").select("document_id, status, documents(name)").eq("email_event_id", event.id).in("status", ["sent", "waiting"]).limit(10) : Promise.resolve({ data: [] as { document_id: string; status: string; documents: { name: string } | null }[] }),
      event ? supabase.from("tasks").select("id").eq("kind", "notice").eq("details->>email_event_id", event.id).limit(1).maybeSingle() : Promise.resolve({ data: null }),
      event ? event.clients?.name ?? contactName(firm, event).then((name) => name || "A contact") : "",
      // AI's sealed draft for an email waiting for a person, or why AI left it to them; not for
      // someone who may only view, as it may carry the upload link.
      request && event && !membership.viewOnlyUntil ? aiDraftOf(firm, request.id, event.id).catch(() => null) : null,
    ]);
    // InboxCA's answer shows on its own above, so the line says what else InboxCA did.
    const outcomes = what?.outcomes ?? [];
    const outcome = outcomes.find((key) => key !== "draft" && key !== "queued") ?? (outcomes.length ? "" : "none");
    const { data: answerRow } = event && (outcomes.includes("draft") || outcomes.includes("queued")) ? await admin.from("email_events").select(answerEvent).eq("id", event.id).maybeSingle() : { data: null };
    const drafted = answerRow ? await draftAnswer(admin, answerRow, !membership.viewOnlyUntil) : null;
    const held = outcomes.includes("draft");
    const shared = sends?.find((share) => share.status === (outcome === "approval" ? "waiting" : "sent"));
    const eventOf = new Map(threadEvents?.map((row) => [row.provider_message_id, row.id]));
    // Every paper saved from the conversation, the open email's own too, so each shows as a file.
    const savedFrom = [...new Set([...(threadEvents ?? []).map((row) => row.id), ...(event ? [event.id] : [])])];
    const { data: saved } = savedFrom.length
      ? await supabase.from("documents").select("id, name, email_event_id, work_type, period_key, status, received_at, size").in("email_event_id", savedFrom)
      : { data: [] };
    const order = ((drive?.settings ?? {}) as { folder_order?: FolderOrder }).folder_order ?? "year_client_work";
    const place = (doc: NonNullable<typeof saved>[number]) => folderFor(order, open.client?.name ?? "", { work: doc.work_type as never, period: doc.period_key, receivedAt: doc.received_at ?? "", toCheck: doc.status === "to_check" }).join(" / ");
    const kind = opened.box === "sent" ? sentKind(opened.messageId) : null;
    const openTag: Tag | null = event ? chipOf({ id: event.id, outcomes }) : kind ? { text: sentTags[kind], tone: "" } : null;
    const asked = askedPaper(opened.subject, opened.text);
    const suggested = clientPapers ? suggestPapers(`${opened.subject}\n${opened.text}`, clientPapers, asked, [...documentTypes, ...((membership.settings.document_types ?? []) as string[])]).map((doc) => doc.id) : [];
    // Snooze and who answers, for an email that needs a reply.
    const openAsk: Ask = event ? { ...askOf(event.id), assignee: forWho(event.id) } : {};
    // What InboxCA did with the email in a line, with a link to what was sent or recorded.
    const filedHere = saved?.filter((doc) => doc.email_event_id === event?.id && doc.status !== "to_check").length ?? 0;
    const paperLink: [string, string] | undefined = shared ? [`/app/files/${shared.document_id}/view`, "View the paper"] : undefined;
    const did = event && ({
      snoozed: { text: `Snoozed. It comes back to Needs reply on ${dayName(snoozedTill(event.id) ?? today)}.` },
      reply: { text: `${replyReasons[request?.reason_code ?? ""] ?? "Waits for your team"}${openAsk.assignee ? `. Given to ${whoWords(openAsk.assignee)}` : ""}.` },
      approval: { text: `InboxCA found ${shared?.documents?.name ?? "the paper"}. It goes to the client once someone approves it.`, link: paperLink },
      check: { text: "InboxCA saved its papers under To check. Check their type and period.", link: event.client_id ? [`/app/clients/${event.client_id}?tab=files`, "Check them"] : undefined },
      unanswered: { text: "The client asked for a paper. InboxCA has not sent it yet." },
      answered: { text: shared ? `InboxCA sent ${shared.documents?.name ?? "the paper"} as a secure link.` : answerWords[answerOf(event.label) ?? "received"][1], link: paperLink },
      replied: { text: "Your team answered it." },
      notice: { text: "InboxCA recorded the notice. Check its dates.", link: notice ? [`/app/notices?notice=${notice.id}`, "Open the notice"] : undefined },
      filed: { text: `InboxCA saved ${filedHere === 1 ? "its paper" : `its ${filedHere} papers`} in ${open.client?.name ?? "the client"}'s folders.` },
      none: { text: "Done. Nothing waits for anyone." },
    } as Record<string, { text: string; link?: [string, string] }>)[outcome];
    // The reply box, unless InboxCA's own reply waits in its place (and is not being edited).
    const replying = !answerRow || (sp.edit === "answer" && held);
    return (
      <ViewTransition enter="ib-in" exit="ib-out" default="none">
        <div className="ib-convo">
          {/* Who and what, then the actions as icons; the conversation scrolls under it and the
              reply sits at the foot, so neither ever hides the other. */}
          <header className="ib-head">
            <div className="ib-head-top">
              <Avatar name={open.client?.name ?? (event ? sender : membership.firmName)} />
              <p className="ib-head-who">
                {open.client ? <Link href={`/app/clients/${open.client.id}`} aria-label={`Open ${open.client.name}`}>{open.client.name}</Link> : <strong>{sender}</strong>}
                <time dateTime={opened.date}>{longTime(opened.date)}</time>
              </p>
              <div className="ib-tools" role="toolbar" aria-label="Email actions">
                {event?.client_id && connected && (replying ? <ReplyButton /> : held && <Link className="b b-ghost b-icon" href={`${href({ mail: event.id, edit: "answer" })}#reply-text`} scroll={false} aria-label="Reply" data-tip="Reply (r)"><Reply size={16} aria-hidden /></Link>)}
                {request && (
                  <form action={manageEmail}>
                    <input type="hidden" name="request" value={request.id} />
                    <input type="hidden" name="back" value={here} />
                    <Pending className="b b-ghost b-icon" name="intent" value="done" data-key="e" aria-label="Mark done" data-tip="Mark done (e)"><CheckCheck size={16} aria-hidden /></Pending>
                  </form>
                )}
                {request && event && (snoozedTill(event.id) ? (
                  <form action={manageEmail}>
                    <input type="hidden" name="request" value={request.id} />
                    <input type="hidden" name="back" value={here} />
                    <Pending className="b b-ghost b-icon" name="intent" value="wake" aria-label="Back to Needs reply now" data-tip="Back to Needs reply now"><AlarmClock size={16} aria-hidden /></Pending>
                  </form>
                ) : (
                  <details key={`snooze${request.id}`} className="ib-menu">
                    <summary className="b b-ghost b-icon" data-key="h" aria-label="Snooze" data-tip="Snooze (h)"><AlarmClock size={16} aria-hidden /></summary>
                    <div className="ib-pop" role="group" aria-label="Snooze until">
                      <form action={manageEmail} className="ib-pop-list">
                        <input type="hidden" name="request" value={request.id} />
                        <input type="hidden" name="back" value={here} />
                        <input type="hidden" name="intent" value="snooze" />
                        <Pending name="until" value={addDays(today, 1)}>Tomorrow<small>{dayName(addDays(today, 1))}</small></Pending>
                        <Pending name="until" value={addDays(today, 7)}>Next week<small>{dayName(addDays(today, 7))}</small></Pending>
                      </form>
                      <form action={manageEmail} className="ib-day">
                        <input type="hidden" name="request" value={request.id} />
                        <input type="hidden" name="back" value={here} />
                        <input type="hidden" name="intent" value="snooze" />
                        <input type="date" name="until" min={addDays(today, 1)} max={addDays(today, 365)} required aria-label="Snooze until a date" />
                        <Pending className="b b-secondary">Snooze</Pending>
                      </form>
                    </div>
                  </details>
                ))}
                {request && (
                  <details key={`assign${request.id}${openAsk.assignee}`} className="ib-menu">
                    <summary className="b b-ghost b-icon" aria-label={openAsk.assignee ? `For ${whoWords(openAsk.assignee)}. Assign to someone else` : "Assign"} data-tip={openAsk.assignee ? `For ${whoWords(openAsk.assignee)}` : "Assign"}>
                      {openAsk.assignee ? <Avatar name={nameOf(openAsk.assignee)} /> : <UserRound size={16} aria-hidden />}
                    </summary>
                    <form action={manageEmail} className="ib-pop" aria-label="Assign to">
                      <input type="hidden" name="request" value={request.id} />
                      <input type="hidden" name="back" value={here} />
                      <input type="hidden" name="intent" value="assign" />
                      {team.map((person) => (
                        <Pending key={person.user_id} name="who" value={person.user_id} aria-current={person.user_id === openAsk.assignee ? "true" : undefined}>
                          <Avatar name={personName(person.email)} />
                          <span className="grow">{personName(person.email)}{person.user_id === userId && " (you)"}<small>{person.email}</small></span>
                        </Pending>
                      ))}
                      {openAsk.assignee && <Pending name="who" value="">Nobody</Pending>}
                    </form>
                  </details>
                )}
                {event && (
                  <details key={`${event.id}${event.label}`} className="ib-menu">
                    <summary className="b b-ghost b-icon" aria-label="Change label" data-tip="Change label"><TagIcon size={16} aria-hidden /></summary>
                    <form action={manageEmail} className="ib-pop" aria-label="What this email is">
                      <input type="hidden" name="email" value={event.id} />
                      <input type="hidden" name="intent" value="label" />
                      {Object.entries(labels).map(([value, label]) => (
                        <Pending key={value} name="label" value={value} aria-current={value === (event.label ?? "other") ? "true" : undefined}>{label}</Pending>
                      ))}
                    </form>
                  </details>
                )}
                {event && gmail && <a className="b b-ghost b-icon" href={`/app/inbox/${event.id}/open`} target="_blank" rel="noreferrer" aria-label="Open in Gmail" data-tip="Open in Gmail"><ExternalLink size={16} aria-hidden /></a>}
              </div>
            </div>
            <h2>{opened.subject || "(no subject)"}</h2>
            <p className="ib-head-meta">
              {openTag && <Badge tone={openTag.tone} plain={!openTag.tone}>{openTag.text}</Badge>}
              {event ? event.contact_id && <span>From {sender}</span> : <span>{kind === "team" ? "Sent by your team" : "Sent by InboxCA"} to {open.client?.name}</span>}
              {event && <span className="ib-label" title="What InboxCA took this email to be. Change label picks another."><TagIcon size={13} aria-hidden />{labelTag(event.label).text}{event.decision_source === "staff" && <Badge plain>Corrected</Badge>}</span>}
            </p>
          </header>
          <div className="ib-scroll">
            {event && !event.client_id && (
              <div className="ib-confirm">
                <FolderInput size={16} aria-hidden />
                <span className="grow">InboxCA could not tell which client this email is for.</span>
                {request?.reason_code === "client_unclear" && !!links?.length && (
                  <form action={manageEmail} className="ib-inline">
                    <input type="hidden" name="request" value={request.id} />
                    <input type="hidden" name="email" value={event.id} />
                    <select name="client" aria-label={`Which client the email from ${sender} is for`}>
                      {links.map((link) => <option key={link.client_id} value={link.client_id}>{link.clients?.name}</option>)}
                    </select>
                    <Pending className="b b-secondary" name="intent" value="client">It is for this client</Pending>
                  </form>
                )}
                {clientPicker(links?.length ? "Save to another client" : "Save to a client", { ...filters, mail: event.id, file: "pick" }, (id) => href({ mail: event.id, file: id }), undefined, sp.file === "pick" && (!!cq || !!sp.cpage))}
              </div>
            )}
            {fileTo && event && (
              <form action={manageEmail} className="ib-confirm" aria-label="Save to a client">
                <input type="hidden" name="email" value={event.id} />
                <input type="hidden" name="client" value={fileTo.id} />
                <input type="hidden" name="back" value={here} />
                <FolderInput size={16} aria-hidden />
                <span className="grow">Save this email to <strong>{fileTo.name}</strong>? InboxCA saves any papers in it in the client&apos;s folder.</span>
                <Link className="b b-ghost" href={here} scroll={false}>Cancel</Link>
                <Pending className="b b-primary" name="intent" value="file" busy="Saving">Save to {fileTo.name}</Pending>
              </form>
            )}
            {did && <p className="ib-did"><Info size={14} aria-hidden /><span>{did.text}{did.link && <> <Link href={did.link[0]}>{did.link[1]}</Link></>}</span></p>}
            <ol className="ib-thread" aria-label="Conversation">
              {open.messages.map((message) => {
                // A paper saved from the conversation whose email is not found in it shows on the open one.
                const files = saved?.filter((doc) => doc.email_event_id === eventOf.get(message.messageId) || (message.messageId === opened.messageId && !open.messages.some((other) => eventOf.get(other.messageId) === doc.email_event_id))) ?? [];
                const who = (message.box === "sent" ? (sentKind(message.messageId) === "team" ? "Your team" : "InboxCA") : message.messageId === opened.messageId ? sender || open.client?.name : open.client?.name) ?? "";
                return (
                  <li key={message.messageId} className={message.messageId === opened.messageId ? "on" : undefined}>
                    <p className="ib-who">
                      <Avatar name={message.box === "sent" ? membership.firmName : who} />
                      <strong>{who}</strong>
                      <time dateTime={message.date}>{longTime(message.date)}</time>
                    </p>
                    {(files.length > 0 || message.attachments.length > 0) && (
                      <ul className="ib-files" aria-label="Attachments">
                        {files.map((doc) => (
                          <li key={doc.id}>
                            <Link href={`/app/files/${doc.id}/view`} title={`View ${doc.name}`}>
                              <span className="ib-ext" aria-hidden>{(doc.name.split(".").pop() ?? "").slice(0, 4).toUpperCase()}</span>
                              <span className="grow">
                                <strong>{doc.name}</strong>
                                <span className="ib-path">{doc.size ? `${storage(doc.size)}, ` : ""}Saved to {place(doc)}</span>
                              </span>
                              <span className="ib-view">View</span>
                            </Link>
                          </li>
                        ))}
                        {!files.length && message.attachments.map((name, index) => (
                          <li key={`${name}${index}`}>
                            <span className="ib-file-card">
                              <span className="ib-ext" aria-hidden>{(name.split(".").pop() ?? "").slice(0, 4).toUpperCase()}</span>
                              <span className="grow"><strong>{name}</strong><span className="ib-path">{message.box === "sent" ? "Sent with this email" : "Not saved in the drive"}</span></span>
                            </span>
                          </li>
                        ))}
                        {!!files.length && message.attachments.length > files.length && <li className="ib-note">{message.attachments.length - files.length} more not saved in the drive</li>}
                      </ul>
                    )}
                    <div className="ib-body">{paragraphs(message.text).map((part, index) => <p key={index}>{part}</p>)}</div>
                  </li>
                );
              })}
            </ol>
          </div>
          {!replying && answerRow ? (
            <section className="ib-drafted" aria-label="InboxCA's reply">
              <div className="ib-card">
                <p className="ib-card-head">{held ? <Reply size={14} aria-hidden /> : <Clock size={14} aria-hidden />}<strong>{held ? "Reply ready" : "Sending soon"}</strong><span>{held ? "InboxCA wrote this reply from your records. Check it, then send it or change it." : `InboxCA sends this reply at ${india((answerRow.delivery as Delivery).at ?? new Date().toISOString(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}. Undo stops it.`}</span></p>
                {drafted && ("text" in drafted ? <pre className="ib-draft-text">{drafted.text}</pre> : "team" in drafted && <p>{replyReasons[drafted.team]}. It goes to Needs reply instead.</p>)}
                <form action={manageAnswer} className="ib-reply-foot">
                  <input type="hidden" name="email" value={answerRow.id} />
                  <input type="hidden" name="back" value={here} />
                  {held ? (
                    <>
                      <Pending className="b b-ghost" name="intent" value="stop" busy="Stopping">Don&apos;t send</Pending>
                      {drafted && "text" in drafted && <Link className="b b-secondary" href={`${href({ mail: answerRow.id, edit: "answer" })}#reply-text`} scroll={false}>Edit</Link>}
                      <Pending className="b b-primary" name="intent" value="send" busy="Sending"><Send size={14} aria-hidden />Send</Pending>
                    </>
                  ) : <Pending className="b b-secondary" name="intent" value="stop" busy="Stopping">Undo</Pending>}
                </form>
              </div>
            </section>
          ) : event?.client_id && connected && (
            // An email waiting for a person gets a reply suggested by why it waits; a paper not in the drive, the client's Ask for papers too.
            // Once it no longer waits, the box starts empty again. AI's draft shows as a card to send or edit.
            <ReplyBox key={`${request?.id ?? "reply"}:${sp.edit ?? ""}:${aiWork && "text" in aiWork ? "ai" : ""}`} start={sp.edit === "answer" && held && drafted && "text" in drafted ? drafted.text : aiWork && "text" in aiWork ? aiWork.text : undefined} aiDraft={sp.edit !== "answer" && !!aiWork && "text" in aiWork} mail={event.id} papers={attachable(clientPapers)} suggested={aiWork && "papers" in aiWork ? [...suggested, ...aiWork.papers] : suggested} ai={aiReady()} mayAttach={membership.may("send", event.client_id)} name={sender || open.client?.name || ""} firm={membership.firmName}
              suggestion={request ? suggestedReply(request.reason_code, { name: sender || open.client?.name || "", client: open.client?.name ?? "", firm: membership.firmName, paper: asked }) : undefined}
              askPapers={request?.reason_code === "record_not_found" && !membership.viewOnlyUntil ? `/app/clients/${event.client_id}?tab=documents&ask=1` : undefined}
              note={aiWork && "text" in aiWork ? "AI wrote this from your records. Check it, then send it." : aiWork ? `No AI draft. ${aiWork.reason}` : undefined} />
          )}
          {sp.filed && open.client && <Toast>Saved to {open.client.name}. InboxCA is now saving any papers in it to the client&apos;s folder.</Toast>}
        </div>
      </ViewTransition>
    );
  })() : null;

  return (
    <div className="ib fill">
      <InboxKeys />
      <PageHead
        title="Inbox"
        sub={waits.length ? (
          <nav className="ib-waits" aria-label="Waiting for you">
            <span>Waiting for you</span>
            {waits.map(({ panel, Icon, text }) => (
              <Link key={panel} href={panelHref(panel)} scroll={false} aria-current={sp.panel === panel ? "true" : undefined}><Icon size={14} aria-hidden />{text}</Link>
            ))}
          </nav>
        ) : "Every email with your clients, read live from the firm email."}
        actions={connected && <Link className="b b-primary" href={href({ compose: "1" })} scroll={false}><PenLine size={16} aria-hidden />Write to a client</Link>}
      />
      {sp.approved && <p className="notice" role="status">Sent. The client got a secure link to the paper, in reply to their email.</p>}
      {sp.error && errors[sp.error] && !composing && <p className="alert" role="alert">{sp.error === "mailbox" && !sp.mail ? "The paper could not be sent. Check that the client has an email address. If it fails again, the owner needs to check the firm email in Settings." : errors[sp.error]}</p>}

      <div className="ib-bar">
        <LinkTabs
          kind="pills"
          label="Show"
          items={Object.entries(shows).filter(([key]) => key !== "in" && key !== "out").map(([key, name]) => ({
            href: href({ show: key || (direction || undefined), status: undefined }),
            label: name,
            count: key === "reply" ? (needs ?? 0) : key === "mine" ? (mine ?? 0) : undefined,
            current: key ? show === key : !show || !!direction,
          }))}
        />
        {/* A pick closes the menu: it opens afresh with the new list. */}
        <details key={href()} className="ib-menu ib-filters" open={!composing && !sp.file && (!!cq || !!sp.cpage)}>
          <summary><SlidersHorizontal size={15} aria-hidden />Filters{!!active.length && <span className="ib-count">{active.length}</span>}</summary>
          <div className="ib-pop">
            <div className="ib-filter-group" role="group" aria-label="Client">
              <span className="ib-filter-name">Client</span>
              {clientOptions({ ...filters, client: undefined }, (id) => href({ client: id }), chosenClient?.id)}
            </div>
            <div className="ib-filter-side">
              <div className="ib-filter-group" role="group" aria-label="Email">
                <span className="ib-filter-name">Email</span>
                <div className="ib-opts">
                  <Link href={href({ show: direction ? undefined : show || undefined })} aria-current={!direction ? "true" : undefined}>Both ways</Link>
                  <Link href={href({ show: "in", status: undefined })} aria-current={direction === "in" ? "true" : undefined}>{shows.in}<small>{fromClients ?? 0}</small></Link>
                  <Link href={href({ show: "out", status: undefined })} aria-current={direction === "out" ? "true" : undefined}>{shows.out}</Link>
                </div>
              </div>
              <div className="ib-filter-group" role="group" aria-label="Status">
                <span className="ib-filter-name">Status</span>
                <div className="ib-opts">
                  <Link href={href({ status: undefined })} aria-current={!sp.status ? "true" : undefined}>Any status</Link>
                  {Object.entries(statuses).map(([key, name]) => (
                    <Link key={key} href={href({ status: key, show: undefined })} aria-current={sp.status === key ? "true" : undefined}>{name}</Link>
                  ))}
                </div>
              </div>
              <div className="ib-filter-group" role="group" aria-label="When">
                <span className="ib-filter-name">When</span>
                <div className="ib-opts">
                  <Link href={href({ when: undefined })} aria-current={!when ? "true" : undefined}>Any time</Link>
                  {Object.entries(whens).map(([key, name]) => (
                    <Link key={key} href={href({ when: key })} aria-current={when === key ? "true" : undefined}>{name}</Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </details>
        {!!active.length && (
          <ul className="ib-active" aria-label="Filters in use">
            {active.map(([label, remove]) => (
              <li key={label}><Link href={remove} scroll={false} aria-label={`Remove filter: ${label}`} title="Remove this filter">{label}<X size={13} aria-hidden /></Link></li>
            ))}
            {active.length > 1 && <li><Link className="ib-clear" href={href({ show: direction ? undefined : show || undefined, client: undefined, status: undefined, when: undefined })} scroll={false}>Clear all</Link></li>}
          </ul>
        )}
        <Form className="ib-search" action="/app/inbox" role="search">
          {Object.entries({ ...filters, q: undefined }).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
          <Search size={14} aria-hidden />
          <input id="mail-search" type="search" name="q" defaultValue={q} placeholder="Search email" aria-label="Search email" title="Press / to search" />
        </Form>
        {(!!clearable.length || !!week?.length) && (
          <details className="ib-menu ib-overflow">
            <summary className="b b-ghost b-icon" aria-label="More actions" data-tip="More"><Ellipsis size={16} aria-hidden /></summary>
            <div className="ib-pop">
              {!!clearable.length && (
                <Link href={`${here}${here.includes("?") ? "&" : "?"}confirm=done`} scroll={false} title="Takes every email of this list out of Needs reply, after a check">
                  <CheckCheck size={16} aria-hidden />
                  Mark all done
                  <LinkBusy />
                </Link>
              )}
              {!!week?.length && <Link href={panelHref("approved")} scroll={false}><ShieldCheck size={16} aria-hidden /><span className="grow">Approved in the last 7 days</span><small>{week.length}</small></Link>}
            </div>
          </details>
        )}
      </div>

      <Reading>
        <div className="pane ib-list">
          {!connected ? (
            <Empty Icon={Mail} title="Connect the firm's email">
              <span>New client email shows here once the firm email is connected.</span>
              {owner && <Link className="b b-primary" href="/app/settings#mailbox">Connect email</Link>}
            </Empty>
          ) : (
            <Suspense key={`${href()}|${before}`} fallback={firstRows.length ? listView(firstRows, false) : <div className="ib-list-wait" aria-busy="true" aria-label="Loading emails">{[0, 1, 2, 3].map((row) => <span key={row} className="skel" />)}</div>}>
              <Later>{listed_}</Later>
            </Suspense>
          )}
        </div>

        <article className="pane ib-open" aria-label="Open email">
          {paneSkeleton(false)}
          {!opening ? (
            <div className="ib-pick">
              <Empty Icon={MailOpen} kind="reply" title="Pick an email to read it here.">
                <span className="ib-keys">
                  <span><kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> move</span>
                  <span><kbd className="kbd">Enter</kbd> opens</span>
                  <span><kbd className="kbd">r</kbd> reply</span>
                  <span><kbd className="kbd">e</kbd> mark done</span>
                  <span><kbd className="kbd">h</kbd> snooze</span>
                  <span><kbd className="kbd">/</kbd> search</span>
                </span>
              </Empty>
            </div>
          ) : (
            <Suspense key={openKey} fallback={paneSkeleton(true)}>
              <Later>{opening}</Later>
            </Suspense>
          )}
        </article>
      </Reading>
      <Presence>
      {composing && (
        <SidePanel key="compose" id="compose-title" title="Write to a client" close={href()}>
          {sp.error && errors[sp.error] && <p className="alert" role="alert">{errors[sp.error]}</p>}
          <div className="ib-write">
            <div className="ib-field">
              <span>Client</span>
              {clientPicker(writeTo?.name ?? "Choose a client", { ...filters, compose: sp.compose }, (id) => href({ compose: id }), writeTo?.id, !writeTo || !!cq || !!sp.cpage)}
            </div>
            {writeTo &&
              (recipients.length ? (
                <ComposeBox key={writeTo.id} client={writeTo.id} recipients={recipients} papers={attachable(writePapers)} ai={aiReady()} mayAttach={mayWriteAttach} name={writeTo.name} firm={membership.firmName} />
              ) : (
                <p className="ib-note">
                  {writeTo.name} has no email address yet. Add one on <Link href={`/app/clients/${writeTo.id}?tab=details`}>the client&apos;s page</Link>.
                </p>
              ))}
          </div>
        </SidePanel>
      )}
      </Presence>
      {/* The lists that Waiting for you counts, each beside the page; an action here comes back to it. */}
      <Presence>
      {sp.panel === "asks" && !!toAnswer.length && !answering && (
        <SidePanel key="asks" id="questions" title="Permission requests for you" close={here}>
          <p className="hint">Someone on the team asks to do something that needs your yes.</p>
          <section aria-labelledby="questions">
            <ul className="app-rows ib-preview">
              {toAnswer.map((ask) => {
                const { name, what } = asking(ask);
                return (
                  <ListRow key={ask.id} lead={<Avatar name={name} />} title={`${name} asks to ${what}`} meta={[ask.clients?.name, (ask.details as { document_name?: string }).document_name].filter(Boolean).join(", ")}
                    action={<Link className="b b-secondary" href={href({ ...(sp.mail && { mail: sp.mail }), answer: ask.id })} scroll={false} aria-label={`Answer ${name}`}>Answer</Link>} />
                );
              })}
            </ul>
          </section>
        </SidePanel>
      )}
      {sp.panel === "papers" && !!papers?.length && (
        <SidePanel key="papers" id="papers" title="Papers waiting for approval" close={here}>
          <p className="hint">A client asked for a private paper. It goes as a secure link only once someone approves it.</p>
          <section aria-labelledby="papers">
            <ul className="app-rows ib-preview">
              {papers.map((share) => (
                <ListRow key={share.id} lead={<Avatar name={share.documents?.clients?.name ?? ""} />} title={share.documents?.name} meta={`Asked for by ${share.contact_id ? "a contact of " : ""}${share.documents?.clients?.name}`}
                  action={approver && (
                    <form action={decideShare} className="ib-inline">
                      <input type="hidden" name="share" value={share.id} />
                      <Pending className="b b-ghost" name="intent" value="refuse">Don&apos;t send</Pending>
                      <Pending className="b b-primary" name="intent" value="approve">Approve and send</Pending>
                    </form>
                  )} />
              ))}
            </ul>
          </section>
        </SidePanel>
      )}
      {sp.panel === "replies" && !!answers.length && (
        <SidePanel key="replies" id="answers" title="Replies by InboxCA" close={here}>
          <p className="hint">{queued ? "Replies set to Auto go by themselves at the time shown. Undo stops one." : "InboxCA wrote these from your records. Check each, then send it."}</p>
          <section aria-labelledby="answers">
            <ul className="app-rows ib-preview">
              {answers.map((row) => {
                const kind = answerOf(row.label);
                const name = row.clients?.name ?? "";
                const ready = row.delivery.ack === "held";
                return (
                  <ListRow key={row.id} lead={<Avatar name={name} />} title={<Link href={href({ mail: row.id })} scroll={false}>{name}</Link>}
                    meta={<>{kind && answerWords[kind][0]}{!ready && `. Goes at ${india(row.delivery.at ?? new Date().toISOString(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`}</>}
                    action={
                      <form action={manageAnswer} className="ib-inline">
                        <input type="hidden" name="email" value={row.id} />
                        <input type="hidden" name="back" value={panelHref("replies")} />
                        {ready ? (
                          <>
                            <Link className="b b-ghost" href={`${href({ mail: row.id, edit: "answer" })}#reply-text`} scroll={false} aria-label={`Edit the reply to ${name}`}>Edit</Link>
                            <Pending className="b b-primary" name="intent" value="send" busy="Sending" aria-label={`Send the reply to ${name}`}>Send</Pending>
                          </>
                        ) : <Pending className="b b-secondary" name="intent" value="stop" busy="Stopping" aria-label={`Undo the reply to ${name}`}>Undo</Pending>}
                      </form>
                    } />
                );
              })}
            </ul>
          </section>
        </SidePanel>
      )}
      {sp.panel === "check" && !!toCheck?.length && (
        <SidePanel key="check" id="to-check" title="Papers to check" close={here}>
          <p className="hint">Saved in the client&apos;s To check folder. Check their type and period, or correct them.</p>
          <section aria-labelledby="to-check">
            <ul className="app-rows ib-preview">
              {toCheck.map((file) => (
                <ListRow key={file.id} lead={<Avatar name={file.clients?.name ?? ""} />} title={file.name} meta={file.clients?.name}
                  action={<Link className="b b-secondary" href={`/app/clients/${file.client_id}?tab=files`}>Check</Link>} />
              ))}
            </ul>
          </section>
        </SidePanel>
      )}
      {sp.panel === "approved" && !!week?.length && (
        <SidePanel key="approved" id="approved-title" title="Approved in the last 7 days" close={here}>
          <ul className="app-rows ib-preview">
            {week.map((entry) => (
              <ListRow key={`${entry.at}${entry.action}`} lead={<Avatar name={personName(emailOf.get(entry.actor_id ?? ""))} />}
                title={`${personName(emailOf.get(entry.actor_id ?? ""))} ${approvalWords(entry.action, (entry.details ?? {}) as { right?: string; for?: string; kind?: string })}`} meta={longTime(entry.at)} />
            ))}
          </ul>
        </SidePanel>
      )}
      </Presence>
      <Presence>
      {answering && (() => {
        const { name, what } = asking(answering);
        const time = answering.reason_code === "time";
        const file = (answering.details as { document_name?: string }).document_name;
        return (
          <SidePanel key="answer" id="answer-title" title={`${name} asks to ${what}${answering.clients?.name ? ` for ${answering.clients.name}` : ""}`} close={here}>
            <div className="ib-answer">
              {file && <p>The paper: <strong>{file}</strong></p>}
              <p className="ib-note">{time ? "Allow today lets them keep working until then, today only." : "Allow once lets them do it one time, within an hour. Always allow lets them do it from now on, until you withdraw it in Settings."}</p>
              <form action={decidePermission} className="ib-inline">
                <input type="hidden" name="request" value={answering.id} />
                <Pending className="b b-primary" name="intent" value="allow">{time ? "Allow today" : "Allow once"}</Pending>
                {owner && !!answering.reason_code && answering.reason_code in switchable && <Pending className="b b-secondary" name="intent" value="always">Always allow {name}</Pending>}
                <Pending className="b b-ghost" name="intent" value="refuse">Refuse</Pending>
              </form>
            </div>
          </SidePanel>
        );
      })()}
      </Presence>
      {decided && decided.status !== "pending" && (() => {
        const { name, what } = asking(decided);
        const always = decided.status === "used" && decided.reason_code !== "time";
        return (
          <Toast
            undo={decided.reason_code !== "time" && (
              <form action={undoPermission}>
                <input type="hidden" name="request" value={decided.id} />
                <Pending className="b">Undo</Pending>
              </form>
            )}
          >
            {decided.status === "refused" ? `Refused. ${name} may not ${what}.` : always ? `${name} may now always ${what}.` : decided.reason_code === "time" ? `${name} may ${what}.` : `${name} may ${what} once, within an hour.`}
          </Toast>
        );
      })()}
      <Presence>
      {sp.confirm === "done" && !!clearable.length && (
        <SidePanel key="done" id="done-title" title={`Mark ${clearable.length === 1 ? "1 email" : `${clearable.length} emails`} done?`} close={here}>
          <p className="hint">They move out of Needs reply. No one gets an email. You can undo this.</p>
          <ul className="app-rows ib-preview">
            {/* Each email by its client and status at once, its subject once the mailbox answers. */}
            <Suspense fallback={clearable.map((row) => <ListRow key={row.key} lead={<Avatar name={row.client} />} title={row.client} meta={`Emailed ${shortTime(row.at, today)}`} status={<Badge tone={row.tag.tone} plain={!row.tag.tone}>{row.tag.text}</Badge>} />)}>
              <Later>
                {listed.then(({ list }) => list.filter((row) => row.request).map((row) => (
                  <ListRow key={row.key} lead={<Avatar name={row.client} />} title={row.client} meta={row.subject} status={<Badge tone={row.tag.tone} plain={!row.tag.tone}>{row.tag.text}</Badge>} />
                )))}
              </Later>
            </Suspense>
          </ul>
          <form action={manageEmail} className="ib-send">
            {clearable.map((row) => <input key={row.key} type="hidden" name="request" value={row.request} />)}
            <input type="hidden" name="back" value={here} />
            <Pending className="b b-primary" name="intent" value="done" busy="Marking">
              <CheckCheck size={16} aria-hidden />
              Mark {clearable.length === 1 ? "1 email" : `${clearable.length} emails`} done
            </Pending>
          </form>
        </SidePanel>
      )}
      </Presence>
      {!!cleared.length && (
        <Toast
          undo={
            <form action={manageEmail}>
              {cleared.map((id) => <input key={id} type="hidden" name="request" value={id} />)}
              <input type="hidden" name="back" value={here} />
              <Pending className="b" name="intent" value="undo" busy="Undoing">Undo</Pending>
            </form>
          }
        >
          {cleared.length === 1 ? "Marked done." : `${cleared.length} emails marked done.`}
        </Toast>
      )}
      {sp.snoozed && (touched?.details as Ask | undefined)?.snooze && (
        <Toast
          undo={
            <form action={manageEmail}>
              <input type="hidden" name="request" value={touched!.id} />
              <input type="hidden" name="back" value={here} />
              <Pending className="b" name="intent" value="wake" busy="Undoing">Undo</Pending>
            </form>
          }
        >
          Snoozed until {dayName((touched!.details as Ask).snooze!)}. It comes back to Needs reply that day.
        </Toast>
      )}
      {sp.assigned && touched && <Toast>{(touched.details as Ask).assignee ? `Assigned to ${whoWords((touched.details as Ask).assignee!)}.` : "Nobody is assigned now."}</Toast>}
      {sp.went && <Toast>Sending the reply now.</Toast>}
      {sp.stopped && <Toast>{statusKind(sp.stopped) ? "Not sent. The email waits in Needs reply." : "Not sent."}</Toast>}
      {sp.replied && <Toast>Reply sent{sp.unsent ? `. ${sp.unsent === "1" ? "1 paper was" : `${sp.unsent} papers were`} not sent. Send ${sp.unsent === "1" ? "it" : "them"} from the client's Documents tab.` : "."}</Toast>}
      {sp.written && <Toast>Email sent{sp.unsent ? `. ${sp.unsent === "1" ? "1 paper was" : `${sp.unsent} papers were`} not sent. Send ${sp.unsent === "1" ? "it" : "them"} from the client's Documents tab.` : "."}</Toast>}
    </div>
  );
}
