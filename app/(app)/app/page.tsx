import { Check, X } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { askAwayDevice, joinFirm } from "@/app/(app)/actions";
import { PcKey } from "./pc-key";
import { PushSwitch } from "./push-switch";
import { supabaseAdmin } from "@/src/lib/supabase";
import { canManageClients } from "@/src/lib/clients";
import { dueLabel, periodLabel, todayInIndia } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { periodName } from "@/src/lib/documents";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { formName, preparedSchema } from "@/src/lib/prepared";
import { roleNames } from "@/src/lib/roles";
import { OfficePanel } from "./office-panel";
import { DroppedNotice, PortalDrop } from "./portal-drop";
import { mayDecide } from "@/src/lib/rights";
import { Badge, PageHead } from "./ui";
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
    drive_missing: `${details.files} ${details.files === 1 ? "file" : "files"} InboxCA filed ${details.files === 1 ? "is" : "are"} no longer in your drive. Each is marked Missing on its client's Files tab.`,
  })[reason] ?? "Something in your drive needs a look.";
const reasons: Record<string, string> = {
  no_rule: "Could not tell what it asks",
  data_unclear: "Data for more than one kind of work",
  client_unclear: "Writes for several clients",
};

// The phone notifications line stays hidden once the person closes it.
async function hidePush() {
  "use server";
  (await cookies()).set("push_line", "hidden", { path: "/app", maxAge: 31_536_000, httpOnly: true, sameSite: "lax" });
}

