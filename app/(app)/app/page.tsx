import { AlarmClock, CalendarDays, Check, FileClock, Inbox, PartyPopper, Rocket, Sparkles, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { askAwayDevice, joinFirm, manageClient, manageTasks, seenAlert, sendNow, stopSend } from "@/app/(app)/actions";
import { PcKey } from "./pc-key";
import { PushSwitch } from "./push-switch";
import { supabaseAdmin } from "@/src/lib/supabase";
import { canManageClients } from "@/src/lib/clients";
import { addDays, dueLabel, periodLabel, todayInIndia } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { periodName } from "@/src/lib/documents";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember, myQuestions } from "@/src/lib/member";
import { formName, preparedSchema } from "@/src/lib/prepared";
import { personName, roleNames } from "@/src/lib/roles";
import { OfficePanel } from "./office-panel";
import { DroppedNotice, PortalDrop } from "./portal-drop";
import { awake, replyReasons } from "@/src/lib/triage";
import { activityNames } from "@/src/lib/activity";
import { MAX_FOLLOW_UPS } from "@/src/lib/reminders";
import { openStages, worksLeads } from "@/src/lib/leads";
import { MarkFiled } from "./mark-filed";
import { Count, Draw, List, Presence, Press } from "./motion";
import { Pending } from "./pending";
import { firmAccounts } from "./shell-data";
import { Celebrate } from "./today-client";
import { Avatar, Badge, Card, IconTile, PageHead, ProgressRing, Row, SidePanel, Toast } from "./ui";
import "./today.css";

const DAY = 86_400_000;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// What the daily drive check found, in a sentence the owner can act on.
const alertText = (reason: string, details: { free_bytes?: number; files?: number; client?: string; email?: string; count?: number; name?: string }) =>
  ({
    drive_shared: "InboxCA's folder in your drive is shared with someone, or has a link. Only you should reach it: stop the sharing in your drive.",
    drive_full: `Your drive has ${((details.free_bytes ?? 0) / 1024 ** 2).toFixed(0)} MB left. Free some space or add more, so new client files can be saved.`,
    renames: `${details.email} renamed ${details.count} files today. Check the changes in each file's history.`,
    captures: `${details.email} tried to capture a document's screen ${details.count} times today. Each try is logged.`,
    parallel: `${details.email} signed in on another PC ${details.count} times today, which ends the other session each time. Ask whether their login is shared.`,
    request_stalled: `${details.client} has not uploaded the documents you asked for, after three reminders. A call may help.`,
    drive_missing: `${details.files} ${details.files === 1 ? "paper is" : "papers are"} missing from your drive.`,
    drive_away: "InboxCA cannot reach your drive. New files wait up to 7 days.",
    virus: `${details.name} had a virus. Nobody can open it in InboxCA; it is in the Files with a virus folder of your drive.`,
  })[reason] ?? "Something in your drive needs a look.";

// The phone notifications line stays hidden once the person closes it.
async function hidePush() {
  "use server";
  (await cookies()).set("push_line", "hidden", { path: "/app", maxAge: 31_536_000, httpOnly: true, sameSite: "lax" });
}

type Params = { dropped?: string; error?: string; asked?: string; panel?: string; client?: string; confirm?: string; sending?: string; job?: string; stopped?: string; assigned?: string; marked?: string; t?: string };
type Db = Awaited<ReturnType<typeof currentMember>>["supabase"];
type Member = NonNullable<Awaited<ReturnType<typeof currentMember>>["membership"]>;
type Data = ReturnType<typeof load>;

