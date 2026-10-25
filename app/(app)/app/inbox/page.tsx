import { AlarmClock, CheckCheck, ChevronDown, FolderInput, Inbox as InboxIcon, Mail, MailOpen, PenLine, Reply, Search, UserRound } from "lucide-react";
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
import { mailLive } from "@/src/lib/mail-live";
import { paragraphs, sentKind, suggestPapers, whenRange, whens, type MailItem } from "@/src/lib/mail-view";
import { currentMember, myQuestions } from "@/src/lib/member";
import { opensInMailbox } from "@/src/lib/mailbox";
import { askedPaper } from "@/src/lib/records";
import { awake, labels, replyReasons } from "@/src/lib/triage";
import { LinkTabs } from "../link-tabs";
import { Item, List, Presence } from "../motion";
import { Pending } from "../pending";
import { Avatar, Badge, Empty, PageHead, Row as ListRow, SidePanel, Toast } from "../ui";
import { clientsOf, contactName, conversation } from "./conversation";
import { ComposeBox, InboxKeys, LinkBusy, Reading, ReplyBox } from "./inbox-client";
import "./inbox.css";

const PAGE = 30;
const shows = { "": "All", reply: "Needs reply", mine: "Mine", in: "From clients", out: "Sent to clients" } as const;
const statuses = { reply: "Needs reply", snoozed: "Snoozed", filed: "Filed", reminder: "Reminder sent", team: "Sent by team", check: "To check" } as const;
const sentTags = { reminder: "Reminder sent", inboxca: "Sent by InboxCA", team: "Sent by team" } as const;
type Tag = { text: string; tone: "warn" | "done" | "blue" | "" };
type Row = { key: string; href: string; dir: "in" | "out"; client: string; clientId: string | null; at: string; messageId: string; subject: string; snippet: string; tags: Tag[]; request?: string; assignee?: string };
// What a Needs reply request keeps besides its status: snoozed until a day, and who answers.
type Ask = { snooze?: string; assignee?: string };

