import { AlarmClock, CalendarDays, Check, FileCheck2, FileClock, MessageSquareText, Rocket, Sparkles, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { askAwayDevice, joinFirm, manageClient, manageTasks, sendNow, stopSend } from "@/app/(app)/actions";
import { PcKey } from "./pc-key";
import { PushSwitch } from "./push-switch";
import { supabaseAdmin } from "@/src/lib/supabase";
import { canManageClients } from "@/src/lib/clients";
import { dueLabel, periodLabel, todayInIndia } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { periodName } from "@/src/lib/documents";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember, myQuestions } from "@/src/lib/member";
import { formName, preparedSchema } from "@/src/lib/prepared";
import { roleNames } from "@/src/lib/roles";
import { OfficePanel } from "./office-panel";
import { DroppedNotice, PortalDrop } from "./portal-drop";
import { awake, replyReasons } from "@/src/lib/triage";
import { activityNames } from "@/src/lib/activity";
import { MAX_FOLLOW_UPS } from "@/src/lib/reminders";
import { MarkFiled } from "./mark-filed";
import { Pending } from "./pending";
import { Avatar, Badge, Card, CountUp, PageHead, ProgressRing, Row, SidePanel, storage, Toast } from "./ui";
import "./today.css";

const DAY = 86_400_000;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// What the daily drive check found, in a sentence the owner can act on.
const alertText = (reason: string, details: { free_bytes?: number; files?: number; client?: string; email?: string; count?: number }) =>
  ({
    drive_shared: "InboxCA's folder in your drive is shared with someone, or has a link. Only you should reach it: stop the sharing in your drive.",
    drive_full: `Your drive has ${((details.free_bytes ?? 0) / 1024 ** 2).toFixed(0)} MB left. Free some space or add more, so new client files can be saved.`,
    renames: `${details.email} renamed ${details.count} files today. Check the changes in each file's history.`,
    captures: `${details.email} tried to capture a document's screen ${details.count} times today. Each try is logged.`,
    parallel: `${details.email} signed in on another PC ${details.count} times today, which ends the other session each time. Ask whether their login is shared.`,
    request_stalled: `${details.client} has not uploaded the documents you asked for, after three reminders. A call may help.`,
    drive_missing: `${details.files} ${details.files === 1 ? "paper is" : "papers are"} missing from your drive.`,
  })[reason] ?? "Something in your drive needs a look.";

// The phone notifications line stays hidden once the person closes it.
async function hidePush() {
  "use server";
  (await cookies()).set("push_line", "hidden", { path: "/app", maxAge: 31_536_000, httpOnly: true, sameSite: "lax" });
}

