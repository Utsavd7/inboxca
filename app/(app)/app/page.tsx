import { CalendarClock, CalendarDays, Check, CircleCheck, Inbox, Mail, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { joinFirm } from "@/app/(app)/actions";
import { calendarViews, dueLabel, periodLabel, todayInIndia } from "@/src/lib/calendar";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { roleNames } from "@/src/lib/roles";
import { labels, type Label } from "@/src/lib/triage";
import { CountUp } from "./count-up";
import { Ribbon } from "./ribbon";
import { Avatar, Badge, Empty, PageHead, type Tone } from "./ui";

const DAY = 86_400_000;
// "today", "tomorrow", "in 3 days" or "4 days late", for a date column.
const when = (date: string, today: string) => {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days > 0 ? `in ${days} days` : `${-days} day${days === -1 ? "" : "s"} late`;
};
const labelTone: Record<string, Tone> = { other: "warn", notice_received: "late", data_gst: "blue", data_income_tax: "blue", data_tax_audit: "blue" };

// The signed in start page, kept plain for people who are not technical: four figures for
// the day, this month's filing days, what needs a person and what comes next. The owner
// also sees the few setup steps left. With restricted visibility everyone sees only the
// clients they may see, so staff get their own work.
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
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const open = () => supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "filed");
  const [waiting, overdue, week, upcoming, mail, rules, setup, load] = await Promise.all([
    count(supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending")),
    count(open().lte("due_on", calendarViews.overdue.window(today).to)),
    count(open().gte("due_on", today).lte("due_on", calendarViews.week.window(today).to)),
    supabase.from("tasks").select("id, client_id, code, period_key, due_on, clients!inner(name, archived_at)").is("clients.archived_at", null).neq("status", "filed").order("due_on").limit(7),
    supabase.from("email_events").select("id, client_id, received_at, label, clients(name)").order("received_at", { ascending: false }).order("id").limit(5),
    supabase.from("compliance_types").select("code, name, frequency").eq("period_key", ""),
    owner
      ? Promise.all([
          supabase.from("connected_accounts").select("kind").then((result) => result.data?.map((row) => row.kind) ?? []),
          count(supabase.from("clients").select("id", { count: "exact", head: true })),
          count(supabase.from("client_registrations").select("id", { count: "exact", head: true }).filter("services", "neq", "{}")),
          count(supabase.from("firm_members").select("user_id", { count: "exact", head: true })),
        ])
      : null,
    supabase.rpc("month_load", { first_day: `${month}-01` }),
  ]);
  const rule = new Map(rules.data?.map((r) => [r.code, r]));
  const ribbon = (load.data ?? []).map((row) => ({ date: row.due_on, due: row.due, filed: row.filed, names: row.codes.map((code) => rule.get(code)?.name ?? code) }));
  const monthDue = ribbon.reduce((sum, day) => sum + day.due, 0);
  const monthFiled = ribbon.reduce((sum, day) => sum + day.filed, 0);
  const steps = setup && [
    { done: setup[0].includes("mail"), name: "Email", href: "/app/settings#mailbox", action: "Connect the firm's email" },
    { done: setup[0].includes("drive"), name: "Drive", href: "/app/settings#drive", action: "Link the firm's drive" },
    { done: !!setup[1], name: "Clients", href: "/app/clients", action: "Add your clients" },
    { done: !!setup[2], name: "Services", href: "/app/clients", action: "Tick what you file for a client" },
    { done: setup[3] > 1, name: "Team", href: "/app/people", action: "Invite your team" },
  ];
  const next = steps?.find((step) => !step.done);
  const done = steps?.filter((step) => step.done).length ?? 0;
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const needs = [
    { number: waiting, one: "client email needs a reply", many: "client emails need a reply", none: "No client email needs a reply", href: "/app/inbox", action: "Open inbox", Icon: Inbox, late: false },
    { number: overdue, one: "return is overdue", many: "returns are overdue", none: "Nothing is overdue", href: "/app/calendar?view=overdue", action: "See overdue", Icon: TriangleAlert, late: true },
    { number: week, one: "return falls due in the next 7 days", many: "returns fall due in the next 7 days", none: "Nothing falls due in the next 7 days", href: "/app/calendar?view=week", action: "See the week", Icon: CalendarClock, late: false },
  ];

  return (
    <>
      <PageHead
        title={greeting}
        sub={`${membership.firmName}, ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}`}
        actions={
          <Link className="b b-secondary" href="/app/calendar">
            <CalendarDays size={15} aria-hidden />
            Calendar
          </Link>
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

      <section className="kpis" aria-label="Today">
        <Link className="kpi" href="/app/inbox">
          <span>
            <Mail size={14} aria-hidden /> To reply
          </span>
          <strong>
            <CountUp value={waiting} />
          </strong>
          <small>client emails waiting</small>
        </Link>
        <Link className={`kpi${overdue ? " is-late" : ""}`} href="/app/calendar?view=overdue">
          <span>
            <TriangleAlert size={14} aria-hidden /> Overdue
          </span>
          <strong>
            <CountUp value={overdue} />
          </strong>
          <small>returns past their date</small>
        </Link>
        <Link className="kpi" href="/app/calendar?view=week">
          <span>
            <CalendarClock size={14} aria-hidden /> This week
          </span>
          <strong>
            <CountUp value={week} />
          </strong>
          <small>returns due in 7 days</small>
        </Link>
        <Link className="kpi" href="/app/calendar?view=filed">
          <span>
            <CircleCheck size={14} aria-hidden /> Filed this month
          </span>
          <strong>
            <CountUp value={monthFiled} />
            <small> of {monthDue}</small>
          </strong>
          <span className="meter" aria-hidden>
            <span style={{ width: `${monthDue ? (monthFiled / monthDue) * 100 : 0}%` }} />
          </span>
        </Link>
      </section>

      <section className="section" aria-labelledby="ribbon-title">
        <div className="box">
          <Ribbon month={month} days={ribbon} today={today} lastDay={lastDay} />
        </div>
      </section>

      <div className="split">
        <section className="section" aria-labelledby="needs">
          <div className="section-head">
            <h2 id="needs">Needs you</h2>
          </div>
          <ul className="box rows needs">
            {needs.map(({ number, one, many, none, href, action, Icon, late }) => (
              <li key={href} className={number && late ? "is-late" : number ? "" : "is-clear"}>
                <Icon size={16} aria-hidden />
                <span className="grow">
                  {number ? (
                    <>
                      <strong>
                        <CountUp value={number} />
                      </strong>{" "}
                      {number === 1 ? one : many}
                    </>
                  ) : (
                    none
                  )}
                </span>
                {!!number && (
                  <Link className="b b-secondary b-small" href={href}>
                    {action}
                  </Link>
                )}
              </li>
            ))}
          </ul>

          <div className="section">
            <div className="section-head">
              <h2 id="mail">Latest client email</h2>
              <Link className="b b-ghost b-small" href="/app/inbox">
                Inbox
              </Link>
            </div>
            <div className="box">
              {mail.data?.length ? (
                <ul className="rows">
                  {mail.data.map((event) => (
                    <li key={event.id}>
                      <span className="who grow">
                        <Avatar name={event.clients?.name ?? "Contact"} />
                        <span>
                          <span className="name">{event.clients?.name ?? "A contact"}</span>
                          <span className="sub">
                            {new Date(event.received_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </span>
                      </span>
                      <Badge tone={labelTone[event.label ?? "other"] ?? ""}>{labels[(event.label ?? "other") as Label]}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty Icon={Mail} title="No client email yet">
                  <span>Connect the firm&apos;s email in Settings and new client mail shows here, sorted.</span>
                </Empty>
              )}
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="coming">
          <div className="section-head">
            <h2 id="coming">Coming up</h2>
            <Link className="b b-ghost b-small" href="/app/calendar">
              All dates
            </Link>
          </div>
          <div className="box">
            {upcoming.data?.length ? (
              <ul className="rows">
                {upcoming.data.map((task) => (
                  <li key={task.id}>
                    <span className="grow">
                      <Link className="name" href={`/app/clients/${task.client_id}`}>
                        {task.clients.name}
                      </Link>
                      <span className="sub">
                        {rule.get(task.code ?? "")?.name}, {periodLabel(rule.get(task.code ?? "")?.frequency ?? null, task.period_key)}
                      </span>
                    </span>
                    <span className={`when${task.due_on < today ? " late" : ""}`} title={dueLabel(task.due_on)}>
                      {when(task.due_on, today)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty Icon={CalendarDays} title="No returns due yet">
                <span>Open a client and tick what you file for them; their due dates appear here.</span>
              </Empty>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// Someone signed in who is not in a firm yet: their invites, or the firm being closed.
function NoFirm({
  closed,
  invites,
}: {
  closed: { firm_name: string; hours: unknown } | null | undefined;
  invites: { firm_id: string; firm_name: string; role: string }[];
}) {
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
        <section className="section" aria-labelledby="invites">
          <div className="section-head">
            <h2 id="invites">Invites</h2>
          </div>
          <ul className="box rows">
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