const india = (at: string, options: Intl.DateTimeFormatOptions) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...options });
const shortTime = (at: string, today: string) => {
  const day = new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return day === today ? india(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : day === addDays(today, -1) ? "Yesterday" : india(at, { day: "numeric", month: "short" });
};
const longTime = (at: string) => india(at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayName = (day: string) => india(`${day}T12:00:00+05:30`, { weekday: "short", day: "numeric", month: "short" });
const uuid = /^[0-9a-f-]{36}$/;

type Search = Record<"mail" | "sent" | "client" | "show" | "status" | "when" | "q" | "before" | "cq" | "cpage" | "compose" | "approved" | "error" | "replied" | "written" | "unsent" | "answer" | "decided" | "cleared" | "confirm" | "file" | "snoozed" | "assigned" | "filed", string | undefined>;

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
  // Which emails a status keeps, from InboxCA's own records. Needs reply leaves out what is
  // snoozed to a later day; Mine is what waits for this person.
  const asks = () => supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("status", "pending");
  const [{ data: chosenClient }, { data: only }] = await Promise.all([
    sp.client && uuid.test(sp.client) ? supabase.from("clients").select("id, name").eq("id", sp.client).maybeSingle() : Promise.resolve({ data: null }),
    status === "reply" || status === "snoozed"
      ? (status === "snoozed" ? asks().gt("details->>snooze", today) : show === "mine" ? asks().or(awake(today)).eq("details->>assignee", userId) : asks().or(awake(today))).limit(1000).then(({ data }) => ({ data: data?.map((row) => row.entity_id) ?? [] }))
      : status === "filed" || status === "check"
        ? supabase.from("documents").select("email_event_id").eq("status", status === "filed" ? "filed" : "to_check").not("email_event_id", "is", null).limit(1000).then(({ data }) => ({ data: data?.map((row) => row.email_event_id!) ?? [] }))
        : Promise.resolve({ data: null }),
  ]);
  const filters = { client: chosenClient?.id, show: show || undefined, status: sp.status && sp.status in statuses ? sp.status : undefined, when: when || undefined, q: q || undefined };
  const href = (change: Partial<Search> = {}) => {
    const params = new URLSearchParams(Object.entries({ ...filters, ...change }).filter((entry): entry is [string, string] => !!entry[1]));
    return `/app/inbox${params.size ? `?${params}` : ""}`;
  };
  const wantIn = show !== "out" && status !== "reminder" && status !== "team";
  const wantOut = !["reply", "mine", "in"].includes(show) && !["reply", "snoozed", "filed", "check"].includes(status);
  const range = whenRange(when, today);
  const until = [range.until, before].filter(Boolean).sort()[0];
  let events = supabase.from("email_events").select("id, client_id, contact_id, received_at, label, decision_source, provider_message_id, clients(name), contacts(name_enc)").eq("firm_id", firm);
  if (chosenClient) events = events.eq("client_id", chosenClient.id);
  if (range.from) events = events.gte("received_at", range.from);
  if (until) events = events.lt("received_at", until);
  if (only) events = events.in("id", only);
  let needsCount = supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending").or(awake(today));
  let mineCount = supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending").or(awake(today)).eq("details->>assignee", userId);
  let inCount = supabase.from("email_events").select("id", { count: "exact", head: true }).eq("firm_id", firm);
  if (chosenClient) [needsCount, mineCount, inCount] = [needsCount.eq("client_id", chosenClient.id), mineCount.eq("client_id", chosenClient.id), inCount.eq("client_id", chosenClient.id)];
  const cq = (sp.cq ?? "").trim().slice(0, 80);
  const cpage = Math.min(Math.max(0, Number(sp.cpage) || 0), 500);
  let pick = supabase.from("clients").select("id, name").is("archived_at", null).order("name").range(cpage * 8, cpage * 8 + 8);
  if (cq) pick = pick.ilike("name", `%${cq.replace(/[\\%_]/g, "\\$&")}%`);
  const owner = membership.role === "owner";
  const [{ data: rows }, { count: needs }, { count: mine }, { count: fromClients }, { data: pickList }, { data: waiting }, { data: toCheck }, { data: papers }, toAnswer, { data: people }, { data: accounts }, { data: decided }, { data: week }] = await Promise.all([
    wantIn && (!only || only.length) ? events.order("received_at", { ascending: false }).order("id").limit(q ? 500 : PAGE) : Promise.resolve({ data: [] as never[] }),
    needsCount,
    mineCount,
    inCount,
    pick,
    supabase.from("requests").select("id, entity_id, reason_code, details").eq("kind", "team_reply").eq("status", "pending").limit(1000),
    supabase.from("documents").select("id, client_id, name, clients(name)").eq("status", "to_check").limit(50),
    supabase.from("shares").select("id, contact_id, documents(name, clients(name))").eq("status", "waiting").limit(50),
    // Questions this person may answer (5.17.2), the same ones Today counts.
    myQuestions(),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabaseAdmin().from("connected_accounts").select("kind, status, settings").eq("firm_id", firm),
    sp.decided && uuid.test(sp.decided) ? supabase.from("requests").select("id, status, reason_code, details").eq("kind", "permission").eq("id", sp.decided).maybeSingle() : Promise.resolve({ data: null }),
    // The owner's week of approvals (5.17.3, #51): who approved what, newest first.
    owner
      ? supabaseAdmin().from("activity_log").select("at, actor_id, action, details").eq("firm_id", firm)
        .in("action", ["permission.allowed", "permission.always", "device.approved", "office.confirm", "office.today"])
        .gt("at", addDays(today, -7)).order("at", { ascending: false }).limit(50)
      : Promise.resolve({ data: null }),
  ]);
  const emailOf = new Map(people?.map((person) => [person.user_id, person.email]));
  // A question in words, with the person's name: "Sunil asks to upload a file".
  const asking = (ask: { reason_code: string | null; details: unknown }) => {
    const details = ask.details as { by: string; until?: string };
    return { name: personName(emailOf.get(details.by)), what: ask.reason_code === "time" ? `work until ${details.until} today` : rightWords[ask.reason_code as Right] };
  };
  const answering = toAnswer.find((ask) => ask.id === sp.answer);
  const approvalWords = (action: string, details: { right?: string; for?: string; kind?: string }) =>
    ({
      "permission.allowed": details.right === "time" ? `gave ${personName(emailOf.get(details.for ?? ""))} more time` : `allowed ${personName(emailOf.get(details.for ?? ""))} once to ${rightWords[details.right as Right]}`,
      "permission.always": `always allowed ${personName(emailOf.get(details.for ?? ""))} to ${rightWords[details.right as Right]}`,
      "device.approved": details.kind === "personal" ? "allowed a device away from the office" : details.kind === "office" ? "approved a PC that stays in the office" : "approved a laptop",
      "office.confirm": "confirmed an office internet connection",
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
  // What became of each email: waiting (or snoozed), papers filed or to check, or done.
  const statesOf = async (ids: string[]) => {
    const [{ data: done }, { data: filedDocs }] = ids.length
      ? await Promise.all([
          supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("status", "done").in("entity_id", ids),
          supabase.from("documents").select("email_event_id, status").in("email_event_id", ids),
        ])
      : [{ data: [] }, { data: [] }];
    return (eventId: string): Tag | null =>
      snoozedTill(eventId) ? { text: `Snoozed until ${dayName(snoozedTill(eventId)!)}`, tone: "blue" }
      : pending.has(eventId) ? { text: "Needs reply", tone: "warn" }
      : filedDocs?.some((doc) => doc.email_event_id === eventId && doc.status === "to_check") ? { text: "To check", tone: "warn" }
      : filedDocs?.some((doc) => doc.email_event_id === eventId && doc.status === "filed") ? { text: "Filed", tone: "done" }
      : done?.some((request) => request.entity_id === eventId) ? { text: "Done", tone: "done" }
      : null;
  };
  // The emails' rows from InboxCA's own records: who, when and what waits. An email waiting
  // for a reply also shows what it is, such as a notice that asks something. The subject and
  // first line are filled in from the mailbox.
  const storedRows = async (list: typeof events_): Promise<Row[]> => {
    const stateTag = await statesOf(list.map((event) => event.id));
    return Promise.all(
      list.map(async (event) => {
        const state = stateTag(event.id);
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
          tags: !state ? [labelTag(event.label)] : pending.has(event.id) && event.label && event.label !== "other" ? [state, labelTag(event.label)] : [state],
          request: pending.get(event.id)?.id,
          assignee: askOf(event.id).assignee,
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
      return to ? [{ key: item.messageId, href: href({ sent: item.messageId }), dir: "out" as const, client: to.name, clientId: to.id, at: item.date, messageId: item.messageId, subject: item.subject || "(no subject)", snippet: item.snippet, tags: [{ text: sentTags[sentKind(item.messageId)], tone: "" as const }] }] : [];
    });
    const list = [...inRows, ...outRows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, PAGE);
    const older = (events_.length >= PAGE || (!("error" in live) && (live.sent?.length ?? 0) >= PAGE)) && list.length ? href({ before: list.at(-1)!.at }) : null;
    return { list, older, failed };
  })();

  const openKey = sp.mail ?? sp.sent ?? "";
  // Where an action on this page comes back to: the same list, with the same email open.
  const here = href(sp.mail ? { mail: sp.mail } : sp.sent ? { sent: sp.sent } : {});
  const gmail = opensInMailbox(((mailbox?.settings ?? {}) as { imap?: { host?: string } }).imap?.host ?? "");
  const errors: Record<string, string> = {
    mailbox: "The email could not be sent. Check the firm's email in Settings, then try again.",
    reply: "Write the reply first.",
    write: "Write a subject and the email first.",
    to: "Choose who gets the email.",
    needs: "Sending files to this client needs permission. Ask on the client's Documents tab.",
    upload: "Files can be up to 25 MB together.",
  };
  const hasWait = !!toAnswer.length || !!papers?.length || !!toCheck?.length || !!week?.length;
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
  const { data: writePapers } = mayWriteAttach ? await supabase.from("documents").select("id, name").eq("client_id", writeTo.id).eq("status", "filed").order("received_at", { ascending: false }).limit(50) : { data: [] };
  // The paging client picker, for the filter, for writing and for filing: a search, eight
  // names a page.
  const clientPicker = (summary: string, keep: Partial<Search>, link: (id: string) => string, current?: string, open = !!cq || !!sp.cpage) => (
    // A pick closes the menu: it opens afresh once the choice changes.
    <details key={`${summary}${current}${sp.file}`} className="ib-menu" open={open}>
      <summary>{summary}<ChevronDown size={14} aria-hidden /></summary>
      <div className="ib-pop">
        <form action="/app/inbox" role="search">
          {Object.entries(keep).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
          <input type="search" name="cq" defaultValue={cq} placeholder="Find a client" aria-label="Find a client" />
        </form>
        {current && !keep.compose && <Link href={href({ client: undefined })}>All clients</Link>}
        {pickList?.slice(0, 8).map((row) => (
          <Link key={row.id} href={link(row.id)} aria-current={row.id === current ? "true" : undefined}><Avatar name={row.name} />{row.name}</Link>
        ))}
        {!pickList?.length && <span className="ib-note">No client by that name</span>}
        {(pickList?.length ?? 0) > 8 && <Link href={href({ compose: keep.compose, mail: keep.mail, file: keep.file, cq: cq || undefined, cpage: String(cpage + 1) })}>More clients</Link>}
      </div>
    </details>
  );

  // The list: rows from InboxCA's records first, their subject and first line as an outline
  // until the mailbox answers (live false), then the whole list with sent mail in its place.
  const listView = (list: Row[], live: boolean, older?: string | null) => (
    <List label="Emails" rise={!live}>
      {list.map((row) => (
        <Item key={row.key} className="ib-row" aria-current={row.key === openKey ? "true" : undefined} data-waits={row.tags[0]?.text === "Needs reply" || undefined}>
          <Link href={row.href} scroll={false}>
            <Avatar name={row.client} />
            <span className="ib-row-main">
              <span className="ib-row-top">
                <strong>{row.dir === "out" && <span className="ib-sent-to">To </span>}{row.client}</strong>
                {row.assignee && (
                  <span className="ib-who-has" title={`Assigned to ${whoWords(row.assignee)}`}>
                    <Avatar name={nameOf(row.assignee)} />
                    <span className="sr-only">Assigned to {whoWords(row.assignee)}</span>
                  </span>
                )}
                <time dateTime={row.at}>{shortTime(row.at, today)}</time>
              </span>
              {live ? <span className="ib-subject">{row.subject}</span> : <span className="skel ib-skel-line" aria-hidden />}
              <span className="ib-row-foot">
                {live ? <span className="ib-snippet">{row.snippet}</span> : <span className="skel ib-skel-line short" aria-hidden />}
                {row.tags.map((tag) => <Badge key={tag.text} tone={tag.tone} plain={!tag.tone}>{tag.text}</Badge>)}
              </span>
            </span>
          </Link>
          <span className="ib-acts">
            {row.request && (
              <form action={manageEmail}>
                <input type="hidden" name="request" value={row.request} />
                <input type="hidden" name="back" value={here} />
                <Pending className="b b-secondary" name="intent" value="done" busy="Moving">No reply needed</Pending>
              </form>
            )}
            {row.clientId && <Link className="b b-secondary" href={`/app/clients/${row.clientId}`}>Open client</Link>}
          </span>
        </Item>
      ))}
      {older && <li key="older" className="ib-more"><Link href={older}>Older emails</Link></li>}
    </List>
  );
  const filtered = Object.values(filters).some(Boolean) || !!before;
  const listed_ = listed.then(({ list, older, failed }) => (
    <>
      {failed === "unreachable" && <p className="alert" role="alert">The firm&apos;s mailbox could not be reached just now, so subjects and text are missing. Try again in a minute.</p>}
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
          <span>{filtered ? "Nothing matches these filters." : "New mail from your clients shows here, sorted."}</span>
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
    if (!opened) return <p className="ib-pick" role="alert">{open.error ? "The firm's mailbox could not be reached just now. Try again in a minute." : "This email is no longer in the firm's mailbox."}</p>;
    const clientId = open.client?.id ?? null;
    const request = event ? pending.get(event.id) : undefined;
    const inIds = open.messages.filter((message) => message.box === "inbox").map((message) => message.messageId);
    const [{ data: threadEvents }, { data: clientPapers }, { data: links }, { data: fileTo }, stateTag, sender] = await Promise.all([
      inIds.length ? supabase.from("email_events").select("id, provider_message_id").eq("firm_id", firm).in("provider_message_id", inIds) : Promise.resolve({ data: [] as { id: string; provider_message_id: string }[] }),
      clientId && event ? supabase.from("documents").select("id, name, document_type, period_key").eq("client_id", clientId).eq("status", "filed").order("received_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] as { id: string; name: string; document_type: string; period_key: string }[] }),
      request?.reason_code === "client_unclear" && event ? supabase.from("contact_clients").select("client_id, clients(name)").eq("contact_id", event.contact_id ?? "") : Promise.resolve({ data: [] as { client_id: string; clients: { name: string } | null }[] }),
      // File to a client, for mail InboxCA could not match: the client picked, then confirmed.
      event && !event.client_id && sp.file && uuid.test(sp.file) ? supabase.from("clients").select("id, name").eq("id", sp.file).is("archived_at", null).maybeSingle() : Promise.resolve({ data: null }),
      statesOf(event ? [event.id] : []),
      event ? event.clients?.name ?? contactName(firm, event).then((name) => name || "A contact") : "",
    ]);
    const eventOf = new Map(threadEvents?.map((row) => [row.provider_message_id, row.id]));
    const { data: saved } = threadEvents?.length
      ? await supabase.from("documents").select("id, name, email_event_id, work_type, period_key, status, received_at").in("email_event_id", threadEvents.map((row) => row.id))
      : { data: [] };
    const order = ((drive?.settings ?? {}) as { folder_order?: FolderOrder }).folder_order ?? "year_client_work";
    const place = (doc: NonNullable<typeof saved>[number]) => folderFor(order, open.client?.name ?? "", { work: doc.work_type as never, period: doc.period_key, receivedAt: doc.received_at ?? "", toCheck: doc.status === "to_check" }).join(" / ");
    const kind = opened.box === "sent" ? sentKind(opened.messageId) : null;
    const openTag: Tag | null = event ? stateTag(event.id) : kind ? { text: sentTags[kind], tone: "" } : null;
    const asked = askedPaper(opened.subject, opened.text);
    const suggested = clientPapers ? suggestPapers(`${opened.subject}\n${opened.text}`, clientPapers, asked, [...documentTypes, ...((membership.settings.document_types ?? []) as string[])]).map((doc) => doc.id) : [];
    // Snooze and who answers, for an email that needs a reply.
    const openAsk: Ask = event ? askOf(event.id) : {};
    return (
      <ViewTransition enter="ib-in" exit="ib-out" default="none">
        <div className="ib-convo">
          <header className="ib-head">
            <Avatar name={event ? sender : membership.firmName} />
            <div className="grow">
              <h2>{opened.subject || "(no subject)"}</h2>
              <p className="ib-note">{event ? `From ${sender}${open.client && event.contact_id ? `, ${open.client.name}` : ""}` : `${kind === "team" ? "Sent by your team" : "Sent by InboxCA"} to ${open.client?.name}`}</p>
            </div>
            {openTag && <Badge tone={openTag.tone} plain={!openTag.tone}>{openTag.text}</Badge>}
          </header>
          <div className="ib-actions">
            {event?.client_id && connected && <a className="b b-secondary" href="#reply-text" title="Press r"><Reply size={16} aria-hidden />Reply<kbd className="kbd" aria-hidden>r</kbd></a>}
            {request && (
              <form action={manageEmail}>
                <input type="hidden" name="request" value={request.id} />
                <input type="hidden" name="back" value={here} />
                <Pending className="b b-secondary" name="intent" value="done" busy="Moving" data-key="e" title="Takes it out of Needs reply. Press e"><CheckCheck size={16} aria-hidden />No reply needed<kbd className="kbd" aria-hidden>e</kbd></Pending>
              </form>
            )}
            {request && event && (snoozedTill(event.id) ? (
              <form action={manageEmail}>
                <input type="hidden" name="request" value={request.id} />
                <input type="hidden" name="back" value={here} />
                <Pending className="b b-secondary" name="intent" value="wake" busy="Bringing back"><AlarmClock size={16} aria-hidden />Back to Needs reply now</Pending>
              </form>
            ) : (
              <details key={`snooze${request.id}`} className="ib-menu">
                <summary data-key="h" title="Takes it out of Needs reply until the day you pick. Press h"><AlarmClock size={16} aria-hidden />Snooze<ChevronDown size={14} aria-hidden /></summary>
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
                <summary title="Who answers this email">
                  {openAsk.assignee ? <><Avatar name={nameOf(openAsk.assignee)} />{openAsk.assignee === userId ? "You" : nameOf(openAsk.assignee)}</> : <><UserRound size={16} aria-hidden />Assign</>}
                  <ChevronDown size={14} aria-hidden />
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
            {open.client && <Link className="b b-secondary" href={`/app/clients/${open.client.id}`}>Open {open.client.name}</Link>}
            {request?.reason_code === "client_unclear" && event && !!links?.length && (
              <form action={manageEmail} className="ib-inline">
                <input type="hidden" name="request" value={request.id} />
                <input type="hidden" name="email" value={event.id} />
                <select name="client" aria-label={`Which client the email from ${sender} is for`}>
                  {links.map((link) => <option key={link.client_id} value={link.client_id}>{link.clients?.name}</option>)}
                </select>
                <Pending className="b b-secondary" name="intent" value="client">It is for this client</Pending>
              </form>
            )}
            {event && !event.client_id && clientPicker(links?.length ? "Another client" : "File to a client", { ...filters, mail: event.id, file: "pick" }, (id) => href({ mail: event.id, file: id }), undefined, sp.file === "pick" && (!!cq || !!sp.cpage))}
            {event && (
              <span className="ib-inline ib-label">
                <Badge plain>{labelTag(event.label).text}</Badge>
                {event.decision_source === "staff" && <Badge plain>Corrected</Badge>}
                <details key={`${event.id}${event.label}`} className="ib-menu">
                  <summary title="Pick another label when InboxCA got it wrong">Change</summary>
                  <form action={manageEmail} className="ib-pop" aria-label="What this email is">
                    <input type="hidden" name="email" value={event.id} />
                    <input type="hidden" name="intent" value="label" />
                    {Object.entries(labels).map(([value, label]) => (
                      <Pending key={value} name="label" value={value} aria-current={value === (event.label ?? "other") ? "true" : undefined}>{label}</Pending>
                    ))}
                  </form>
                </details>
              </span>
            )}
            {event && gmail && <a className="b b-ghost" href={`/app/inbox/${event.id}/open`} target="_blank" rel="noreferrer">Open in Gmail</a>}
          </div>
          {fileTo && event && (
            <form action={manageEmail} className="ib-confirm" aria-label="File to a client">
              <input type="hidden" name="email" value={event.id} />
              <input type="hidden" name="client" value={fileTo.id} />
              <input type="hidden" name="back" value={here} />
              <FolderInput size={16} aria-hidden />
              <span className="grow">File this email to <strong>{fileTo.name}</strong>? Any papers in it are saved in the client&apos;s folder.</span>
              <Link className="b b-ghost" href={here} scroll={false}>Cancel</Link>
              <Pending className="b b-primary" name="intent" value="file" busy="Filing">File to {fileTo.name}</Pending>
            </form>
          )}
          {request && request.reason_code && replyReasons[request.reason_code] && <p className="ib-note">{replyReasons[request.reason_code]}</p>}
          <ol className="ib-thread" aria-label="Conversation">
            {open.messages.map((message) => {
              const files = saved?.filter((doc) => doc.email_event_id === eventOf.get(message.messageId)) ?? [];
              const who = (message.box === "sent" ? (sentKind(message.messageId) === "team" ? "Your team" : "InboxCA") : message.messageId === opened.messageId ? sender || open.client?.name : open.client?.name) ?? "";
              return (
                <li key={message.messageId} className={message.messageId === opened.messageId ? "on" : undefined}>
                  <p className="ib-who">
                    <Avatar name={message.box === "sent" ? membership.firmName : who} />
                    <strong>{who}</strong>
                    <time dateTime={message.date}>{longTime(message.date)}</time>
                  </p>
                  <div className="ib-body">{paragraphs(message.text).map((part, index) => <p key={index}>{part}</p>)}</div>
                  {(files.length > 0 || message.attachments.length > 0) && (
                    <ul className="ib-files" aria-label="Attachments">
                      {files.map((doc) => (
                        <li key={doc.id}>
                          <span className="ib-ext" aria-hidden>{(doc.name.split(".").pop() ?? "").slice(0, 4).toUpperCase()}</span>
                          <span className="grow"><strong>{doc.name}</strong><span className="ib-path">Saved to {place(doc)}</span></span>
                          <Link className="b b-secondary" href={`/app/files/${doc.id}/view`}>View</Link>
                        </li>
                      ))}
                      {!files.length && message.attachments.map((name, index) => (
                        <li key={`${name}${index}`}>
                          <span className="ib-ext" aria-hidden>{(name.split(".").pop() ?? "").slice(0, 4).toUpperCase()}</span>
                          <span className="grow"><strong>{name}</strong><span className="ib-note">{message.box === "sent" ? "Sent with this email" : "Not saved in the drive"}</span></span>
                        </li>
                      ))}
                      {!!files.length && message.attachments.length > files.length && <li className="ib-note">{message.attachments.length - files.length} more not saved in the drive</li>}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
          {event?.client_id && connected && (
            <ReplyBox mail={event.id} papers={(clientPapers ?? []).map(({ id, name }) => ({ id, name }))} suggested={suggested} ai={aiReady()} mayAttach={membership.may("send", event.client_id)} name={sender || open.client?.name || ""} firm={membership.firmName} />
          )}
          {sp.filed && open.client && <Toast>Filed to {open.client.name}. Any papers in it go to the client&apos;s folder.</Toast>}
        </div>
      </ViewTransition>
    );
  })() : null;

  return (
    <div className="ib fill">
      <InboxKeys />
      <PageHead
        title="Inbox"
        sub="Every email with your clients, both ways. Read live from the firm's mailbox; InboxCA keeps no copy."
        actions={connected && <Link className="b b-primary" href={href({ compose: "1" })} scroll={false}><PenLine size={16} aria-hidden />Write to a client</Link>}
      />
      {sp.approved && <p className="notice" role="status">Sent. The client got a secure link to the paper, in reply to their email.</p>}
      {sp.error && errors[sp.error] && !composing && <p className="alert" role="alert">{sp.error === "mailbox" && !sp.mail ? "The paper could not be sent. Check the firm's email in Settings, then try again." : errors[sp.error]}</p>}

      {hasWait && (
        <div className="ib-wait">
          {!!toAnswer.length && (
            <section aria-labelledby="questions">
              <h2 id="questions">Questions for you</h2>
              <ul>
                {toAnswer.map((ask) => {
                  const { name, what } = asking(ask);
                  return (
                    <li key={ask.id}>
                      <Avatar name={name} />
                      <span className="grow">
                        <strong>{name} asks to {what}</strong>
                        <span className="ib-note">{[ask.clients?.name, (ask.details as { document_name?: string }).document_name].filter(Boolean).join(", ")}</span>
                      </span>
                      <Link className="b b-secondary" href={href({ ...(sp.mail && { mail: sp.mail }), answer: ask.id })} scroll={false} aria-label={`Answer ${name}`}>Answer</Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {!!papers?.length && (
            <section aria-labelledby="papers">
              <h2 id="papers">Papers waiting for approval</h2>
              <ul>
                {papers.map((share) => (
                  <li key={share.id} title="A client asked for a private paper. It goes as a secure link only once someone approves it.">
                    <Avatar name={share.documents?.clients?.name ?? ""} />
                    <span className="grow">
                      <strong>{share.documents?.name}</strong>
                      <span className="ib-note">Asked for by {share.contact_id ? "a contact of " : ""}{share.documents?.clients?.name}</span>
                    </span>
                    {approver && (
                      <form action={decideShare}>
                        <input type="hidden" name="share" value={share.id} />
                        <Pending className="b b-ghost" name="intent" value="refuse">Don&apos;t send</Pending>
                        <Pending className="b b-secondary" name="intent" value="approve">Approve and send</Pending>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!toCheck?.length && (
            <section aria-labelledby="to-check">
              <h2 id="to-check">Files to check</h2>
              <ul>
                {toCheck.map((file) => (
                  <li key={file.id} title="Saved in the client's To check folder. Confirm or correct their type and period.">
                    <Avatar name={file.clients?.name ?? ""} />
                    <span className="grow">
                      <strong>{file.name}</strong>
                      <span className="ib-note">{file.clients?.name}</span>
                    </span>
                    <Link className="b b-secondary" href={`/app/clients/${file.client_id}?tab=files`}>Check</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!week?.length && (
            <details id="approved" aria-labelledby="approved-title">
              <summary id="approved-title">Approved in the last 7 days ({week.length})</summary>
              <ul>
                {week.map((entry) => (
                  <li key={`${entry.at}${entry.action}`}>
                    <span className="grow">{personName(emailOf.get(entry.actor_id ?? ""))} {approvalWords(entry.action, (entry.details ?? {}) as { right?: string; for?: string; kind?: string })}</span>
                    <span className="ib-note">{longTime(entry.at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="ib-bar">
        <LinkTabs
          kind="pills"
          label="Show"
          items={Object.entries(shows).map(([key, name]) => ({
            href: href({ show: key || undefined, status: undefined }),
            label: name,
            count: key === "reply" ? (needs ?? 0) : key === "mine" ? (mine ?? 0) : key === "in" ? (fromClients ?? 0) : undefined,
            current: show === key,
          }))}
        />
        {clientPicker(chosenClient?.name ?? "Client", { ...filters, client: undefined }, (id) => href({ client: id }), chosenClient?.id, !composing && !sp.file && (!!cq || !!sp.cpage))}
        <details className="ib-menu">
          <summary>{status && sp.status ? statuses[status] : "Status"}<ChevronDown size={14} aria-hidden /></summary>
          <div className="ib-pop">
            <Link href={href({ status: undefined })}>Any status</Link>
            {Object.entries(statuses).map(([key, name]) => (
              <Link key={key} href={href({ status: key, show: undefined })} aria-current={sp.status === key ? "true" : undefined}>{name}</Link>
            ))}
          </div>
        </details>
        <details className="ib-menu">
          <summary>{when ? whens[when as keyof typeof whens] : "When"}<ChevronDown size={14} aria-hidden /></summary>
          <div className="ib-pop">
            <Link href={href({ when: undefined })}>Any time</Link>
            {Object.entries(whens).map(([key, name]) => (
              <Link key={key} href={href({ when: key })} aria-current={when === key ? "true" : undefined}>{name}</Link>
            ))}
          </div>
        </details>
        {!!clearable.length && (
          <Link className="b b-ghost" href={`${here}${here.includes("?") ? "&" : "?"}confirm=done`} scroll={false} title="Takes every email of this list out of Needs reply, after a check">
            <CheckCheck size={16} aria-hidden />
            Mark all as done
            <LinkBusy />
          </Link>
        )}
        <form className="ib-search" action="/app/inbox" role="search">
          {Object.entries({ ...filters, q: undefined }).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
          <Search size={14} aria-hidden />
          <input id="mail-search" type="search" name="q" defaultValue={q} placeholder="Search email" aria-label="Search email" title="Press / to search" />
        </form>
      </div>

      <Reading>
        <div className="pane ib-list">
          {!connected ? (
            <Empty Icon={Mail} title="Connect the firm's email">
              <span>New client mail shows here once the firm&apos;s mailbox is connected.</span>
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
                  <span><kbd className="kbd">e</kbd> no reply needed</span>
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
                <ComposeBox key={writeTo.id} client={writeTo.id} recipients={recipients} papers={writePapers ?? []} ai={aiReady()} mayAttach={mayWriteAttach} name={writeTo.name} firm={membership.firmName} />
              ) : (
                <p className="ib-note">
                  {writeTo.name} has no email address yet. Add one on <Link href={`/app/clients/${writeTo.id}?tab=details`}>the client&apos;s page</Link>.
                </p>
              ))}
          </div>
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
              {file && <p>The file: <strong>{file}</strong></p>}
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
        <SidePanel key="done" id="done-title" title={`Mark ${clearable.length === 1 ? "1 email" : `${clearable.length} emails`} as done?`} close={here}>
          <p className="hint">They leave Needs reply. Nobody is emailed, and Undo brings them back.</p>
          <ul className="app-rows ib-preview">
            {/* Each email by its client and status at once, its subject once the mailbox answers. */}
            <Suspense fallback={clearable.map((row) => <ListRow key={row.key} lead={<Avatar name={row.client} />} title={row.client} meta={`Emailed ${shortTime(row.at, today)}`} status={<Badge tone={row.tags[0]?.tone} plain={!row.tags[0]?.tone}>{row.tags[0]?.text}</Badge>} />)}>
              <Later>
                {listed.then(({ list }) => list.filter((row) => row.request).map((row) => (
                  <ListRow key={row.key} lead={<Avatar name={row.client} />} title={row.client} meta={row.subject} status={<Badge tone={row.tags[0]?.tone} plain={!row.tags[0]?.tone}>{row.tags[0]?.text}</Badge>} />
                )))}
              </Later>
            </Suspense>
          </ul>
          <form action={manageEmail} className="ib-send">
            {clearable.map((row) => <input key={row.key} type="hidden" name="request" value={row.request} />)}
            <input type="hidden" name="back" value={here} />
            <Pending className="b b-primary" name="intent" value="done" busy="Marking">
              <CheckCheck size={16} aria-hidden />
              Mark {clearable.length === 1 ? "1 email" : `${clearable.length} emails`} as done
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
          {cleared.length === 1 ? "Moved out of Needs reply." : `${cleared.length} emails moved out of Needs reply.`}
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
      {sp.replied && <Toast>Reply sent{sp.unsent ? `. ${sp.unsent} ${sp.unsent === "1" ? "paper" : "papers"} could not go; send from the client's Documents tab.` : ""}</Toast>}
      {sp.written && <Toast>Email sent{sp.unsent ? `. ${sp.unsent} ${sp.unsent === "1" ? "paper" : "papers"} could not go; send from the client's Documents tab.` : ""}</Toast>}
    </div>
  );
}