// Today: what needs this person, in two columns of cards. Mail waiting for a reply, returns
// to approve and papers still missing on the left; late returns, one row a client, and what
// falls due this week on the right. Each row has one button. Everything is limited to what
// this person's role and the database's row rules let them see.
export default async function AppHome({ searchParams }: { searchParams: Promise<{ dropped?: string; error?: string; asked?: string; panel?: string }> }) {
  const { dropped, error, asked, panel } = await searchParams;
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
  const [replies, papers, forms, confirming, late, week, rules, setup, alerts, noticeAlerts, asks, me, mailboxNotice] = await Promise.all([
    supabase.from("requests").select("id, entity_id, client_id, reason_code, clients(name)", { count: "exact" }).eq("kind", "team_reply").eq("status", "pending").limit(5),
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
    supabase.from("requests").select("details").eq("kind", "permission").eq("status", "pending").gt("expires_at", new Date().toISOString()).limit(200),
    supabase.from("firm_members").select("role, team_id").eq("firm_id", membership.firmId).eq("user_id", userId).single(),
    owner ? supabase.from("connected_accounts").select("status").eq("firm_id", membership.firmId).eq("kind", "mail").maybeSingle() : null,
  ]);
  // The emails behind the replies, for the time and a link straight to the mail.
  const replyIds = replies.data?.map((request) => request.entity_id) ?? [];
  const { data: events } = replyIds.length ? await supabase.from("email_events").select("id, received_at").in("id", replyIds) : { data: [] };
  const eventById = new Map(events?.map((event) => [event.id, event]));
  // Questions this person may answer (5.17.2), counted for one line on Today.
  const deputy = ((membership.settings.office as { deputies?: string[] } | undefined)?.deputies ?? []).includes(userId);
  const questions = (asks.data ?? []).filter((request) => me.data && mayDecide({ id: userId, role: me.data.role, team_id: me.data.team_id, deputy }, request.details as { by: string; route: "owner" | "manager"; team_id: string | null })).length;
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
      .filter((alert) => !alert.reason_code?.startsWith("office_") && (!["captures", "parallel", "renames"].includes(alert.reason_code ?? "") || (alert.details as { day?: string }).day === today))
      .map((alert) => ({ key: alert.id, text: alertText(alert.reason_code ?? "", alert.details as { free_bytes?: number; files?: number; client?: string; email?: string; count?: number }) })),
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

  return (
    <div className="today">
      <PageHead
        title={greeting}
        sub={`${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}. ${things ? `${plural(things, "thing needs", "things need")} you today.` : "Nothing needs you today."}`}
        actions={
          <>
            {portal && (
              <Link className="b b-secondary" href="/app?panel=upload" scroll={false}>
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
        <section className="today-setup" aria-labelledby="setup-title">
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
      {asked === "time" && (
        <p className="notice" role="status">
          The owner is asked for more time today. You can keep working until closing.
        </p>
      )}
      <DroppedNotice value={dropped} />
      {error === "view_only" && (
        <p className="alert" role="alert">
          This device can only view. Make changes from the office.
        </p>
      )}
      {error === "drive" && (
        <p className="alert" role="alert">
          Connect the firm&apos;s drive in Settings first; portal files are saved there.
        </p>
      )}
      <OfficePanel compact />

      <div className="today-grid">
        <div className="today-col">
          {!!looks.length && (
            <section className="today-card" aria-labelledby="t-look">
              <div className="today-head">
                <h2 id="t-look">Needs a look</h2>
                <Badge tone="late">{looks.length}</Badge>
              </div>
              <ul>
                {looks.map((look) => (
                  <li key={look.key}>
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
            </section>
          )}

          <section className="today-card" aria-labelledby="t-reply">
            <div className="today-head">
              <h2 id="t-reply">Clients waiting for a reply</h2>
              {!!replies.count && <Badge tone="warn">{replies.count}</Badge>}
            </div>
            {replies.data?.length ? (
              <ul>
                {replies.data.map((request) => {
                  const event = eventById.get(request.entity_id);
                  const client = request.clients?.name ?? "A contact";
                  return (
                    <li key={request.id}>
                      <span className="grow">
                        <strong>{client}</strong>
                        <span className="sub">{reasons[request.reason_code ?? ""] ?? "Needs your team"}</span>
                      </span>
                      {event && <span className="today-time">{at(event.received_at)}</span>}
                      <Link className="b b-secondary" href={event ? `/app/inbox?mail=${event.id}` : request.client_id ? `/app/clients/${request.client_id}` : "/app/inbox"} aria-label={`Reply to ${client}`}>
                        Reply
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="today-empty">No client is waiting for a reply.</p>
            )}
            {(replies.count ?? 0) > 5 && <SeeAll href="/app/inbox">See all {replies.count}</SeeAll>}
          </section>

          {(approver || !!toApprove.length) && (
            <section className="today-card" aria-labelledby="t-approve">
              <div className="today-head">
                <h2 id="t-approve">Returns ready for your approval</h2>
                {!!toApprove.length && <Badge tone="blue">{toApprove.length}</Badge>}
              </div>
              {toApprove.length ? (
                <ul>
                  {toApprove.slice(0, 5).map((file) => (
                    <li key={file.id}>
                      <span className="grow">
                        <strong>{file.clients?.name}</strong>
                        <span className="sub">
                          {formName(file.meta.form)} for {periodName(file.period_key)}
                          {file.meta.status !== "draft" && ", acknowledgement arrived"}
                        </span>
                      </span>
                      <Link className="b b-secondary" href={`/app/clients/${file.client_id}?tab=outputs`}>
                        {file.meta.status === "draft" ? "Review and approve" : "Confirm filing"}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="today-empty">Nothing waits for your approval.</p>
              )}
            </section>
          )}

          <section className="today-card" aria-labelledby="t-missing">
            <div className="today-head">
              <h2 id="t-missing">Papers still missing</h2>
              {!!papers.data?.length && <span className="today-time">InboxCA is reminding them</span>}
            </div>
            {papers.data?.length ? (
              <ul>
                {papers.data.map((request) => {
                  const details = request.details as unknown as DocumentRequest;
                  const missing = details.items.filter((item) => !item.received.length).map((item) => item.type);
                  const reminded = details.followups?.at(-1);
                  return (
                    <li key={request.id}>
                      <span className="grow">
                        <strong>{request.clients?.name}</strong>
                        <span className="sub">
                          {(missing.length ? missing : details.items.map((item) => item.type)).join(", ")}
                          {details.period && ` for ${periodName(details.period)}`}
                        </span>
                      </span>
                      <span className="today-time">{reminded ? `Reminded ${short(reminded)}` : "Not reminded yet"}</span>
                      {request.client_id && (
                        <Link className="b b-secondary" href={`/app/clients/${request.client_id}`}>
                          Open client
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="today-empty">
                No papers are missing.{" "}
                <Link className="b b-secondary" href="/app/clients">
                  Ask a client for papers
                </Link>
              </p>
            )}
          </section>
        </div>

        <div className="today-col">
          <section className="today-card" aria-labelledby="t-late">
            <div className="today-head">
              <h2 id="t-late">Late returns</h2>
              {!!lateCount && <Badge tone="late">{plural(lateCount, "client", "clients")}</Badge>}
            </div>
            {late.data?.length ? (
              <>
                <ul>
                  {late.data.map((row) => {
                    const days = Math.round((Date.parse(today) - Date.parse(row.due_on)) / DAY);
                    return (
                      <li key={row.client_id}>
                        <span className="grow">
                          <strong>{row.client_name}</strong>
                          <span className="sub">
                            {returnName(row.code, row.period_key)}
                            {row.returns > 1 && ` and ${row.returns - 1} more`}
                          </span>
                        </span>
                        <Badge tone="late">{plural(days, "day", "days")}</Badge>
                        <Link className="b b-secondary" href={`/app/clients/${row.client_id}?tab=due`} aria-label={`See returns for ${row.client_name}`}>
                          See returns
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {lateCount > late.data.length && <SeeAll href="/app/calendar?view=overdue">See all {lateCount} clients</SeeAll>}
              </>
            ) : (
              <p className="today-empty">No return is late.</p>
            )}
          </section>

          <section className="today-card" aria-labelledby="t-week">
            <div className="today-head">
              <h2 id="t-week">Due in the next 7 days</h2>
            </div>
            {week.data?.length ? (
              <ul>
                {week.data.slice(0, 5).map((row) => {
                  const [day, month] = dueLabel(row.due_on).split(" ");
                  const left = row.clients - row.filed;
                  return (
                    <li key={`${row.due_on}-${row.code}`}>
                      <span className="today-date" aria-label={dueLabel(row.due_on)}>
                        <span>{month}</span>
                        <strong>{day}</strong>
                      </span>
                      <span className="grow">
                        <strong>{rule.get(row.code)?.name ?? row.code}</strong>
                        <span className="sub">{plural(row.clients, "client", "clients")}</span>
                      </span>
                      {left ? <Badge>{left} to file</Badge> : <Badge tone="done">Filed</Badge>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="today-empty">
                Nothing is due in the next 7 days.{" "}
                <Link className="b b-secondary" href="/app/calendar">
                  Open calendar
                </Link>
              </p>
            )}
            {(week.data?.length ?? 0) > 5 && <SeeAll href="/app/calendar?view=week">See all</SeeAll>}
          </section>
        </div>
      </div>

      {portal && panel === "upload" && (
        <aside className="today-panel panel-in" aria-labelledby="upload-title">
          <div className="today-head">
            <h2 id="upload-title">Upload papers</h2>
            <Link className="b b-ghost b-icon" href="/app" scroll={false} aria-label="Close">
              <X size={16} aria-hidden />
            </Link>
          </div>
          <PortalDrop />
        </aside>
      )}
    </div>
  );
}

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div className="today-foot">
      <Link className="b b-secondary" href={href}>
        {children}
      </Link>
    </div>
  );
}

// Someone signed in who is not in a firm yet: their invites, or the firm being closed.
function NoFirm({ closed, invites, deviceStatus, connectionWaiting, pcKey }: { closed: { firm_name: string; hours: unknown; reason: string } | null | undefined; invites: { firm_id: string; firm_name: string; role: string }[]; deviceStatus: "waiting" | "refused" | null; connectionWaiting: boolean; pcKey: "needed" | "ready" | null }) {
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
        <form action={askAwayDevice} className="form-row">
          <button className="b b-secondary">Ask to use this device away from the office</button>
          <span className="hint">The owner may allow it for some days, to view only.</span>
        </form>
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