// Today: what needs this person, as a dashboard. A greeting with how many things need them,
// four figures for the month (each opens its list), then "Needs you now" (replies, approvals
// and what the owner must look at, most urgent first) and the late returns on the left, and
// getting started, the next 7 days, papers still missing and what InboxCA did on the right.
// Every query starts at once; each part shows as soon as its own data is in, so the page
// paints at once. Everything is limited to what this person's role and the row rules allow.
export default async function AppHome({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { dropped, error, asked, panel, sending, job, stopped, assigned, marked, t } = params;
  const { supabase, userId, membership, deviceStatus, connectionWaiting, pcKey } = await currentMember();
  if (!membership) {
    const [{ data: invites }, { data: closedFirms }] = await Promise.all([supabase.rpc("my_invites"), supabase.rpc("closed_firms")]);
    const closed = closedFirms?.[0];
    if (closed?.reason === "session") redirect("/auth/sign-out?reason=session");
    return <NoFirm closed={closed} invites={invites ?? []} deviceStatus={deviceStatus} connectionWaiting={connectionWaiting} pcKey={pcKey} />;
  }
  const data = load(supabase, membership, userId, params);
  const portal = membership.may("portal_files");
  const markedCount = t?.split(".").filter(Boolean).length ?? 0;
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="today">
      <PageHead
        title="Today"
        sub={
          <section className="greet" aria-label="Greeting">
            <p className="greet-hi">
              {greeting}, {personName(membership.email)}
            </p>
            <p className="greet-line">
              {new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}.{" "}
              <Suspense fallback={<span className="greet-wait">Looking at what needs you</span>}>
                <Things data={data} />
              </Suspense>
            </p>
          </section>
        }
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

      <Suspense fallback={null}>
        <PushLine data={data} />
      </Suspense>
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
      <Suspense fallback={null}>
        <OfficePanel compact />
      </Suspense>

      <Suspense fallback={<KpiSkeleton />}>
        <Kpis data={data} />
      </Suspense>

      <div className="today-bento">
        <div className="today-col">
          <Suspense fallback={<CardSkeleton title="Needs you now" rows={4} />}>
            <NeedsNow data={data} />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="Late returns" rows={4} />}>
            <LateReturns data={data} />
          </Suspense>
        </div>
        <div className="today-col">
          {data.owner && (
            <Suspense fallback={null}>
              <GettingStarted data={data} />
            </Suspense>
          )}
          <Suspense fallback={<CardSkeleton title="Due this week" rows={2} />}>
            <ThisWeek data={data} />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="Papers still missing" rows={2} />}>
            <Missing data={data} />
          </Suspense>
          <Suspense fallback={<CardSkeleton title="What InboxCA did today" rows={3} />}>
            <Feed data={data} />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={null}>
        <Panels data={data} portal={portal && panel === "portal"} />
      </Suspense>
    </div>
  );
}

