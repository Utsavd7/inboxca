import { Mail, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
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
import { labels, replyReasons } from "@/src/lib/triage";
import { Empty, PageHead, SidePanel, Toast } from "../ui";
import { clientsOf, contactName, conversation } from "./conversation";
import { ComposeBox, InboxKeys, Reading, ReplyBox } from "./inbox-client";
import "./inbox.css";

const PAGE = 30;
const shows = { "": "All", reply: "Needs reply", in: "From clients", out: "Sent to clients" } as const;
const statuses = { reply: "Needs reply", filed: "Filed", reminder: "Reminder sent", team: "Sent by team", check: "To check" } as const;
const sentTags = { reminder: "Reminder sent", inboxca: "Sent by InboxCA", team: "Sent by team" } as const;
type Tag = { text: string; tone: "warn" | "done" | "" };
type Row = { key: string; href: string; dir: "in" | "out"; client: string; clientId: string | null; at: string; subject: string; snippet: string; tags: Tag[]; request?: string };

const india = (at: string, options: Intl.DateTimeFormatOptions) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...options });
const shortTime = (at: string, today: string) => {
  const day = new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return day === today ? india(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : day === addDays(today, -1) ? "Yesterday" : india(at, { day: "numeric", month: "short" });
};
const longTime = (at: string) => india(at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const uuid = /^[0-9a-f-]{36}$/;

type Search = Record<"mail" | "sent" | "client" | "show" | "status" | "when" | "q" | "before" | "cq" | "cpage" | "compose" | "approved" | "error" | "replied" | "written" | "unsent" | "answer" | "decided" | "cleared", string | undefined>;

// Every email with the firm's clients, both ways (PLAN.md 5.5): the list from InboxCA's
// records (which client, when, what waits) with subjects and first lines read live from the
// firm's mailbox, sent mail read live from its Sent folder, and the open conversation read
// live too. InboxCA keeps no copy of any of it. Questions, papers and files waiting for the
// team sit in a short list above.
export default async function Inbox({ searchParams }: { searchParams: Promise<Partial<Search>> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const sp = await searchParams;
  const firm = membership.firmId;
  const today = todayInIndia();
  const show = (sp.show && sp.show in shows ? sp.show : "") as keyof typeof shows;
  const status = (sp.status && sp.status in statuses ? sp.status : show === "reply" ? "reply" : "") as keyof typeof statuses | "";
  const when = sp.when && sp.when in whens ? sp.when : "";
  const q = (sp.q ?? "").trim().slice(0, 200);
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : "";
  const { data: chosenClient } = sp.client && uuid.test(sp.client) ? await supabase.from("clients").select("id, name").eq("id", sp.client).maybeSingle() : { data: null };
  const filters = { client: chosenClient?.id, show: show || undefined, status: sp.status && sp.status in statuses ? sp.status : undefined, when: when || undefined, q: q || undefined };
  const href = (change: Partial<Search> = {}) => {
    const params = new URLSearchParams(Object.entries({ ...filters, ...change }).filter((entry): entry is [string, string] => !!entry[1]));
    return `/app/inbox${params.size ? `?${params}` : ""}`;
  };
  const wantIn = show !== "out" && status !== "reminder" && status !== "team";
  const wantOut = show !== "reply" && show !== "in" && !["reply", "filed", "check"].includes(status);
  const range = whenRange(when, today);
  const until = [range.until, before].filter(Boolean).sort()[0];

  // Which emails a status keeps, from InboxCA's own records.
  const { data: only } =
    status === "reply"
      ? await supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("status", "pending").limit(1000).then(({ data }) => ({ data: data?.map((row) => row.entity_id) }))
      : status === "filed" || status === "check"
        ? await supabase.from("documents").select("email_event_id").eq("status", status === "filed" ? "filed" : "to_check").not("email_event_id", "is", null).limit(1000).then(({ data }) => ({ data: data?.map((row) => row.email_event_id!) }))
        : { data: null };
  let events = supabase.from("email_events").select("id, client_id, contact_id, received_at, label, decision_source, provider_message_id, clients(name), contacts(name_enc)").eq("firm_id", firm);
  if (chosenClient) events = events.eq("client_id", chosenClient.id);
  if (range.from) events = events.gte("received_at", range.from);
  if (until) events = events.lt("received_at", until);
  if (only) events = events.in("id", only);
  let needsCount = supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending");
  let inCount = supabase.from("email_events").select("id", { count: "exact", head: true }).eq("firm_id", firm);
  if (chosenClient) [needsCount, inCount] = [needsCount.eq("client_id", chosenClient.id), inCount.eq("client_id", chosenClient.id)];
  const cq = (sp.cq ?? "").trim().slice(0, 80);
  const cpage = Math.min(Math.max(0, Number(sp.cpage) || 0), 500);
  let pick = supabase.from("clients").select("id, name").is("archived_at", null).order("name").range(cpage * 8, cpage * 8 + 8);
  if (cq) pick = pick.ilike("name", `%${cq.replace(/[\\%_]/g, "\\$&")}%`);
  const [{ data: rows }, { count: needs }, { count: fromClients }, { data: pickList }, { data: waiting }, { data: toCheck }, { data: papers }, toAnswer, { data: people }, { data: accounts }, { data: decided }] = await Promise.all([
    wantIn && (!only || only.length) ? events.order("received_at", { ascending: false }).order("id").limit(q ? 500 : PAGE) : Promise.resolve({ data: [] as never[] }),
    needsCount,
    inCount,
    pick,
    supabase.from("requests").select("id, entity_id, reason_code").eq("kind", "team_reply").eq("status", "pending").limit(1000),
    supabase.from("documents").select("id, client_id, name, clients(name)").eq("status", "to_check").limit(50),
    supabase.from("shares").select("id, contact_id, documents(name, clients(name))").eq("status", "waiting").limit(50),
    // Questions this person may answer (5.17.2), the same ones Today counts.
    myQuestions(),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabaseAdmin().from("connected_accounts").select("kind, status, settings").eq("firm_id", firm),
    sp.decided && uuid.test(sp.decided) ? supabase.from("requests").select("id, status, reason_code, details").eq("kind", "permission").eq("id", sp.decided).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const emailOf = new Map(people?.map((person) => [person.user_id, person.email]));
  // A question in words, with the person's name: "Sunil asks to upload a file".
  const asking = (ask: { reason_code: string | null; details: unknown }) => {
    const details = ask.details as { by: string; until?: string };
    return { name: personName(emailOf.get(details.by)), what: ask.reason_code === "time" ? `work until ${details.until} today` : rightWords[ask.reason_code as Right] };
  };
  const answering = toAnswer.find((ask) => ask.id === sp.answer);
  // The owner's week of approvals (5.17.3, #51): who approved what, newest first.
  const owner = membership.role === "owner";
  const { data: week } = owner
    ? await supabaseAdmin().from("activity_log").select("at, actor_id, action, details").eq("firm_id", firm)
      .in("action", ["permission.allowed", "permission.always", "device.approved", "office.confirm", "office.today"])
      .gt("at", addDays(today, -7)).order("at", { ascending: false }).limit(50)
    : { data: null };
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

  // Sent mail of one client is searched by that client's own addresses.
  const admin = supabaseAdmin();
  const crypto = serverCrypto();
  let addresses: string[] = [];
  if (chosenClient && wantOut) {
    const [{ data: own }, { data: links }] = await Promise.all([
      admin.from("clients").select("email_enc").eq("id", chosenClient.id).single(),
      admin.from("contact_clients").select("contact_id, contacts(email_enc)").eq("client_id", chosenClient.id),
    ]);
    addresses = [
      ...(own?.email_enc ? [await crypto.decrypt(firm, `clients/${chosenClient.id}/email`, own.email_enc)] : []),
      ...(await Promise.all((links ?? []).filter((link) => link.contacts?.email_enc).map((link) => crypto.decrypt(firm, `contacts/${link.contact_id}/email`, link.contacts!.email_enc)))),
    ].slice(0, 20);
  }
  const events_ = rows ?? [];
  // Only what this page shows is read: the listed emails, and the newest sent ones that match.
  const sentAsk = wantOut && (!chosenClient || addresses.length) ? { limit: PAGE, ...(addresses.length && { to: addresses }), since: range.from, before: until, reminders: status === "reminder" } : null;
  const live = !connected
    ? ({ error: "not_connected" } as const)
    : events_.length || sentAsk
      ? await mailLive(firm, "list", { inbox: events_.map((event) => event.provider_message_id), q: q || undefined, sent: sentAsk })
      : { inbox: [], sent: null };
  const failed = "error" in live ? live.error : null;
  const liveIn = new Map(("error" in live ? [] : live.inbox).map((item) => [item.messageId, item]));

  const pending = new Map((waiting ?? []).map((request) => [request.entity_id, request]));
  const shown = (q ? events_.filter((event) => liveIn.has(event.provider_message_id)) : events_).slice(0, PAGE);
  const [{ data: done }, { data: filedDocs }] = shown.length
    ? await Promise.all([
        supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("status", "done").in("entity_id", shown.map((event) => event.id)),
        supabase.from("documents").select("email_event_id, status").in("email_event_id", shown.map((event) => event.id)),
      ])
    : [{ data: [] }, { data: [] }];
  const labelTag = (label: string | null): Tag => ({ text: labels[(label ?? "other") as keyof typeof labels] ?? labels.other, tone: "" });
  const stateTag = (eventId: string): Tag | null =>
    pending.has(eventId) ? { text: "Needs reply", tone: "warn" }
    : filedDocs?.some((doc) => doc.email_event_id === eventId && doc.status === "to_check") ? { text: "To check", tone: "warn" }
    : filedDocs?.some((doc) => doc.email_event_id === eventId && doc.status === "filed") ? { text: "Filed", tone: "done" }
    : done?.some((request) => request.entity_id === eventId) ? { text: "Done", tone: "done" }
    : null;
  // An email waiting for a reply also shows what it is, such as a notice that asks something.
  const inTags = (eventId: string, label: string | null): Tag[] => {
    const state = stateTag(eventId);
    return !state ? [labelTag(label)] : pending.has(eventId) && label && label !== "other" ? [state, labelTag(label)] : [state];
  };
  const inRows: Row[] = await Promise.all(
    shown.map(async (event) => {
      const item = liveIn.get(event.provider_message_id);
      return {
        key: event.id,
        href: href({ mail: event.id }),
        dir: "in" as const,
        client: event.clients?.name ?? ((await contactName(firm, event)) || "A contact"),
        clientId: event.client_id,
        at: event.received_at,
        subject: item?.subject ?? (failed ? "Subject not available just now" : "(no subject)"),
        snippet: item?.snippet ?? "",
        tags: inTags(event.id, event.label),
        request: pending.get(event.id)?.id,
      };
    }),
  );
  // Sent mail shows only when it went to a client the person may see.
  const sentItems = "error" in live ? [] : (live.sent ?? []).filter((item) => status !== "team" || sentKind(item.messageId) === "team");
  const parties = await clientsOf(firm, sentItems.flatMap((item) => item.to));
  const partyIds = [...new Set([...parties.values()].flat())];
  const { data: visible } = partyIds.length ? await supabase.from("clients").select("id, name").in("id", partyIds) : { data: [] };
  const sentClient = (item: MailItem) => visible?.find((row) => (!chosenClient || row.id === chosenClient.id) && item.to.some((address) => parties.get(address)?.includes(row.id)));
  const outRows: Row[] = sentItems.flatMap((item) => {
    const to = sentClient(item);
    return to ? [{ key: item.messageId, href: href({ sent: item.messageId }), dir: "out" as const, client: to.name, clientId: to.id, at: item.date, subject: item.subject || "(no subject)", snippet: item.snippet, tags: [{ text: sentTags[sentKind(item.messageId)], tone: "" as const }] }] : [];
  });
  const list = [...inRows, ...outRows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, PAGE);
  const older = (events_.length >= PAGE || (live && !("error" in live) && (live.sent?.length ?? 0) >= PAGE)) && list.length ? href({ before: list.at(-1)!.at }) : null;

  // The open email and its conversation, read live.
  const open = sp.mail || sp.sent ? await conversation(supabase, firm, { mail: sp.mail && uuid.test(sp.mail) ? sp.mail : undefined, sent: sp.mail ? undefined : sp.sent?.slice(0, 998) }) : null;
  const event = open?.event;
  const opened = open?.opened;
  const clientId = open?.client?.id ?? null;
  const inIds = open?.messages.filter((message) => message.box === "inbox").map((message) => message.messageId) ?? [];
  const [{ data: threadEvents }, { data: clientPapers }] = await Promise.all([
    inIds.length ? supabase.from("email_events").select("id, provider_message_id").eq("firm_id", firm).in("provider_message_id", inIds) : Promise.resolve({ data: [] as { id: string; provider_message_id: string }[] }),
    clientId && event ? supabase.from("documents").select("id, name, document_type, period_key").eq("client_id", clientId).eq("status", "filed").order("received_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] as { id: string; name: string; document_type: string; period_key: string }[] }),
  ]);
  const eventOf = new Map(threadEvents?.map((row) => [row.provider_message_id, row.id]));
  const { data: saved } = threadEvents?.length
    ? await supabase.from("documents").select("id, name, email_event_id, work_type, period_key, status, received_at").in("email_event_id", threadEvents.map((row) => row.id))
    : { data: [] };
  const order = ((drive?.settings ?? {}) as { folder_order?: FolderOrder }).folder_order ?? "year_client_work";
  const place = (doc: NonNullable<typeof saved>[number]) => folderFor(order, open?.client?.name ?? "", { work: doc.work_type as never, period: doc.period_key, receivedAt: doc.received_at ?? "", toCheck: doc.status === "to_check" }).join(" / ");
  const request = event ? pending.get(event.id) : undefined;
  const { data: links } = request?.reason_code === "client_unclear" && event ? await supabase.from("contact_clients").select("client_id, clients(name)").eq("contact_id", event.contact_id ?? "") : { data: [] };
  const sender = event ? event.clients?.name ?? ((await contactName(firm, event)) || "A contact") : "";
  const kind = opened && opened.box === "sent" ? sentKind(opened.messageId) : null;
  const openTag: Tag | null = event ? stateTag(event.id) : kind ? { text: sentTags[kind], tone: "" } : null;
  const asked = opened ? askedPaper(opened.subject, opened.text) : { types: [], period: "" };
  const suggested = opened && clientPapers ? suggestPapers(`${opened.subject}\n${opened.text}`, clientPapers, asked, [...documentTypes, ...((membership.settings.document_types ?? []) as string[])]).map((doc) => doc.id) : [];
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
  // The paging client picker, for the filter and for writing: a search, eight names a page.
  const clientPicker = (summary: string, keep: Partial<Search>, link: (id: string) => string, current?: string, open = !!cq || !!sp.cpage) => (
    <details className="ib-menu" open={open}>
      <summary>{summary}</summary>
      <div className="ib-pop">
        <form action="/app/inbox" role="search">
          {Object.entries(keep).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
          <input type="search" name="cq" defaultValue={cq} placeholder="Find a client" aria-label="Find a client" />
        </form>
        {current && !keep.compose && <Link href={href({ client: undefined })}>All clients</Link>}
        {pickList?.slice(0, 8).map((row) => (
          <Link key={row.id} href={link(row.id)} aria-current={row.id === current ? "true" : undefined}>{row.name}</Link>
        ))}
        {!pickList?.length && <span className="ib-note">No client by that name</span>}
        {(pickList?.length ?? 0) > 8 && <Link href={href({ compose: keep.compose, cq: cq || undefined, cpage: String(cpage + 1) })}>More clients</Link>}
      </div>
    </details>
  );

  return (
    <div className="ib fill">
      <InboxKeys />
      <PageHead
        title="Inbox"
        sub="Every email with your clients, both ways. Read live from the firm's mailbox; InboxCA keeps no copy."
        actions={connected && <Link className="b b-primary" href={href({ compose: "1" })} scroll={false}>Write to a client</Link>}
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
                    <span className="grow">
                      <strong>{share.documents?.name}</strong>
                      <span className="ib-note">Asked for by {share.contact_id ? "a contact of " : ""}{share.documents?.clients?.name}</span>
                    </span>
                    {approver && (
                      <form action={decideShare}>
                        <input type="hidden" name="share" value={share.id} />
                        <button className="b b-ghost" name="intent" value="refuse">Don&apos;t send</button>
                        <button className="b b-secondary" name="intent" value="approve">Approve and send</button>
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
        <nav className="ib-pills" aria-label="Show">
          {Object.entries(shows).map(([key, name]) => {
            const count = key === "reply" ? needs : key === "in" ? fromClients : null;
            return (
              <Link key={key} className="ib-pill" aria-current={show === key ? "page" : undefined} href={href({ show: key || undefined, status: undefined })}>
                {name}
                {count !== null && <span className="num">{count ?? 0}</span>}
              </Link>
            );
          })}
        </nav>
        {clientPicker(chosenClient?.name ?? "Client", { ...filters, client: undefined }, (id) => href({ client: id }), chosenClient?.id, !composing && (!!cq || !!sp.cpage))}
        <details className="ib-menu">
          <summary>{status && sp.status ? statuses[status] : "Status"}</summary>
          <div className="ib-pop">
            <Link href={href({ status: undefined })}>Any status</Link>
            {Object.entries(statuses).map(([key, name]) => (
              <Link key={key} href={href({ status: key, show: undefined })} aria-current={sp.status === key ? "true" : undefined}>{name}</Link>
            ))}
          </div>
        </details>
        <details className="ib-menu">
          <summary>{when ? whens[when as keyof typeof whens] : "When"}</summary>
          <div className="ib-pop">
            <Link href={href({ when: undefined })}>Any time</Link>
            {Object.entries(whens).map(([key, name]) => (
              <Link key={key} href={href({ when: key })} aria-current={when === key ? "true" : undefined}>{name}</Link>
            ))}
          </div>
        </details>
        <form className="ib-search" action="/app/inbox" role="search">
          {Object.entries({ ...filters, q: undefined }).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
          <Search size={14} aria-hidden />
          <input id="mail-search" type="search" name="q" defaultValue={q} placeholder="Search email" aria-label="Search email" title="Press / to search" />
        </form>
      </div>

      <Reading>
        <div className="pane ib-list">
          {failed === "unreachable" && <p className="alert" role="alert">The firm&apos;s mailbox could not be reached just now, so subjects and text are missing. Try again in a minute.</p>}
          {failed === "not_connected" ? (
            <Empty Icon={Mail} title="Connect the firm's email">
              <span>New client mail shows here once the firm&apos;s mailbox is connected.</span>
              {owner && <Link className="b b-primary" href="/app/settings#mailbox">Connect email</Link>}
            </Empty>
          ) : list.length ? (
            <ul aria-label="Emails">
              {list.map((row) => (
                <li key={row.key} className="ib-row" aria-current={row.key === openKey ? "true" : undefined}>
                  <Link href={row.href} scroll={false}>
                    <span className="ib-row-top">
                      <span className={`ib-dir ${row.dir}`}>{row.dir === "in" ? "IN" : "OUT"}</span>
                      <strong>{row.client}</strong>
                      <time dateTime={row.at}>{shortTime(row.at, today)}</time>
                    </span>
                    <span className="ib-subject">{row.subject}</span>
                    <span className="ib-row-foot">
                      <span className="ib-snippet">{row.snippet}</span>
                      {row.tags.map((tag) => <span key={tag.text} className={`ib-tag ${tag.tone}`}>{tag.text}</span>)}
                    </span>
                  </Link>
                  <span className="ib-acts">
                    {row.request && (
                      <form action={manageEmail}>
                        <input type="hidden" name="request" value={row.request} />
                        <input type="hidden" name="back" value={here} />
                        <button className="b b-secondary" name="intent" value="done">No reply needed</button>
                      </form>
                    )}
                    {row.clientId && <Link className="b b-secondary" href={`/app/clients/${row.clientId}`}>Open client</Link>}
                  </span>
                </li>
              ))}
              {older && <li className="ib-more"><Link href={older}>Older emails</Link></li>}
            </ul>
          ) : q ? (
            <Empty Icon={Search} title="No emails match">
              <span>Try other words, or clear the search.</span>
              <Link className="b b-secondary" href={href({ q: undefined })}>Clear search</Link>
            </Empty>
          ) : (
            <Empty Icon={Mail} title={Object.values(filters).some(Boolean) || before ? "No emails here" : "No client email yet"}>
              <span>{Object.values(filters).some(Boolean) || before ? "Nothing matches these filters." : "New mail from your clients shows here, sorted."}</span>
              {(Object.values(filters).some(Boolean) || before) && <Link className="b b-secondary" href="/app/inbox">Show all email</Link>}
            </Empty>
          )}
        </div>

        <article className="pane ib-open" aria-label="Open email">
          <div className="skeleton ib-skeleton" aria-hidden>
            <span className="skeleton-title" />
            {Array.from({ length: 4 }, (_, line) => <span key={line} />)}
          </div>
          {!openKey ? (
            <p className="ib-pick">Pick an email to read it here. Use j and k to move, Enter to open.</p>
          ) : !open ? (
            <p className="ib-pick">This email is not available.</p>
          ) : !opened ? (
            <p className="ib-pick" role="alert">{open.error ? "The firm's mailbox could not be reached just now. Try again in a minute." : "This email is no longer in the firm's mailbox."}</p>
          ) : (
            <div className="pane-in ib-convo" key={openKey}>
              <header className="ib-head">
                <div>
                  <h2>{opened.subject || "(no subject)"}</h2>
                  <p className="ib-note">{event ? `From ${sender}${open.client && event.contact_id ? `, ${open.client.name}` : ""}` : `${kind === "team" ? "Sent by your team" : "Sent by InboxCA"} to ${open.client?.name}`}</p>
                </div>
                {openTag && <span className={`ib-tag ${openTag.tone}`}>{openTag.text}</span>}
              </header>
              <div className="ib-actions">
                {event?.client_id && connected && <a className="b b-secondary" href="#reply-text" title="Press r">Reply</a>}
                {request && (
                  <form action={manageEmail}>
                    <input type="hidden" name="request" value={request.id} />
                    <input type="hidden" name="back" value={here} />
                    <button className="b b-secondary" name="intent" value="done" data-key="e" title="Takes it out of Needs reply. Press e">No reply needed</button>
                  </form>
                )}
                {open.client && <Link className="b b-secondary" href={`/app/clients/${open.client.id}`}>Open {open.client.name}</Link>}
                {request?.reason_code === "client_unclear" && event && (
                  <form action={manageEmail} className="ib-inline">
                    <input type="hidden" name="request" value={request.id} />
                    <input type="hidden" name="email" value={event.id} />
                    <select name="client" aria-label={`Which client the email from ${sender} is for`}>
                      {links?.map((link) => <option key={link.client_id} value={link.client_id}>{link.clients?.name}</option>)}
                    </select>
                    <button className="b b-secondary" name="intent" value="client">It is for this client</button>
                  </form>
                )}
                {event && (
                  <span className="ib-inline ib-label">
                    <span className="ib-tag">{labelTag(event.label).text}</span>
                    {event.decision_source === "staff" && <span className="ib-tag">Corrected</span>}
                    <details key={`${event.id}${event.label}`} className="ib-menu">
                      <summary title="Pick another label when InboxCA got it wrong">Change</summary>
                      <form action={manageEmail} className="ib-pop" aria-label="What this email is">
                        <input type="hidden" name="email" value={event.id} />
                        <input type="hidden" name="intent" value="label" />
                        {Object.entries(labels).map(([value, label]) => (
                          <button key={value} name="label" value={value} aria-current={value === (event.label ?? "other") ? "true" : undefined}>{label}</button>
                        ))}
                      </form>
                    </details>
                  </span>
                )}
                {event && gmail && <a className="b b-ghost" href={`/app/inbox/${event.id}/open`} target="_blank" rel="noreferrer">Open in Gmail</a>}
              </div>
              {request && request.reason_code && replyReasons[request.reason_code] && <p className="ib-note">{replyReasons[request.reason_code]}</p>}
              <ol className="ib-thread" aria-label="Conversation">
                {open.messages.map((message) => {
                  const files = saved?.filter((doc) => doc.email_event_id === eventOf.get(message.messageId)) ?? [];
                  return (
                    <li key={message.messageId} className={message.messageId === opened.messageId ? "on" : undefined}>
                      <p className="ib-who">
                        <strong>{message.box === "sent" ? (sentKind(message.messageId) === "team" ? "Your team" : "InboxCA") : message.messageId === opened.messageId ? sender || open.client?.name : open.client?.name}</strong>
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
                <ReplyBox mail={event.id} papers={(clientPapers ?? []).map(({ id, name }) => ({ id, name }))} suggested={suggested} ai={aiReady()} mayAttach={membership.may("send", event.client_id)} />
              )}
            </div>
          )}
        </article>
      </Reading>
      {composing && (
        <SidePanel id="compose-title" title="Write to a client" close={href()}>
          {sp.error && errors[sp.error] && <p className="alert" role="alert">{errors[sp.error]}</p>}
          <div className="ib-write">
            <div className="ib-field">
              <span>Client</span>
              {clientPicker(writeTo?.name ?? "Choose a client", { ...filters, compose: sp.compose }, (id) => href({ compose: id }), writeTo?.id, !writeTo || !!cq || !!sp.cpage)}
            </div>
            {writeTo &&
              (recipients.length ? (
                <ComposeBox key={writeTo.id} client={writeTo.id} recipients={recipients} papers={writePapers ?? []} ai={aiReady()} mayAttach={mayWriteAttach} />
              ) : (
                <p className="ib-note">
                  {writeTo.name} has no email address yet. Add one on <Link href={`/app/clients/${writeTo.id}?tab=details`}>the client&apos;s page</Link>.
                </p>
              ))}
          </div>
        </SidePanel>
      )}
      {answering && (() => {
        const { name, what } = asking(answering);
        const time = answering.reason_code === "time";
        const file = (answering.details as { document_name?: string }).document_name;
        return (
          <SidePanel id="answer-title" title={`${name} asks to ${what}${answering.clients?.name ? ` for ${answering.clients.name}` : ""}`} close={here}>
            <div className="ib-answer">
              {file && <p>The file: <strong>{file}</strong></p>}
              <p className="ib-note">{time ? "Allow today lets them keep working until then, today only." : "Allow once lets them do it one time, within an hour. Always allow lets them do it from now on, until you withdraw it in Settings."}</p>
              <form action={decidePermission} className="ib-inline">
                <input type="hidden" name="request" value={answering.id} />
                <button className="b b-primary" name="intent" value="allow">{time ? "Allow today" : "Allow once"}</button>
                {owner && !!answering.reason_code && answering.reason_code in switchable && <button className="b b-secondary" name="intent" value="always">Always allow {name}</button>}
                <button className="b b-ghost" name="intent" value="refuse">Refuse</button>
              </form>
            </div>
          </SidePanel>
        );
      })()}
      {decided && decided.status !== "pending" && (() => {
        const { name, what } = asking(decided);
        const always = decided.status === "used" && decided.reason_code !== "time";
        return (
          <Toast
            undo={decided.reason_code !== "time" && (
              <form action={undoPermission}>
                <input type="hidden" name="request" value={decided.id} />
                <button className="b">Undo</button>
              </form>
            )}
          >
            {decided.status === "refused" ? `Refused. ${name} may not ${what}.` : always ? `${name} may now always ${what}.` : decided.reason_code === "time" ? `${name} may ${what}.` : `${name} may ${what} once, within an hour.`}
          </Toast>
        );
      })()}
      {sp.cleared && (
        <Toast
          undo={
            <form action={manageEmail}>
              <input type="hidden" name="request" value={sp.cleared} />
              <input type="hidden" name="back" value={here} />
              <button className="b" name="intent" value="undo">Undo</button>
            </form>
          }
        >
          Moved out of Needs reply.
        </Toast>
      )}
      {sp.replied && <Toast>Reply sent{sp.unsent ? `. ${sp.unsent} ${sp.unsent === "1" ? "paper" : "papers"} could not go; send from the client's Documents tab.` : ""}</Toast>}
      {sp.written && <Toast>Email sent{sp.unsent ? `. ${sp.unsent} ${sp.unsent === "1" ? "paper" : "papers"} could not go; send from the client's Documents tab.` : ""}</Toast>}
    </div>
  );
}
