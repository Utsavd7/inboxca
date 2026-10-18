import { CalendarDays, Check, Inbox, Mail, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { joinFirm, manageTasks } from "@/app/(app)/actions";
import { canManageClients } from "@/src/lib/clients";
import { dueLabel, periodLabel, todayInIndia } from "@/src/lib/calendar";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { roleNames } from "@/src/lib/roles";
import { labels, type Label } from "@/src/lib/triage";
import { CountUp } from "./count-up";
import { Ribbon } from "./ribbon";
import { Avatar, Badge, PageHead, type Tone } from "./ui";

const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
// "today", "tomorrow", "in 3 days" or "4 days late", for a date column.
const when = (date: string, today: string) => {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days > 0 ? `in ${days} days` : `${-days} day${days === -1 ? "" : "s"} late`;
};
const labelTone: Record<string, Tone> = {
  other: "warn",
  notice_received: "late",
  data_gst: "blue",
  data_income_tax: "blue",
  data_tax_audit: "blue",
};
const reasons: Record<string, string> = {
  no_rule: "Could not tell what it asks",
  data_unclear: "Data for more than one kind of work",
  client_unclear: "Writes for several clients",
};

// Home is the firm's work board: this month's filings by return, the month's filing days,
// and every return that needs a hand, in four columns from late to done, each card one
// click from filed. Mail that waits for a person sits beside it. People who are not
// technical see what to do next without opening anything else.
export default async function AppHome() {
  const { supabase, membership } = await currentMember();
  const { data: invites } = await supabase.rpc("my_invites");
  const closed = membership ? null : (await supabase.rpc("closed_firms")).data?.[0];
  if (closed?.reason === "session") redirect("/auth/sign-out?reason=session");
  if (!membership) return <NoFirm closed={closed} invites={invites ?? []} />;

  const today = todayInIndia();
  const month = today.slice(0, 7);
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const owner = membership.role === "owner";
  const cards = () =>
    supabase
      .from("tasks")
      .select("id, client_id, code, period_key, due_on, status, details, clients!inner(name, archived_at)", { count: "exact" })
      .is("clients.archived_at", null)
      .order("due_on")
      .limit(4);
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const [late, week, doing, filed, waiting, mail, rules, load, byReturn, setup] = await Promise.all([
    cards().neq("status", "filed").lt("due_on", today),
    cards().eq("status", "upcoming").gte("due_on", today).lte("due_on", shift(today, 7)),
    cards().eq("status", "in_progress"),
    cards().eq("status", "filed").gte("details->>filed_on", shift(today, -7)),
    supabase.from("requests").select("id, entity_id, reason_code", { count: "exact" }).eq("kind", "team_reply").eq("status", "pending").limit(5),
    supabase.from("email_events").select("id, client_id, received_at, label, clients(name)").order("received_at", { ascending: false }).order("id").limit(6),
    supabase.from("compliance_types").select("code, name, frequency").eq("period_key", ""),
    supabase.rpc("month_load", { first_day: `${month}-01` }),
    supabase.rpc("month_by_return", { first_day: `${month}-01` }),
    owner
      ? Promise.all([
          supabase
            .from("connected_accounts")
            .select("kind")
            .then((result) => result.data?.map((row) => row.kind) ?? []),
          count(supabase.from("clients").select("id", { count: "exact", head: true })),
          count(supabase.from("client_registrations").select("id", { count: "exact", head: true }).filter("services", "neq", "{}")),
          count(supabase.from("firm_members").select("user_id", { count: "exact", head: true })),
        ])
      : null,
  ]);
  const rule = new Map(rules.data?.map((r) => [r.code, r]));
  const name = (code: string | null) => rule.get(code ?? "")?.name ?? code ?? "";
  const ribbon = (load.data ?? []).map((row) => ({
    date: row.due_on,
    due: row.due,
    filed: row.filed,
    names: row.codes.map((code) => name(code)),
  }));
  const monthDue = (byReturn.data ?? []).reduce((sum, row) => sum + row.due, 0);
  const monthFiled = (byReturn.data ?? []).reduce((sum, row) => sum + row.filed, 0);
  const mailById = new Map(mail.data?.map((event) => [event.id, event]));
  const steps = setup && [
    {
      done: setup[0].includes("mail"),
      name: "Email",
      href: "/app/settings#mailbox",
      action: "Connect the firm's email",
    },
    {
      done: setup[0].includes("drive"),
      name: "Drive",
      href: "/app/settings#drive",
      action: "Link the firm's drive",
    },
    {
      done: !!setup[1],
      name: "Clients",
      href: "/app/clients",
      action: "Add your clients",
    },
    {
      done: !!setup[2],
      name: "Services",
      href: "/app/clients",
      action: "Tick what you file for a client",
    },
    {
      done: setup[3] > 1,
      name: "Team",
      href: "/app/people",
      action: "Invite your team",
    },
  ];
  const next = steps?.find((step) => !step.done);
  const done = steps?.filter((step) => step.done).length ?? 0;
  const hour = Number(
    new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
    }),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const columns = [
    {
      key: "late",
      title: "Overdue",
      result: late,
      href: "/app/calendar?view=overdue",
      empty: "Nothing is late.",
    },
    {
      key: "week",
      title: "Due this week",
      result: week,
      href: "/app/calendar?view=week",
      empty: "Nothing due in 7 days.",
    },
    {
      key: "doing",
      title: "In progress",
      result: doing,
      href: "/app/calendar?view=month",
      empty: "Mark a return in progress to see it here.",
    },
    {
      key: "filed",
      title: "Filed this week",
      result: filed,
      href: "/app/calendar?view=filed",
      empty: "Filed returns land here.",
    },
  ];
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleString("en-IN", {
    month: "long",
  });

  return (
    <>
      <PageHead
        title={greeting}
        sub={`${membership.firmName}, ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}`}
        actions={
          <>
            <Link className="b b-secondary" href="/app/calendar">
              <CalendarDays size={15} aria-hidden />
              Calendar
            </Link>
            {canManageClients(membership.role) && (
              <Link className="b b-primary" href="/app/clients?panel=add">
                <Plus size={15} aria-hidden />
                New client
              </Link>
            )}
          </>
        }
      />

      {next && steps && (
        <div className="setup" role="region" aria-labelledby="setup-title">
          <span className="setup-ring" style={{ "--p": (done / steps.length) * 100 } as React.CSSProperties}>
            <span>
              {done}/{steps.length}
            </span>
          </span>
          <p>
            <strong id="setup-title">Finish setting up</strong>
            <span className="hint">After this InboxCA sorts mail, files papers and keeps the due dates by itself.</span>
          </p>
          <ol className="setup-steps" aria-label="Setup steps">
            {steps.map((step) => (
              <li key={step.name} className={step.done ? "done" : undefined}>
                {step.done && <Check size={13} aria-label="Done" />}
                {step.name}
              </li>
            ))}
          </ol>
          <Link className="b b-primary" href={next.href}>
            {next.action}
          </Link>
        </div>
      )}

      <section className="month" aria-label="This month">
        <div className="progress">
          <div className="progress-total">
            <h2>Filed in {monthName}</h2>
            <p>
              <strong>
                <CountUp value={monthFiled} />
              </strong>{" "}
              of {monthDue} filed
            </p>
            <span className="meter" aria-hidden>
              <span
                style={{
                  width: `${monthDue ? (monthFiled / monthDue) * 100 : 0}%`,
                }}
              />
            </span>
          </div>
          <ul className="progress-list" aria-label="By return">
            {(byReturn.data ?? []).slice(0, 6).map((row) => (
              <li key={row.code}>
                <Link href={`/app/calendar?view=month&code=${row.code}`}>
                  <span>{name(row.code)}</span>
                  <span className="meter" aria-hidden>
                    <span style={{ width: `${(row.filed / row.due) * 100}%` }} />
                  </span>
                  <span className="hint">
                    {row.filed}/{row.due}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <Ribbon month={month} days={ribbon} today={today} lastDay={lastDay} />
      </section>

      <section className="panel" aria-labelledby="board">
        <div className="panel-head">
          <h2 id="board">Returns to work on</h2>
          <Link className="b b-ghost b-small" href="/app/calendar">
            All returns
          </Link>
        </div>
        <div className="board">
          {columns.map(({ key, title, result, href, empty }) => (
            <div key={key} className={`lane lane-${key}`}>
              <Link className="lane-head" href={href}>
                <span>{title}</span>
                <strong>{result.count ?? 0}</strong>
              </Link>
              <ul>
                {result.data?.map((task) => (
                  <li key={task.id} className="card">
                    <Link className="card-link" href={`/app/clients/${task.client_id}`}>
                      <span className="who">
                        <Avatar name={task.clients.name} />
                        <strong>{task.clients.name}</strong>
                      </span>
                      <span className="card-what">
                        {name(task.code)}, {periodLabel(rule.get(task.code ?? "")?.frequency ?? null, task.period_key)}
                      </span>
                    </Link>
                    <span className="card-foot">
                      {task.status === "filed" ? (
                        <Badge tone="done">{(task.details as { ack?: string }).ack ? "Filed, ack saved" : "Filed"}</Badge>
                      ) : (
                        <span className={`when${task.due_on < today ? " late" : ""}`} title={dueLabel(task.due_on)}>
                          {when(task.due_on, today)}
                        </span>
                      )}
                      {task.status !== "filed" && (
                        <form action={manageTasks}>
                          <input type="hidden" name="task" value={task.id} />
                          <button className="b b-ghost b-small" name="intent" value="filed" aria-label={`Mark ${task.clients.name} ${name(task.code)} filed`}>
                            <Check size={14} aria-hidden />
                            Filed
                          </button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
                {!result.data?.length && <li className="lane-empty">{empty}</li>}
                {(result.count ?? 0) > (result.data?.length ?? 0) && (
                  <li>
                    <Link className="lane-more" href={href}>
                      {(result.count ?? 0) - (result.data?.length ?? 0)} more
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="needs">
          <div className="panel-head">
            <h2 id="needs">Needs a reply</h2>
            <Link className="b b-ghost b-small" href="/app/inbox">
              Inbox
            </Link>
          </div>
          <ul className="rows needs">
            {waiting.data?.map((request) => {
              const event = mailById.get(request.entity_id);
              const client = event?.clients?.name ?? "A contact";
              return (
                <li key={request.id}>
                  <Avatar name={client} />
                  <span className="grow">
                    <span className="name">{client}</span>
                    <span className="sub">{reasons[request.reason_code ?? ""] ?? "Needs your team"}</span>
                  </span>
                </li>
              );
            })}
            {!waiting.data?.length && (
              <li className="is-clear">
                <Inbox size={16} aria-hidden />
                <span className="grow">No email waits for a reply.</span>
              </li>
            )}
          </ul>
        </section>

        <section className="panel" aria-labelledby="mail">
          <div className="panel-head">
            <h2 id="mail">Latest client email</h2>
          </div>
          <ul className="rows">
            {mail.data?.map((event) => (
              <li key={event.id}>
                <Avatar name={event.clients?.name ?? "Contact"} />
                <span className="grow">
                  <span className="name">{event.clients?.name ?? "A contact"}</span>
                  <span className="sub">
                    {new Date(event.received_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
                <Badge tone={labelTone[event.label ?? "other"] ?? ""}>{labels[(event.label ?? "other") as Label]}</Badge>
              </li>
            ))}
            {!mail.data?.length && (
              <li className="is-clear">
                <Mail size={16} aria-hidden />
                <span className="grow">Client mail shows here once the firm&apos;s email is connected.</span>
              </li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}

// Someone signed in who is not in a firm yet: their invites, or the firm being closed.
function NoFirm({ closed, invites }: { closed: { firm_name: string; hours: unknown } | null | undefined; invites: { firm_id: string; firm_name: string; role: string }[] }) {
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