// Every query Today needs, started together; each part awaits only its own.
function load(supabase: Db, membership: Member, userId: string, params: Params) {
  const today = todayInIndia();
  const firm = membership.firmId;
  const owner = membership.role === "owner";
  const lead = owner || membership.role === "partner";
  const approver = ["owner", "partner", "manager"].includes(membership.role);
  const sends = lead && !membership.viewOnlyUntil;
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
  const weekStart = addDays(today, -6);
  const monthStart = `${today.slice(0, 8)}01`;
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const monthTasks = () => supabase.from("tasks").select("id", { count: "exact", head: true }).eq("firm_id", firm).eq("kind", "compliance").gte("due_on", monthStart).lte("due_on", monthEnd);

  const replies = Promise.resolve(supabase.from("requests").select("id, entity_id, client_id, reason_code, clients(name)", { count: "exact" }).eq("kind", "team_reply").eq("status", "pending").or(awake(today)).limit(5));
  // Every waiting reply's email (up to 200), for the average wait and each row's time.
  const waits = Promise.resolve(supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("status", "pending").or(awake(today)).limit(200)).then(async ({ data: rows }) => {
    const ids = rows?.map((row) => row.entity_id) ?? [];
    const { data: events } = ids.length ? await supabase.from("email_events").select("id, received_at").in("id", ids) : { data: [] };
    const ages = events?.map((event) => Date.now() - Date.parse(event.received_at)) ?? [];
    // The average only when every waiting reply was read.
    const average = ages.length && ages.length === ids.length && ids.length < 200 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : null;
    return { at: new Map(events?.map((event) => [event.id, event.received_at])), average };
  });
  const papers = Promise.resolve(supabase.from("requests").select("id, client_id, details, clients(name)", { count: "exact" }).eq("kind", "documents").eq("status", "pending").gt("expires_at", new Date().toISOString()).order("expires_at", { ascending: false }).limit(5));
  const late = Promise.resolve(supabase.rpc("late_clients", { target_firm: firm }, { count: "exact" }).limit(5));
  const week = Promise.resolve(supabase.rpc("due_soon", { target_firm: firm }));
  const rules = Promise.resolve(supabase.from("compliance_types").select("code, name, frequency").eq("period_key", "")).then(({ data: rows }) => new Map(rows?.map((rule) => [rule.code, rule])));
  const questions = myQuestions();
  const accounts = firmAccounts();

  // Prepared returns: drafts to approve, and approved forms whose acknowledgement arrived, to
  // confirm the filing. Only the latest version of each counts.
  const toApprove = Promise.all([
    approver || membership.may("mark_filed")
      ? Promise.resolve(supabase.from("documents").select("id, client_id, period_key, status, prepared, clients(name)").eq("firm_id", firm).not("prepared", "is", null).order("received_at", { ascending: false }).limit(100))
      : null,
    Promise.resolve(supabase.from("requests").select("entity_id").eq("firm_id", firm).eq("kind", "form_confirmation").eq("status", "pending").limit(100)),
  ]).then(([forms, confirming]) => {
    const seen = new Set<string>();
    const waitingAck = new Set(confirming.data?.map((item) => item.entity_id));
    return (forms?.data ?? [])
      .map((file) => ({ ...file, meta: preparedSchema.parse(file.prepared) }))
      .filter((file) => {
        const group = [file.client_id, file.period_key, file.meta.form, file.meta.registration].join(":");
        if (seen.has(group)) return false;
        seen.add(group);
        return file.status !== "deleted" && ((approver && file.meta.status === "draft") || (waitingAck.has(file.id) && membership.may("mark_filed", file.client_id)));
      });
  });

  // Things only the owner or partners act on: drive checks, PCs, the mailbox, notice dates.
  const looks = Promise.all([
    questions,
    owner ? accounts : null,
    owner ? Promise.resolve(supabase.from("devices").select("id").eq("firm_id", firm).eq("status", "waiting")) : null,
    Promise.resolve(supabase.rpc("notice_alerts", { target_firm: firm }).limit(10)),
    lead ? Promise.resolve(supabase.from("requests").select("id, reason_code, details").eq("kind", "alert").eq("status", "pending").limit(20)) : null,
    // Leads whose follow up day has come (5.12), for those who work leads.
    worksLeads(membership.role) ? Promise.resolve(supabase.from("clients").select("id, name, stage, follow_up_on:details->>follow_up_on").eq("firm_id", firm).in("stage", [...openStages]).lte("details->>follow_up_on", today).order("details->>follow_up_on").limit(5)) : null,
  ]).then(async ([asks, mailboxes, devices, noticeAlerts, alerts, followUps]) => {
    const waitingIds = devices?.data?.map((device) => device.id) ?? [];
    const waitingToday = waitingIds.length
      ? await count(supabase.from("activity_log").select("entity_id", { count: "exact", head: true }).eq("firm_id", firm).eq("action", "device.first_seen").in("entity_id", waitingIds).gte("at", dayStart))
      : 0;
    const looksList: { key: string; text: string; href?: string; action?: string; urgent?: boolean; seen?: string }[] = [
      ...(asks.length ? [{ key: "questions", text: `${asks.length === 1 ? "1 question waits" : `${asks.length} questions wait`} for your answer.`, href: "/app/inbox", action: "Answer" }] : []),
      ...(mailboxes?.find((account) => account.kind === "mail")?.status === "needs_reconnect" ? [{ key: "mailbox", text: "Connect your firm's email again. Replies wait until it is connected.", href: "/app/settings#mailbox", action: "Reconnect email", urgent: true }] : []),
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
        urgent: notice.due_on <= today,
      })),
      ...(alerts?.data ?? [])
        // Missing papers and files with a virus are the owner's to sort out.
        .filter((alert) => (owner || !["drive_missing", "virus"].includes(alert.reason_code ?? "")) && !alert.reason_code?.startsWith("office_") && (!["captures", "parallel", "renames"].includes(alert.reason_code ?? "") || (alert.details as { day?: string }).day === today))
        .map((alert) => ({
          key: alert.id,
          text: alertText(alert.reason_code ?? "", alert.details as { free_bytes?: number; files?: number; client?: string; email?: string; count?: number; name?: string }),
          ...(alert.reason_code === "drive_missing" && { href: "/app/documents?year=all&show=missing", action: "See missing papers" }),
          ...(alert.reason_code === "drive_away" && owner && { href: "/app/settings?group=email#drive", action: "Open drive settings", urgent: true }),
          ...(alert.reason_code === "virus" && { seen: alert.id, urgent: true }),
        })),
      ...(followUps?.data ?? []).map((row) => ({
        key: row.id,
        text: `${row.name}: ${row.follow_up_on! < today ? `follow up was due ${dueLabel(row.follow_up_on!)}` : row.stage === "lead_new" ? "new enquiry, reply today" : "follow up today"}.`,
        href: `/app/leads?lead=${row.id}`,
        action: "Follow up",
        urgent: row.follow_up_on! < today,
      })),
    ];
    return looksList.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent));
  });

  // The figures: the month's returns, and how the late count, replies and papers moved.
  const month = Promise.all([count(monthTasks()), count(monthTasks().eq("status", "filed"))]).then(([due, filed]) => ({ due, filed, end: monthEnd }));
  // Clients late on each of the last 14 days: a return is late from the day after it falls due
  // until the day it is filed. Read from the open late returns and those filed since; when
  // there are too many to read at once the trend is left out rather than guessed.
  const lateTrend = Promise.resolve(
    supabase
      .from("tasks")
      .select("client_id, due_on, status, filed_on:details->>filed_on, clients!inner(archived_at)")
      .eq("firm_id", firm)
      .eq("kind", "compliance")
      .lt("due_on", today)
      .is("clients.archived_at", null)
      .or(`status.neq.filed,details->>filed_on.gte.${addDays(today, -13)}`)
      .limit(5000),
  ).then(({ data: rows, error }) => {
    if (error || !rows || rows.length >= 5000) return null;
    return Array.from({ length: 14 }, (_, at) => {
      const day = addDays(today, at - 13);
      return new Set(rows.filter((row) => row.due_on < day && !(row.status === "filed" && row.filed_on && row.filed_on <= day)).map((row) => row.client_id)).size;
    });
  });
  // Papers received in the last 7 days, and on each of them (the days only when all were read).
  const papersWeek = Promise.resolve(
    supabase.from("documents").select("received_at", { count: "exact" }).eq("firm_id", firm).is("prepared", null).neq("status", "deleted").gte("received_at", new Date(`${weekStart}T00:00:00+05:30`).toISOString()).limit(2000),
  ).then(({ data: rows, count: total }) => {
    const days = rows?.map((row) => new Date(row.received_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })) ?? [];
    return {
      total: total ?? 0,
      days: rows && rows.length === total ? Array.from({ length: 7 }, (_, at) => ({ day: addDays(weekStart, at), count: days.filter((received) => received === addDays(weekStart, at)).length })) : null,
    };
  });

  // What InboxCA did by itself today (papers filed from email come from the papers themselves).
  const feed = Promise.all([
    Promise.resolve(supabase.rpc("activity_feed", { target_firm: firm, since: dayStart })),
    Promise.resolve(supabase.from("documents").select("client_id, received_at, clients(name)").eq("firm_id", firm).not("email_event_id", "is", null).eq("status", "filed").gte("received_at", dayStart).order("received_at", { ascending: false }).limit(100)),
  ]).then(([{ data: done }, { data: filedToday }]) => {
    const papersBy = new Map<string, { at: string; name: string; papers: number }>();
    for (const paper of filedToday ?? []) {
      const seenClient = papersBy.get(paper.client_id);
      papersBy.set(paper.client_id, { at: seenClient?.at ?? paper.received_at, name: paper.clients?.name ?? "", papers: (seenClient?.papers ?? 0) + 1 });
    }
    return [
      ...[...papersBy.entries()].map(([id, item]) => ({ key: `papers-${id}`, at: item.at, client: item.name, what: `${plural(item.papers, "paper", "papers")} filed from email` })),
      ...(done ?? []).map((line, at) => ({ key: `${line.at}-${at}`, at: line.at, client: line.client_name, what: activityNames[line.action] ?? "Client record changed" })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  });

  // Getting started (the owner): email, drive, clients, the work for each, the team.
  const setup = owner
    ? Promise.all([
        accounts,
        count(supabase.from("clients").select("id", { count: "exact", head: true }).eq("firm_id", firm).eq("stage", "client").is("archived_at", null)),
        count(supabase.from("client_registrations").select("id", { count: "exact", head: true }).filter("services", "neq", "{}")),
        count(supabase.from("firm_members").select("user_id", { count: "exact", head: true })),
      ]).then(([kinds, clients, services, members]) => [
        { done: kinds.some((account) => account.kind === "mail"), name: "Firm email connected", href: "/app/settings#mailbox", action: "Connect the firm's email" },
        { done: kinds.some((account) => account.kind === "drive"), name: "Drive linked", href: "/app/settings#drive", action: "Link the firm's drive" },
        { done: !!clients, name: "Clients added", href: "/app/clients", action: "Add your clients" },
        { done: !!services, name: "Work ticked", href: "/app/clients", action: "Tick what you file for each client" },
        { done: members > 1, name: "Team invited", href: "/app/people", action: "Invite your team" },
      ])
    : null;

  // Late clients nobody looks after, for Assign to me.
  const assigned = late.then(({ data: rows }) => {
    const ids = rows?.map((row) => row.client_id) ?? [];
    return ids.length ? Promise.resolve(supabase.from("client_assignments").select("client_id").in("client_id", ids)).then(({ data: looked }) => new Set(looked?.map((row) => row.client_id))) : new Set<string>();
  });

  // Phone notifications are offered to approvers once, until one device has them or they close the line.
  const pushKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const deputy = ((membership.settings.office as { deputies?: string[] } | undefined)?.deputies ?? []).includes(userId);
  const askPush =
    pushKey && (owner || deputy || membership.role === "manager")
      ? cookies().then(async (jar) => jar.get("push_line")?.value !== "hidden" && !(await supabaseAdmin().from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId)).count)
      : Promise.resolve(false);

  // The panels this page opens: Mark filed for a late client, and the preview before a send.
  const marking =
    params.panel === "filed" && params.client && /^[0-9a-f-]{36}$/.test(params.client) && !membership.viewOnlyUntil
      ? Promise.resolve(supabase.from("tasks").select("id, code, period_key, due_on, clients(name)").eq("client_id", params.client).eq("kind", "compliance").neq("status", "filed").lt("due_on", today).order("due_on").limit(100)).then(({ data: rows }) => rows)
      : Promise.resolve(null);
  const preview = sends && (params.confirm === "late" || params.confirm === "papers") ? sendPreview(supabase, firm, params.confirm) : Promise.resolve(null);

  return { today, owner, sends, membership, userId, replies, waits, papers, late, week, rules, toApprove, looks, month, lateTrend, papersWeek, feed, setup, assigned, askPush, pushKey, marking, preview, confirm: params.confirm };
}