// Today: what needs this person, in two columns of cards. Mail waiting for a reply, returns
// to approve and papers still missing on the left; late returns, one row a client, and what
// falls due this week on the right. Each row has one button. Everything is limited to what
// this person's role and the database's row rules let them see.
export default async function AppHome({ searchParams }: { searchParams: Promise<{ dropped?: string; error?: string; asked?: string; panel?: string; client?: string; confirm?: string; sending?: string; job?: string; stopped?: string; assigned?: string; marked?: string; t?: string }> }) {
  const { dropped, error, asked, panel, client: panelClient, confirm, sending, job, stopped, assigned, marked, t } = await searchParams;
  const { supabase, userId, membership, deviceStatus, connectionWaiting, pcKey } = await currentMember();
  const { data: invites } = await supabase.rpc("my_invites");
  const closed = membership ? null : (await supabase.rpc("closed_firms")).data?.[0];
  if (closed?.reason === "session") redirect("/auth/sign-out?reason=session");
  if (!membership) return <NoFirm closed={closed} invites={invites ?? []} deviceStatus={deviceStatus} connectionWaiting={connectionWaiting} pcKey={pcKey} />;

  const today = todayInIndia();
  const owner = membership.role === "owner";
  const lead = owner || membership.role === "partner";
  const approver = ["owner", "partner", "manager"].includes(membership.role);
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const { data: waitingDevices } = owner
    ? await supabase.from("devices").select("id").eq("firm_id", membership.firmId).eq("status", "waiting")
    : { data: [] };
  const waitingIds = waitingDevices?.map((device) => device.id) ?? [];
  const waitingToday = waitingIds.length
    ? await count(
        supabase
          .from("activity_log")
          .select("entity_id", { count: "exact", head: true })
          .eq("firm_id", membership.firmId)
          .eq("action", "device.first_seen")
          .in("entity_id", waitingIds)
          .gte("at", new Date(`${today}T00:00:00+05:30`).toISOString()),
      )
    : 0;
  const [replies, papers, forms, confirming, late, week, rules, setup, alerts, noticeAlerts, asks, mailboxNotice, usage] = await Promise.all([
    supabase.from("requests").select("id, entity_id, client_id, reason_code, clients(name)", { count: "exact" }).eq("kind", "team_reply").eq("status", "pending").or(awake(today)).limit(5),
    supabase.from("requests").select("id, client_id, details, clients(name)", { count: "exact" }).eq("kind", "documents").eq("status", "pending").gt("expires_at", new Date().toISOString()).order("expires_at", { ascending: false }).limit(5),
    approver || membership.may("mark_filed")
      ? supabase.from("documents").select("id, client_id, period_key, status, prepared, clients(name)").eq("firm_id", membership.firmId).not("prepared", "is", null).order("received_at", { ascending: false }).limit(100)
      : null,
    supabase.from("requests").select("entity_id").eq("firm_id", membership.firmId).eq("kind", "form_confirmation").eq("status", "pending").limit(100),
    supabase.rpc("late_clients", { target_firm: membership.firmId }, { count: "exact" }).limit(5),
    supabase.rpc("due_soon", { target_firm: membership.firmId }).limit(6),
    supabase.from("compliance_types").select("code, name, frequency").eq("period_key", ""),
    owner
      ? Promise.all([
          supabase
            .from("connected_accounts")
            .select("kind")
            .then((result) => result.data?.map((row) => row.kind) ?? []),
          count(supabase.from("clients").select("id", { count: "exact", head: true }).eq("firm_id", membership.firmId).is("archived_at", null)),
          count(supabase.from("client_registrations").select("id", { count: "exact", head: true }).filter("services", "neq", "{}")),
          count(supabase.from("firm_members").select("user_id", { count: "exact", head: true })),
        ])
      : null,
    lead ? supabase.from("requests").select("id, reason_code, details").eq("kind", "alert").eq("status", "pending").limit(20) : null,
    supabase.rpc("notice_alerts", { target_firm: membership.firmId }).limit(10),
    myQuestions(),
    owner ? supabase.from("connected_accounts").select("status").eq("firm_id", membership.firmId).eq("kind", "mail").maybeSingle() : null,
    owner ? supabase.rpc("firm_usage", { target_firm: membership.firmId }).then((result) => result.data?.[0]) : null,
  ]);
  // The month's returns for the ring, who looks after each late client, and what InboxCA did
  // by itself today (papers filed from email come from the papers themselves).
  const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
  const monthStart = `${today.slice(0, 8)}01`;
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const monthTasks = () => supabase.from("tasks").select("id", { count: "exact", head: true }).eq("firm_id", membership.firmId).eq("kind", "compliance").gte("due_on", monthStart).lte("due_on", monthEnd);
  const lateIds = late.data?.map((row) => row.client_id) ?? [];
  const [monthDue, monthFiled, { data: looked }, { data: done }, { data: filedToday }] = await Promise.all([
    count(monthTasks()),
    count(monthTasks().eq("status", "filed")),
    lateIds.length ? supabase.from("client_assignments").select("client_id").in("client_id", lateIds) : Promise.resolve({ data: [] }),
    supabase.rpc("activity_feed", { target_firm: membership.firmId, since: dayStart }),
    supabase.from("documents").select("client_id, received_at, clients(name)").eq("firm_id", membership.firmId).not("email_event_id", "is", null).eq("status", "filed").gte("received_at", dayStart).order("received_at", { ascending: false }).limit(100),
  ]);
  const assignedIds = new Set(looked?.map((row) => row.client_id));
  const papersBy = new Map<string, { at: string; name: string; papers: number }>();
  for (const paper of filedToday ?? []) {
    const seenClient = papersBy.get(paper.client_id);
    papersBy.set(paper.client_id, { at: seenClient?.at ?? paper.received_at, name: paper.clients?.name ?? "", papers: (seenClient?.papers ?? 0) + 1 });
  }
  const feed = [
    ...[...papersBy.entries()].map(([id, item]) => ({ key: `papers-${id}`, at: item.at, client: item.name, what: `${plural(item.papers, "paper", "papers")} filed from email` })),
    ...(done ?? []).map((line, at) => ({ key: `${line.at}-${at}`, at: line.at, client: line.client_name, what: activityNames[line.action] ?? "Client record changed" })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const sends = lead && !membership.viewOnlyUntil;
  const assignAs = membership.role === "manager" ? "manager" : "partner_in_charge";
  // The panels this page opens: Mark filed for a late client, and the preview before a send.
  const [{ data: marking }, preview] = await Promise.all([
    panel === "filed" && panelClient && /^[0-9a-f-]{36}$/.test(panelClient)
      ? supabase.from("tasks").select("id, code, period_key, due_on, clients(name)").eq("client_id", panelClient).eq("kind", "compliance").neq("status", "filed").lt("due_on", today).order("due_on").limit(100)
      : Promise.resolve({ data: null }),
    sends && (confirm === "late" || confirm === "papers") ? sendPreview(supabase, membership.firmId, confirm) : null,
  ]);
  const replyIds = replies.data?.map((request) => request.entity_id) ?? [];
  const { data: events } = replyIds.length ? await supabase.from("email_events").select("id, received_at").in("id", replyIds) : { data: [] };
  const eventById = new Map(events?.map((event) => [event.id, event]));
  // Questions this person may answer (5.17.2), counted for one line on Today.
  const deputy = ((membership.settings.office as { deputies?: string[] } | undefined)?.deputies ?? []).includes(userId);
  const questions = asks.length;
  // Approvers are asked once to get questions on their phone (5.17.3), until one device has it
  // or they close the line.
  const pushKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const askPush = !!pushKey && (owner || deputy || membership.role === "manager") && (await cookies()).get("push_line")?.value !== "hidden"
    && !(await supabaseAdmin().from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId)).count;
  const rule = new Map(rules.data?.map((r) => [r.code, r]));
  const returnName = (code: string | null, period: string | null) => `${rule.get(code ?? "")?.name ?? code ?? ""} for ${periodLabel(rule.get(code ?? "")?.frequency ?? null, period)}`;
  // Only the latest version of each prepared form counts: drafts to approve, and approved forms
  // whose acknowledgement arrived, to confirm the filing.
  const seen = new Set<string>();
  const waitingAck = new Set(confirming.data?.map((item) => item.entity_id));
  const toApprove = (forms?.data ?? [])
    .map((file) => ({ ...file, meta: preparedSchema.parse(file.prepared) }))
    .filter((file) => {
      const group = [file.client_id, file.period_key, file.meta.form, file.meta.registration].join(":");
      if (seen.has(group)) return false;
      seen.add(group);
      return file.status !== "deleted" && ((approver && file.meta.status === "draft") || (waitingAck.has(file.id) && membership.may("mark_filed", file.client_id)));
    });
  const short = (date: string) => dueLabel(date).slice(0, -5);
  const at = (iso: string) => {
    const day = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    return day === today ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : short(day);
  };
  // Things only the owner or partners act on: drive checks, PCs, the mailbox, notice dates.
  const looks: { key: string; text: string; href?: string; action?: string }[] = [
    ...(questions ? [{ key: "questions", text: `${questions === 1 ? "1 question waits" : `${questions} questions wait`} for your answer.`, href: "/app/inbox", action: "Answer" }] : []),
    ...(mailboxNotice?.data?.status === "needs_reconnect" ? [{ key: "mailbox", text: "Connect your firm's email again. Replies wait until it is connected.", href: "/app/settings#mailbox", action: "Reconnect email" }] : []),
    ...(waitingIds.length
      ? [{
          key: "pcs",
          text: waitingToday === waitingIds.length ? `${plural(waitingToday, "PC signed", "PCs signed")} in from your office today.` : `${plural(waitingIds.length, "PC is", "PCs are")} waiting for approval.`,
          href: "/app/settings#office",
          action: "Approve",
        }]
      : []),
    ...(noticeAlerts.data ?? []).map((notice) => ({
      key: notice.id,
      text: `${notice.client_name}: a notice's ${notice.action_date ? "action date" : "review deadline"} ${notice.due_on < today ? "has passed" : notice.due_on === today ? "is today" : "is within 3 days"}.`,
      href: "/app/notices",
      action: "Review notice",
    })),
    ...(alerts?.data ?? [])
      // Missing papers are the owner's to sort out, on the Documents page.
      .filter((alert) => (owner || alert.reason_code !== "drive_missing") && !alert.reason_code?.startsWith("office_") && (!["captures", "parallel", "renames"].includes(alert.reason_code ?? "") || (alert.details as { day?: string }).day === today))
      .map((alert) => ({
        key: alert.id,
        text: alertText(alert.reason_code ?? "", alert.details as { free_bytes?: number; files?: number; client?: string; email?: string; count?: number }),
        ...(alert.reason_code === "drive_missing" && { href: "/app/documents?year=all&show=missing", action: "See missing papers" }),
      })),
  ];
  const steps = setup && [
    { done: setup[0].includes("mail"), name: "Email", href: "/app/settings#mailbox", action: "Connect the firm's email" },
    { done: setup[0].includes("drive"), name: "Drive", href: "/app/settings#drive", action: "Link the firm's drive" },
    { done: !!setup[1], name: "Clients", href: "/app/clients", action: "Add your clients" },
    { done: !!setup[2], name: "Services", href: "/app/clients", action: "Tick what you file for a client" },
    { done: setup[3] > 1, name: "Team", href: "/app/people", action: "Invite your team" },
  ];
  const next = steps?.find((step) => !step.done);
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const lateCount = late.count ?? late.data?.length ?? 0;
  const things = (replies.count ?? 0) + toApprove.length + lateCount + looks.length;
  const portal = membership.may("portal_files");

  const replyCount = replies.count ?? 0;
  const close = "/app";
  const markedCount = t?.split(".").filter(Boolean).length ?? 0;
  const stats = [
    { key: "late", label: lateCount === 1 ? "Client late" : "Clients late", value: lateCount, href: "/app/clients?show=late", tone: "late" },
    { key: "reply", label: replyCount === 1 ? "Reply waiting" : "Replies waiting", value: replyCount, href: "/app/inbox?status=reply", tone: "reply" },
    approver
      ? { key: "approve", label: "For your approval", value: toApprove.length, href: "#t-approve", tone: "approve" }
      : { key: "papers", label: "Papers missing", value: papers.count ?? papers.data?.length ?? 0, href: "#t-missing", tone: "papers" },
  ];

  return (
    <div className="today">
      <PageHead
        title={greeting}
        sub={`${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}. ${things ? `${plural(things, "thing needs", "things need")} you today.` : "Nothing needs you today."}`}
        actions={
          <>
            {portal && (
              <Link className="b b-secondary" href="/app?panel=portal" scroll={false}>
                Add portal files
              </Link>
            )}
            {!membership.viewOnlyUntil && (
              <Link className="b b-secondary" href="/app/documents?upload=1">
                Upload papers
              </Link>
            )}
            {canManageClients(membership.role) && (
              <Link className="b b-primary" href="/app/clients?panel=add">
                New client
              </Link>
            )}
          </>
        }
      />

      {next && steps && (
        <section className="app-card today-setup" aria-labelledby="setup-title">
          <span className="icon-tile k-approve" aria-hidden>
            <Rocket size={16} />
          </span>
          <h2 id="setup-title">Finish setting up</h2>
          <ol aria-label="Setup steps">
            {steps.map((step) => (
              <li key={step.name} className={step.done ? "done" : undefined}>
                {step.done && <Check size={12} aria-label="Done" />}
                {step.name}
              </li>
            ))}
          </ol>
          <Link className="b b-primary" href={next.href}>
            {next.action}
          </Link>
        </section>
      )}

      <section className="app-card today-stats" aria-label="This month">
        <div className="today-ring">
          <ProgressRing done={monthFiled} total={monthDue} label="returns due this month filed" />
          <span>
            <strong>Returns filed this month</strong>
            <span className="sub">{monthDue ? `${monthFiled.toLocaleString("en-IN")} of ${monthDue.toLocaleString("en-IN")} due by ${dueLabel(monthEnd).slice(0, -5)}` : "No returns fall due this month."}</span>
          </span>
        </div>
        <ul className="today-chips">
          {stats.map((stat) => (
            <li key={stat.key}>
              <Link className={`stat-chip k-${stat.tone}${stat.value ? "" : " is-zero"}`} href={stat.href}>
                <strong>
                  <CountUp value={stat.value} />
                </strong>
                <span>{stat.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        {!!usage?.returns_this_year && (
          <p className="today-use">
            {usage.returns_so_far.toLocaleString("en-IN")} of {usage.returns_this_year.toLocaleString("en-IN")} returns this year are due so far. InboxCA storage used: {storage(usage.workspace_bytes)}.{" "}
            <Link href="/app/settings?group=data#use">See InboxCA use</Link>
          </p>
        )}
      </section>

      {askPush && (
        <div className="today-line">
          <span className="grow">Get questions and approvals on your phone too.</span>
          <PushSwitch publicKey={pushKey} />
          <form action={hidePush}>
            <button className="b b-ghost b-icon" aria-label="Close">
              <X size={16} aria-hidden />
            </button>
          </form>
        </div>
      )}
      {asked === "time" && <Toast>The owner is asked for more time today. You can keep working until closing.</Toast>}
      {assigned && <Toast>Assigned to you. The client is now on your list.</Toast>}
      {stopped && <Toast>Stopped. Nothing was sent.</Toast>}
      {sending && job && (
        <Toast
          undo={
            <form action={stopSend}>
              <input type="hidden" name="job" value={job} />
              <Pending className="b" busy="Stopping">Undo</Pending>
            </form>
          }
        >
          {sending === "papers" ? "Follow ups go out in a minute" : "Reminders go out in a minute"} from your firm&apos;s email.
        </Toast>
      )}
      {marked && markedCount > 0 && (
        <Toast
          undo={
            marked === "filed" && (
              <form action={manageTasks}>
                <input type="hidden" name="from" value="today" />
                {t!.split(".").map((id) => <input key={id} type="hidden" name="task" value={id} />)}
                <Pending className="b" name="intent" value="reopen" busy="Undoing">Undo</Pending>
              </form>
            )
          }
        >
          {plural(markedCount, "return", "returns")} marked {marked === "filed" ? "filed" : marked === "in_progress" ? "in progress" : "not filed"}.
        </Toast>
      )}
      <DroppedNotice value={dropped} />
      {error && todayErrors[error] && (
        <p className="alert" role="alert">
          {todayErrors[error]}
        </p>
      )}
      <OfficePanel compact />

      <div className="today-grid">
        <div className="today-col">
          {!!looks.length && (
            <Card id="t-look" title="Needs a look" Icon={TriangleAlert} kind="notice" count={looks.length} countTone="late">
              <ul className="app-rows stagger">
                {looks.map((look) => (
                  <li key={look.key} className="app-row">
                    <span className="grow" role="alert">
                      {look.text}
                    </span>
                    {look.href && (
                      <Link className="b b-secondary" href={look.href}>
                        {look.action}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card id="t-reply" title="Clients waiting for a reply" Icon={MessageSquareText} kind="reply" count={replyCount} countTone="warn">
            {replies.data?.length ? (
              <ul className="app-rows stagger">
                {replies.data.map((request) => {
                  const event = eventById.get(request.entity_id);
                  const client = request.clients?.name ?? "A contact";
                  return (
                    <Row
                      key={request.id}
                      lead={<Avatar name={client} />}
                      title={client}
                      meta={`${replyReasons[request.reason_code ?? ""] ?? "Needs your team"}${event ? `. Emailed ${at(event.received_at)}` : ""}`}
                      action={
                        <Link className="b b-secondary" href={event ? `/app/inbox?mail=${event.id}` : request.client_id ? `/app/clients/${request.client_id}` : "/app/inbox"} aria-label={`Reply to ${client}`}>
                          Reply
                        </Link>
                      }
                    />
                  );
                })}
              </ul>
            ) : (
              <p className="app-card-none">No client is waiting for a reply.</p>
            )}
            {replyCount > 5 && <SeeAll href="/app/inbox">See all {replyCount}</SeeAll>}
          </Card>

          {(approver || !!toApprove.length) && (
            <Card id="t-approve" title="Returns ready for your approval" Icon={FileCheck2} kind="approve" count={toApprove.length} countTone="blue">
              {toApprove.length ? (
                <ul className="app-rows stagger">
                  {toApprove.slice(0, 5).map((file) => (
                    <Row
                      key={file.id}
                      lead={<Avatar name={file.clients?.name ?? ""} />}
                      title={file.clients?.name}
                      meta={`${formName(file.meta.form)} for ${periodName(file.period_key)}${file.meta.status !== "draft" ? ", acknowledgement arrived" : ""}`}
                      action={
                        <Link className="b b-secondary" href={`/app/clients/${file.client_id}?tab=outputs`}>
                          {file.meta.status === "draft" ? "Review and approve" : "Confirm filing"}
                        </Link>
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className="app-card-none">Nothing waits for your approval.</p>
              )}
            </Card>
          )}

          <Card
            id="t-missing"
            title="Papers still missing"
            Icon={FileClock}
            kind="papers"
            end={
              papers.data?.length ? (
                sends ? (
                  <Link className="b b-secondary" href="/app?confirm=papers" scroll={false}>
                    Chase missing papers
                  </Link>
                ) : (
                  <span className="today-time">InboxCA is reminding them</span>
                )
              ) : null
            }
          >
            {papers.data?.length ? (
              <ul className="app-rows stagger">
                {papers.data.map((request) => {
                  const details = request.details as unknown as DocumentRequest;
                  const missing = (details.items ?? []).filter((item) => !item.received.length).map((item) => item.type);
                  const reminded = details.followups?.at(-1);
                  return (
                    <Row
                      key={request.id}
                      lead={<Avatar name={request.clients?.name ?? ""} />}
                      title={request.clients?.name}
                      meta={`${(missing.length ? missing : (details.items ?? []).map((item) => item.type)).join(", ")}${details.period ? ` for ${periodName(details.period)}` : ""}`}
                      status={<Badge plain>{reminded ? `Reminded ${short(reminded)}` : "Not reminded yet"}</Badge>}
                      action={
                        request.client_id && (
                          <Link className="b b-secondary" href={`/app/clients/${request.client_id}`}>
                            Open client
                          </Link>
                        )
                      }
                    />
                  );
                })}
              </ul>
            ) : (
              <p className="app-card-none">
                No papers are missing.{" "}
                <Link className="b b-secondary" href="/app/clients">
                  Ask a client for papers
                </Link>
              </p>
            )}
          </Card>
        </div>

        <div className="today-col">
          <Card
            id="t-late"
            title="Late returns"
            Icon={AlarmClock}
            kind="late"
            count={lateCount ? plural(lateCount, "client", "clients") : null}
            countTone="late"
            end={
              sends &&
              !!lateCount && (
                <Link className="b b-secondary" href="/app?confirm=late" scroll={false}>
                  Remind all late clients
                </Link>
              )
            }
          >
            {late.data?.length ? (
              <>
                <ul className="app-rows stagger">
                  {late.data.map((row) => {
                    const days = Math.round((Date.parse(today) - Date.parse(row.due_on)) / DAY);
                    return (
                      <Row
                        key={row.client_id}
                        lead={<Avatar name={row.client_name} />}
                        title={row.client_name}
                        meta={`${returnName(row.code, row.period_key)}${row.returns > 1 ? ` and ${row.returns - 1} more` : ""}`}
                        status={<Badge tone="late">{plural(days, "day", "days")} late</Badge>}
                        more={
                          <>
                            {!membership.viewOnlyUntil && membership.may("mark_filed", row.client_id) && (
                              <Link className="b b-ghost" href={`/app?panel=filed&client=${row.client_id}`} scroll={false} aria-label={`Mark filed for ${row.client_name}`}>
                                Mark filed
                              </Link>
                            )}
                            {!membership.viewOnlyUntil && canManageClients(membership.role) && !assignedIds.has(row.client_id) && (
                              <form action={manageClient}>
                                <input type="hidden" name="from" value="today" />
                                <input type="hidden" name="client" value={row.client_id} />
                                <input type="hidden" name="intent" value="assign" />
                                <input type="hidden" name="role" value={assignAs} />
                                <input type="hidden" name="who" value={`person:${userId}`} />
                                <Pending className="b b-ghost" busy="Assigning" aria-label={`Assign ${row.client_name} to me`}>
                                  Assign to me
                                </Pending>
                              </form>
                            )}
                          </>
                        }
                        action={
                          <Link className="b b-secondary" href={`/app/clients/${row.client_id}?tab=due`} aria-label={`See returns for ${row.client_name}`}>
                            See returns
                          </Link>
                        }
                      />
                    );
                  })}
                </ul>
                {lateCount > late.data.length && <SeeAll href="/app/calendar?view=overdue">See all {lateCount} clients</SeeAll>}
              </>
            ) : late.error ? (
              <p className="app-card-none">Late returns could not load. Refresh the page.</p>
            ) : (
              <p className="app-card-none">No return is late.</p>
            )}
          </Card>

          <Card id="t-week" title="Due in the next 7 days" Icon={CalendarDays} kind="week">
            {week.data?.length ? (
              <ul className="app-rows stagger">
                {week.data.slice(0, 5).map((row) => {
                  const [day, month] = dueLabel(row.due_on).split(" ");
                  const left = row.clients - row.filed;
                  return (
                    <Row
                      key={`${row.due_on}-${row.code}`}
                      lead={
                        <span className="today-date" aria-label={dueLabel(row.due_on)}>
                          <span>{month}</span>
                          <strong>{day}</strong>
                        </span>
                      }
                      title={rule.get(row.code)?.name ?? row.code}
                      meta={plural(row.clients, "client", "clients")}
                      status={left ? <Badge tone="warn">{left} to file</Badge> : <Badge tone="done">Filed</Badge>}
                    />
                  );
                })}
              </ul>
            ) : (
              <p className="app-card-none">
                Nothing is due in the next 7 days.{" "}
                <Link className="b b-secondary" href="/app/calendar">
                  Open calendar
                </Link>
              </p>
            )}
            {(week.data?.length ?? 0) > 5 && <SeeAll href="/app/calendar?view=week">See all</SeeAll>}
          </Card>

          <Card id="t-done" title="What InboxCA did today" Icon={Sparkles} kind="docs">
            {feed.length ? (
              <ol className="today-feed">
                {feed.map((item) => (
                  <li key={item.key}>
                    <span className="today-feed-dot" aria-hidden />
                    <span className="grow">
                      {item.what} <span className="sub-inline">{item.client}</span>
                    </span>
                    <time className="today-time" dateTime={item.at}>
                      {at(item.at)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="app-card-none">Nothing yet today. Papers filed from email and reminders sent show here.</p>
            )}
          </Card>
        </div>
      </div>

      {portal && panel === "portal" && (
        <SidePanel id="portal-title" title="Files from the GST portal" close={close}>
          <PortalDrop />
        </SidePanel>
      )}
      {marking && !membership.viewOnlyUntil && (
        <SidePanel id="mark-filed" title={marking.length > 1 ? `Mark ${marking.length} returns filed` : "Mark filed"} close={close}>
          {marking.length ? (
            <MarkFiled state={<input type="hidden" name="from" value="today" />} rows={marking.map((task) => ({ id: task.id, name: task.clients?.name ?? "", sub: `${returnName(task.code, task.period_key)}, due ${dueLabel(task.due_on)}` }))} />
          ) : (
            <p className="hint">This client has no late return now.</p>
          )}
        </SidePanel>
      )}
      {preview && (
        <SidePanel id="send-title" title={preview.title} close={close}>
          <p className="hint">{preview.hint}</p>
          {!preview.mailbox && (
            <p className="alert" role="alert">
              Connect the firm&apos;s email in Settings first. Reminders go from the firm&apos;s own address.
            </p>
          )}
          <ul className="app-rows today-preview">
            {preview.rows.map((row) => (
              <Row key={row.key} lead={<Avatar name={row.name} />} title={row.name} meta={row.what} status={row.skip ? <Badge plain>{row.skip}</Badge> : <Badge tone="blue">Will be emailed</Badge>} />
            ))}
          </ul>
          <form action={sendNow} className="mark-filed-actions today-send">
            <input type="hidden" name="what" value={confirm} />
            <Pending className="b b-primary" busy="Sending" disabled={!preview.mailbox || !preview.count}>
              {preview.button}
            </Pending>
            <Link className="b b-secondary" href={close} scroll={false}>
              Cancel
            </Link>
          </form>
        </SidePanel>
      )}
    </div>
  );
}

const todayErrors: Record<string, string> = {
  view_only: "This device can only view. Make changes from the office.",
  drive: "Connect the firm's drive in Settings first; portal files are saved there.",
  assign: "That client could not be assigned to you. Try again from the client's page.",
  send: "The send could not start. Try again.",
  started: "The send had already started, so it could not be stopped.",
};

// Who gets what when the late clients are reminded or missing papers chased at once, for the
// preview before Send. The job decides the rest the same way (see src/jobs/reminders.ts).
async function sendPreview(supabase: Awaited<ReturnType<typeof currentMember>>["supabase"], firm: string, what: "late" | "papers") {
  const skipFor = (client: { email_enc: string | null; reminders_paused: boolean } | null) => (!client ? "Not emailed" : client.reminders_paused ? "Reminders paused" : !client.email_enc ? "No email address" : null);
  const [{ data: mailbox }, list] = await Promise.all([
    supabase.from("connected_accounts").select("status").eq("firm_id", firm).eq("kind", "mail").maybeSingle(),
    what === "late"
      ? supabase.rpc("late_clients", { target_firm: firm }).limit(200).then(async ({ data: late }) => {
          const ids = late?.map((row) => row.client_id) ?? [];
          const { data: people } = ids.length ? await supabase.from("clients").select("id, email_enc, reminders_paused").in("id", ids) : { data: [] };
          const byId = new Map(people?.map((person) => [person.id, person]));
          return (late ?? []).map((row) => ({ key: row.client_id, name: row.client_name, what: `${plural(row.returns, "late return", "late returns")}, the oldest due ${dueLabel(row.due_on)}`, skip: skipFor(byId.get(row.client_id) ?? null) }));
        })
      : supabase.from("requests").select("id, details, clients(name, email_enc, reminders_paused)").eq("kind", "documents").eq("status", "pending").gt("expires_at", new Date().toISOString()).limit(200).then(({ data: asks }) =>
          (asks ?? []).flatMap((ask) => {
            const details = ask.details as unknown as DocumentRequest;
            const missing = (details.items ?? []).filter((item) => !item.received.length).map((item) => item.type);
            if (!missing.length) return [];
            const asked = details.followups?.length ?? 0;
            return [{ key: ask.id, name: ask.clients?.name ?? "", what: missing.join(", "), skip: asked >= MAX_FOLLOW_UPS ? `Reminded ${asked} times` : skipFor(ask.clients) }];
          }),
        ),
  ]);
  const count = list.filter((row) => !row.skip).length;
  return {
    rows: list,
    count,
    mailbox: mailbox?.status === "connected",
    title: what === "late" ? `Remind ${plural(list.length, "late client", "late clients")}` : "Chase missing papers",
    hint:
      what === "late"
        ? "Each client gets one email from your firm's address listing their late returns. Anyone already reminded today, who already sent papers for that period, or whose email your team is answering is skipped."
        : "Each client gets one email from your firm's address listing the papers still missing, with their upload link. Anyone already reminded today is skipped.",
    button: what === "late" ? `Send ${plural(count, "reminder", "reminders")}` : `Send ${plural(count, "follow up", "follow ups")}`,
  };
}

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div className="app-card-foot">
      <Link className="b b-secondary" href={href}>
        {children}
      </Link>
    </div>
  );
}

// Someone signed in who is not in a firm yet: their invites, or the firm being closed.
function NoFirm({ closed, invites, deviceStatus, connectionWaiting, pcKey }: { closed: { firm_name: string; hours: unknown; reason: string; away: boolean } | null | undefined; invites: { firm_id: string; firm_name: string; role: string }[]; deviceStatus: "waiting" | "refused" | null; connectionWaiting: boolean; pcKey: "needed" | "ready" | null }) {
  if (connectionWaiting)
    return (
      <>
        <PageHead title="Waiting for your firm to confirm the office internet connection" sub={pcKey === "ready" ? "This PC stays in the office, so its key can confirm the new connection. The owner is told." : "Ask the owner or a deputy to confirm this connection."} />
        {pcKey === "ready" && <PcKey mode="confirm" />}
      </>
    );
  if (closed?.reason === "office" && deviceStatus)
    return (
      <PageHead
        title={deviceStatus === "waiting" ? "This PC is waiting for your firm's approval." : "Your firm refused this PC."}
        sub={deviceStatus === "waiting" ? "Ask the owner to approve it in Settings. You can try again after that." : "Ask the owner if this PC should be allowed."}
      />
    );
  if (closed?.reason === "office")
    return (
      <>
        <PageHead
          title="Use InboxCA from your office."
          sub={`${closed.firm_name} lets staff use InboxCA only in the office, on the office internet connection. If you are in the office now, ask the owner to confirm this connection.`}
        />
        {closed.away && (
          <form action={askAwayDevice} className="form-row">
            <button className="b b-secondary">Ask to use this device away from the office</button>
            <span className="hint">The owner may allow it for some days, to view only.</span>
          </form>
        )}
      </>
    );
  return (
    <>
      <PageHead
        title={closed ? `${closed.firm_name} is closed now.` : invites.length ? "Welcome to InboxCA." : "You are not part of a firm yet."}
        sub={
          closed
            ? describeHours(closed.hours as Hours)
              ? `Your firm uses InboxCA during office hours: ${describeHours(closed.hours as Hours)}, India time.`
              : "Your firm has no office hours set. Ask the owner."
            : invites.length
              ? "Join your firm to start."
              : "Ask your firm's owner to invite you."
        }
      />
      {!!invites.length && (
        <section className="panel" aria-labelledby="invites">
          <h2 id="invites">Invites</h2>
          <ul className="rows">
            {invites.map((invite) => (
              <li key={invite.firm_id}>
                <span className="grow">
                  <strong>{invite.firm_name}</strong> has invited you as {roleNames[invite.role]}.
                </span>
                <form action={joinFirm}>
                  <input type="hidden" name="firm" value={invite.firm_id} />
                  <button className="b b-primary" type="submit">
                    Join {invite.firm_name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