const returnName = (rule: Map<string, { name: string | null; frequency: string | null }>, code: string | null, period: string | null) => `${rule.get(code ?? "")?.name ?? code ?? ""} for ${periodLabel(rule.get(code ?? "")?.frequency ?? null, period)}`;
const short = (date: string) => dueLabel(date).slice(0, -5);
const timeOf = (iso: string, today: string) => {
  const day = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return day === today ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : short(day);
};
// "3 h", "2 days": how long a reply has waited, roughly.
const waitFor = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < DAY ? `${Math.round(ms / 3_600_000)} h` : plural(Math.round(ms / DAY), "day", "days"));

// The greeting's line: how many things need this person today.
async function Things({ data }: { data: Data }) {
  const [replies, toApprove, late, looks] = await Promise.all([data.replies, data.toApprove, data.late, data.looks]);
  const things = (replies.count ?? 0) + toApprove.length + (late.count ?? late.data?.length ?? 0) + looks.length;
  return <span>{things ? `${plural(things, "thing needs", "things need")} you today.` : "Nothing needs you today."}</span>;
}

async function PushLine({ data }: { data: Data }) {
  if (!(await data.askPush)) return null;
  return (
    <div className="today-line">
      <span className="grow">Get questions and approvals on your phone too.</span>
      <PushSwitch publicKey={data.pushKey} />
      <form action={hidePush}>
        <Pending className="b b-ghost b-icon" aria-label="Close">
          <X size={16} aria-hidden />
        </Pending>
      </form>
    </div>
  );
}

// The month at a glance: four figures of different kinds, each opening its own list.
async function Kpis({ data }: { data: Data }) {
  const [month, late, trend, replies, waits, papersWeek] = await Promise.all([data.month, data.late, data.lateTrend, data.replies, data.waits, data.papersWeek]);
  const lateCount = late.count ?? late.data?.length ?? 0;
  const replyCount = replies.count ?? 0;
  const averageWait = waits.average;
  const most = Math.max(1, ...(papersWeek.days?.map((day) => day.count) ?? []));
  return (
    <section className="kpis" aria-label="This month">
      <Press href="/app/calendar?view=month" className="kpi kpi-ring" lift>
        <ProgressRing done={month.filed} total={month.due} label="returns due this month filed" />
        <span className="kpi-text">
          <span className="kpi-label">Returns filed this month</span>
          <span className="kpi-big">
            <Count id="filed" value={month.filed} /> <small>of {month.due.toLocaleString("en-IN")}</small>
          </span>
          <span className="kpi-sub">{month.due ? `Due by ${short(month.end)}` : "No returns fall due this month"}</span>
        </span>
      </Press>
      <Press href="/app/clients?show=late" className="kpi" lift>
        <span className="kpi-label">
          <span className={`kpi-dot${lateCount ? " late" : ""}`} aria-hidden />
          {lateCount === 1 ? "Client late" : "Clients late"}
        </span>
        <span className="kpi-big">
          <Count id="late" value={lateCount} />
        </span>
        {trend ? <Sparkline points={trend} /> : <span className="kpi-sub">Open the list</span>}
        {trend && <span className="kpi-sub">Last 14 days</span>}
      </Press>
      <Press href="/app/inbox?status=reply" className="kpi" lift>
        <span className="kpi-label">
          <span className={`kpi-dot${replyCount ? " wait" : ""}`} aria-hidden />
          {replyCount === 1 ? "Reply waiting" : "Replies waiting"}
        </span>
        <span className="kpi-big">
          <Count id="reply" value={replyCount} />
        </span>
        <span className="kpi-sub">{averageWait !== null ? `Waiting ${waitFor(averageWait)} on average` : replyCount ? "Open the Inbox" : "No client is waiting"}</span>
      </Press>
      <Press href="/app/documents" className="kpi" lift>
        <span className="kpi-label">
          <span className="kpi-dot docs" aria-hidden />
          Papers this week
        </span>
        <span className="kpi-big">
          <Count id="papers" value={papersWeek.total} />
        </span>
        {papersWeek.days && (
          <span className="kpi-bars" aria-hidden>
            {papersWeek.days.map((day, at) => (
              <span key={day.day} className={at === 6 ? "is-today" : undefined} style={{ height: `${Math.max(6, Math.round((day.count * 100) / most))}%`, animationDelay: `${120 + at * 40}ms` }} />
            ))}
          </span>
        )}
        <span className="kpi-sub">Received in the last 7 days</span>
      </Press>
    </section>
  );
}

// A line for the late count over 14 days, drawn once; its last point is today.
function Sparkline({ points }: { points: number[] }) {
  const top = Math.max(1, ...points);
  const x = (at: number) => 3 + (at * 194) / (points.length - 1);
  const y = (value: number) => 30 - (value * 26) / top;
  const line = points.map((value, at) => `${at ? "L" : "M"}${x(at).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  return (
    <svg className="kpi-spark" viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden>
      <path className="kpi-spark-fill" d={`${line} L197 34 L3 34 Z`} />
      <Draw className="kpi-spark-line" d={line} />
      <circle className="kpi-spark-end" cx={x(points.length - 1)} cy={y(points.at(-1)!)} r="2.5" />
    </svg>
  );
}

// Needs you now: what the owner must look at, clients waiting for a reply, and returns to
// approve, most urgent first, each with one action.
async function NeedsNow({ data }: { data: Data }) {
  const [looks, replies, waits, toApprove] = await Promise.all([data.looks, data.replies, data.waits, data.toApprove]);
  const replyCount = replies.count ?? 0;
  const replyRows = (replies.data ?? [])
    .map((request) => ({ request, at: waits.at.get(request.entity_id) }))
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const total = looks.length + replyCount + toApprove.length;
  return (
    <Card id="t-now" title="Needs you now" Icon={Inbox} kind="reply" count={total} countTone={looks.some((look) => look.urgent) ? "late" : "warn"} className="today-now">
      {total ? (
        <List name="now" className="app-rows">
          {looks.map((look) => (
            <Row
              key={look.key}
              lead={<IconTile Icon={TriangleAlert} kind={look.urgent ? "late" : "notice"} />}
              title={<span role="alert">{look.text}</span>}
              action={
                look.seen ? (
                  <form action={seenAlert}>
                    <input type="hidden" name="alert" value={look.seen} />
                    <button className="b b-secondary">Got it</button>
                  </form>
                ) : look.href && (
                  <Link className="b b-secondary" href={look.href}>
                    {look.action}
                  </Link>
                )
              }
            />
          ))}
          {replyRows.map(({ request, at }) => {
            const client = request.clients?.name ?? "A contact";
            return (
              <Row
                key={request.id}
                lead={<Avatar name={client} />}
                title={client}
                meta={`${replyReasons[request.reason_code ?? ""] ?? "Needs your team"}${at ? `. Emailed ${timeOf(at, data.today)}` : ""}`}
                status={<Badge tone="warn">Reply</Badge>}
                action={
                  <Link className="b b-secondary" href={at ? `/app/inbox?mail=${request.entity_id}` : request.client_id ? `/app/clients/${request.client_id}` : "/app/inbox"} aria-label={`Reply to ${client}`}>
                    Reply
                  </Link>
                }
              />
            );
          })}
          {toApprove.slice(0, 5).map((file) => (
            <Row
              key={file.id}
              lead={<Avatar name={file.clients?.name ?? ""} />}
              title={file.clients?.name}
              meta={`${formName(file.meta.form)} for ${periodName(file.period_key)}${file.meta.status !== "draft" ? ", acknowledgement arrived" : ""}`}
              status={<Badge tone="blue">Approve</Badge>}
              action={
                <Link className="b b-secondary" href={`/app/clients/${file.client_id}?tab=outputs`}>
                  {file.meta.status === "draft" ? "Review and approve" : "Confirm filing"}
                </Link>
              }
            />
          ))}
        </List>
      ) : (
        <Calm title="You are all caught up" line="No client is waiting for a reply, and nothing waits for your approval." />
      )}
      {replyCount > 5 && <SeeAll href="/app/inbox">See all {replyCount} replies in the Inbox</SeeAll>}
    </Card>
  );
}

// Late returns: one row a client, with the bulk reminder, Mark filed and Assign to me.
async function LateReturns({ data }: { data: Data }) {
  const [late, rule, assignedIds] = await Promise.all([data.late, data.rules, data.assigned]);
  const { membership } = data;
  const lateCount = late.count ?? late.data?.length ?? 0;
  const assignAs = membership.role === "manager" ? "manager" : "partner_in_charge";
  return (
    <Card
      id="t-late"
      title="Late returns"
      Icon={AlarmClock}
      kind="late"
      count={lateCount ? plural(lateCount, "client", "clients") : null}
      countTone="late"
      end={
        data.sends &&
        !!lateCount && (
          <Link className="b b-secondary" href="/app?confirm=late" scroll={false}>
            Remind all late clients
          </Link>
        )
      }
    >
      {late.data?.length ? (
        <>
          <List name="late" className="app-rows">
            {late.data.map((row) => {
              const days = Math.round((Date.parse(data.today) - Date.parse(row.due_on)) / DAY);
              return (
                <Row
                  key={row.client_id}
                  lead={<Avatar name={row.client_name} />}
                  title={row.client_name}
                  meta={`${returnName(rule, row.code, row.period_key)}${row.returns > 1 ? ` and ${row.returns - 1} more` : ""}`}
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
                          <input type="hidden" name="who" value={`person:${data.userId}`} />
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
          </List>
          {lateCount > late.data.length && <SeeAll href="/app/calendar?view=overdue">See all {lateCount} clients</SeeAll>}
        </>
      ) : late.error ? (
        <p className="app-card-none">Late returns could not load. Refresh the page.</p>
      ) : (
        <Calm title="No return is late." line="Returns that pass their due date without being marked filed show here." />
      )}
    </Card>
  );
}

// Getting started, for the owner until every step is done; then a small celebration, once.
async function GettingStarted({ data }: { data: Data }) {
  const steps = (await data.setup)!;
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) {
    if ((await cookies()).get("setup_done")?.value) return null;
    return (
      <section className="app-card today-ready" aria-labelledby="t-ready">
        <Celebrate />
        <IconTile Icon={PartyPopper} kind="done" />
        <span>
          <h2 id="t-ready">You are all set</h2>
          <span className="sub">Email, drive, clients, their work and your team are in. InboxCA takes it from here.</span>
        </span>
      </section>
    );
  }
  const next = steps.find((step) => !step.done)!;
  return (
    <section className="app-card today-setup" aria-labelledby="t-setup">
      <header className="app-card-head">
        <IconTile Icon={Rocket} kind="approve" />
        <h2 id="t-setup">Getting started</h2>
        <span className="head-end today-setup-count">
          {done} of {steps.length}
        </span>
      </header>
      <div className="today-setup-bar" role="progressbar" aria-label="Setup done" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
        <span style={{ width: `${(done * 100) / steps.length}%` }} />
      </div>
      <ol aria-label="Setup steps">
        {steps.map((step) => (
          <li key={step.action} className={step.done ? "done" : step === next ? "next" : undefined}>
            <span className="today-step-mark">{step.done && <Check size={12} strokeWidth={3} aria-label="Done" />}</span>
            {step.done ? (
              <span>{step.name}</span>
            ) : (
              <Link href={step.href} className={step === next ? "b b-primary" : undefined}>
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// The next 7 days as a strip, a count of returns still to file under each day, then the
// returns themselves.
async function ThisWeek({ data }: { data: Data }) {
  const [week, rule] = await Promise.all([data.week, data.rules]);
  const rows = week.data ?? [];
  const days = Array.from({ length: 7 }, (_, at) => {
    const day = addDays(data.today, at);
    const due = rows.filter((row) => row.due_on === day);
    return { day, left: due.reduce((sum, row) => sum + row.clients - row.filed, 0), all: due.reduce((sum, row) => sum + row.clients, 0) };
  });
  const most = Math.max(1, ...days.map((day) => day.left));
  return (
    <Card id="t-week" title="Due this week" Icon={CalendarDays} kind="week" end={<Link className="b b-ghost b-small" href="/app/calendar?view=week">Open calendar</Link>}>
      <ol className="week-strip" aria-label="Returns to file each day">
        {days.map(({ day, left, all }, at) => {
          const date = new Date(`${day}T12:00:00+05:30`);
          return (
            <li key={day} className={`${at ? "" : "is-today"}${left ? " has-due" : ""}`}>
              <span className="week-day">{at ? date.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }) : "Today"}</span>
              <strong className="week-date">{Number(day.slice(8))}</strong>
              <span className="week-bar" aria-hidden>
                <span style={{ height: `${left ? Math.max(14, (left * 100) / most) : 0}%` }} />
              </span>
              <span className="week-count">{left ? `${left} to file` : all ? "Filed" : "None"}</span>
            </li>
          );
        })}
      </ol>
      {rows.length ? (
        <List name="week" className="app-rows">
          {rows.slice(0, 4).map((row) => {
            const left = row.clients - row.filed;
            return (
              <Row
                key={`${row.due_on}-${row.code}`}
                title={rule.get(row.code)?.name ?? row.code}
                meta={`${plural(row.clients, "client", "clients")}, due ${short(row.due_on)}`}
                status={left ? <Badge tone="warn">{left} to file</Badge> : <Badge tone="done">Filed</Badge>}
              />
            );
          })}
        </List>
      ) : (
        <p className="app-card-none">Nothing is due in the next 7 days.</p>
      )}
      {rows.length > 4 && <SeeAll href="/app/calendar?view=week">See all</SeeAll>}
    </Card>
  );
}

async function Missing({ data }: { data: Data }) {
  const papers = await data.papers;
  return (
    <Card
      id="t-missing"
      title="Papers still missing"
      Icon={FileClock}
      kind="papers"
      end={
        papers.data?.length ? (
          data.sends ? (
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
        <List name="done" className="app-rows">
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
        </List>
      ) : (
        <p className="app-card-none">
          No papers are missing.{" "}
          <Link className="b b-secondary" href="/app/clients">
            Ask a client for papers
          </Link>
        </p>
      )}
    </Card>
  );
}

async function Feed({ data }: { data: Data }) {
  const feed = await data.feed;
  return (
    <Card id="t-done" title="What InboxCA did today" Icon={Sparkles} kind="docs" end={<span className="today-live">Live</span>}>
      {feed.length ? (
        <ol className="today-feed stagger">
          {feed.map((item) => (
            <li key={item.key}>
              <span className="today-feed-dot" aria-hidden />
              <span className="grow">
                {item.what} <span className="sub-inline">{item.client}</span>
              </span>
              <time className="today-time" dateTime={item.at}>
                {timeOf(item.at, data.today)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="app-card-none">Nothing yet today. Papers filed from email and reminders sent show here.</p>
      )}
    </Card>
  );
}

// The side panels Today opens: portal files, Mark filed, and the preview before a send. Each
// springs in and slides back out when closed.
async function Panels({ data, portal }: { data: Data; portal: boolean }) {
  const [marking, preview, rule] = await Promise.all([data.marking, data.preview, data.rules]);
  const close = "/app";
  return (
    <Presence>
      {portal && (
        <SidePanel key="portal" id="portal-title" title="Files from the GST portal" close={close}>
          <PortalDrop />
        </SidePanel>
      )}
      {marking && (
        <SidePanel key="filed" id="mark-filed" title={marking.length > 1 ? `Mark ${marking.length} returns filed` : "Mark filed"} close={close}>
          {marking.length ? (
            <MarkFiled state={<input type="hidden" name="from" value="today" />} rows={marking.map((task) => ({ id: task.id, name: task.clients?.name ?? "", sub: `${returnName(rule, task.code, task.period_key)}, due ${dueLabel(task.due_on)}` }))} />
          ) : (
            <p className="hint">This client has no late return now.</p>
          )}
        </SidePanel>
      )}
      {preview && (
        <SidePanel key="send" id="send-title" title={preview.title} close={close}>
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
            <input type="hidden" name="what" value={data.confirm} />
            <Pending className="b b-primary" busy="Sending" disabled={!preview.mailbox || !preview.count}>
              {preview.button}
            </Pending>
            <Link className="b b-secondary" href={close} scroll={false}>
              Cancel
            </Link>
          </form>
        </SidePanel>
      )}
    </Presence>
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
async function sendPreview(supabase: Db, firm: string, what: "late" | "papers") {
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
      <Link className="b b-ghost b-small" href={href}>
        {children}
      </Link>
    </div>
  );
}

// A calm empty state: a small drawing in tint colours and one line.
function Calm({ title, line }: { title: string; line: string }) {
  return (
    <div className="today-calm">
      <svg viewBox="0 0 64 48" aria-hidden>
        <rect x="8" y="10" width="40" height="30" rx="8" className="calm-back" />
        <rect x="16" y="6" width="40" height="30" rx="8" className="calm-front" />
        <path d="M28 21l5 5 9-10" className="calm-tick" />
        <circle cx="6" cy="8" r="2" className="calm-dot" />
        <circle cx="60" cy="42" r="2.5" className="calm-dot" />
      </svg>
      <span>
        <strong>{title}</strong>
        <span className="sub">{line}</span>
      </span>
    </div>
  );
}

// The shape of the figures and of a card while their data comes.
function KpiSkeleton() {
  return (
    <div className="kpis" aria-busy="true" aria-label="Loading the month">
      {[0, 1, 2, 3].map((tile) => <span key={tile} className="kpi kpi-skel skel" />)}
    </div>
  );
}
function CardSkeleton({ title, rows }: { title: string; rows: number }) {
  return (
    <section className="app-card" aria-busy="true" aria-label={`Loading ${title}`}>
      <header className="app-card-head">
        <span className="skel skel-tile" />
        <h2 className="skel-title">{title}</h2>
      </header>
      <div className="card-skel">
        {Array.from({ length: rows }, (_, row) => <span key={row} className="skel" />)}
      </div>
    </section>
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
            <Pending className="b b-secondary">Ask to use this device away from the office</Pending>
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
                  <Pending className="b b-primary" type="submit">
                    Join {invite.firm_name}
                  </Pending>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
