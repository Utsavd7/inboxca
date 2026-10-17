import { CalendarClock, Check, Inbox, TriangleAlert } from "lucide-react";
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

const DAY = 86_400_000;
// "today", "tomorrow", "in 3 days" or "4 days late", for a date column.
const when = (date: string, today: string) => {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY);
  return days === 0 ? "today" : days === 1 ? "tomorrow" : days > 0 ? `in ${days} days` : `${-days} day${days === -1 ? "" : "s"} late`;
};

// The signed in start page, kept plain for people who are not technical. Everyone sees
// what needs them today and what is coming up; the owner also sees the few setup steps
// left. Staff see their own work: with restricted visibility, only their clients.
export default async function AppHome() {
  const { supabase, membership } = await currentMember();
  const { data: invites } = await supabase.rpc("my_invites");
  const closed = membership ? null : (await supabase.rpc("closed_firms")).data?.[0];
  if (closed?.reason === "session") redirect("/auth/sign-out?reason=session");
  if (!membership) return <NoFirm closed={closed} invites={invites ?? []} />;

  const today = todayInIndia();
  const owner = membership.role === "owner";
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const open = () => supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "filed");
  const month = today.slice(0, 7);
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const [waiting, overdue, week, upcoming, mail, rules, setup, load] = await Promise.all([
    count(supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending")),
    count(open().lte("due_on", calendarViews.overdue.window(today).to)),
    count(open().gte("due_on", today).lte("due_on", calendarViews.week.window(today).to)),
    supabase.from("tasks").select("id, client_id, code, period_key, due_on, clients!inner(name, archived_at)").is("clients.archived_at", null).neq("status", "filed").order("due_on").limit(6),
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
  const steps = setup && [
    { done: setup[0].includes("mail"), text: "Connect the firm's email", href: "/app/settings#mailbox", action: "Connect email" },
    { done: setup[0].includes("drive"), text: "Link the firm's drive, where client files are saved", href: "/app/settings#drive", action: "Link drive" },
    { done: !!setup[1], text: "Add your clients, or import your Excel list", href: "/app/clients", action: "Add clients" },
    { done: !!setup[2], text: "Tick what you file for each client, so due dates appear", href: "/app/clients", action: "Open clients" },
    { done: setup[3] > 1, text: "Invite your team", href: "/app/people", action: "Invite" },
  ];
  const next = steps?.find((step) => !step.done);
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  // What needs a person, as plain sentences with one button each; nothing to do reads as such.
  const needs = [
    { number: waiting, one: "client email needs a reply", many: "client emails need a reply", none: "No client email needs a reply", href: "/app/inbox", action: "Open inbox", Icon: Inbox, late: false },
    { number: overdue, one: "return is overdue", many: "returns are overdue", none: "Nothing is overdue", href: "/app/calendar?view=overdue", action: "See overdue", Icon: TriangleAlert, late: true },
    { number: week, one: "return falls due in the next 7 days", many: "returns fall due in the next 7 days", none: "Nothing falls due in the next 7 days", href: "/app/calendar?view=week", action: "See the week", Icon: CalendarClock, late: false },
  ];
  const ribbon = (load.data ?? []).map((row) => ({
    date: row.due_on,
    due: row.due,
    filed: row.filed,
    names: row.codes.map((code) => rule.get(code)?.name ?? code),
  }));

  return (
    <>
      <header className="app-head">
        <h1>
          {greeting}
          <span className="app-role">{membership.firmName}</span>
        </h1>
        <span className="app-date">{new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}</span>
      </header>

      <Ribbon month={month} days={ribbon} today={today} lastDay={lastDay} />

      {next && steps && (
        <section className="app-card" aria-labelledby="start">
          <div className="app-card-head">
            <h2 id="start">Get started</h2>
            <span className="app-note">
              {steps.filter((step) => step.done).length} of {steps.length} done
            </span>
          </div>
          <div className="app-progress" aria-hidden>
            <span style={{ width: `${(steps.filter((step) => step.done).length / steps.length) * 100}%` }} />
          </div>
          <ol className="app-steps">
            {steps.map((step) => (
              <li key={step.text} className={step.done ? "is-done" : undefined}>
                {step.done ? <Check size={16} aria-label="Done" /> : <span className="app-step-dot" aria-hidden />}
                <span>{step.text}</span>
                {step === next && (
                  <Link className="btn" href={step.href}>
                    {step.action}
                  </Link>
                )}
              </li>
            ))}
          </ol>
          <p className="app-note">After this InboxCA sorts mail, files papers and keeps the due dates by itself.</p>
        </section>
      )}

      <div className="app-columns">
        <div>
        <section className="app-card" aria-labelledby="needs">
          <h2 id="needs">Needs you</h2>
          <ul className="needs">
            {needs.map(({ number, one, many, none, href, action, Icon, late }) => (
              <li key={href} className={number && late ? "is-late" : number ? "" : "is-clear"}>
                <Icon size={17} aria-hidden />
                <span>
                  {number ? (
                    <>
                      <CountUp value={number} /> {number === 1 ? one : many}
                    </>
                  ) : (
                    none
                  )}
                </span>
                {!!number && (
                  <Link className="btn btn-quiet" href={href}>
                    {action}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="app-card" aria-labelledby="mail">
          <div className="app-card-head">
            <h2 id="mail">Latest client email</h2>
            <Link className="app-link" href="/app/inbox">
              Inbox
            </Link>
          </div>
          <ul className="app-list">
            {mail.data?.map((event) => (
              <li key={event.id}>
                <span className="person">
                  {event.clients?.name ?? "A contact"}
                  <span className="app-aside">
                    {new Date(event.received_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <span className={`pill pill-${event.label ?? "other"}`}>{labels[(event.label ?? "other") as Label]}</span>
              </li>
            ))}
          </ul>
          {!mail.data?.length && <p className="app-note">No client email yet.</p>}
        </section>
        </div>
        <div>
        <section className="app-card" aria-labelledby="coming">
          <div className="app-card-head">
            <h2 id="coming">Coming up</h2>
            <Link className="app-link" href="/app/calendar">
              Calendar
            </Link>
          </div>
          <ul className="app-list">
            {upcoming.data?.map((task) => (
              <li key={task.id}>
                <span className="person">
                  <Link href={`/app/clients/${task.client_id}`}>{task.clients.name}</Link>
                  <span className="app-aside">
                    {rule.get(task.code ?? "")?.name}, {periodLabel(rule.get(task.code ?? "")?.frequency ?? null, task.period_key)}
                  </span>
                </span>
                <span className={`pill${task.due_on < today ? " pill-late" : ""}`} title={dueLabel(task.due_on)}>
                  {when(task.due_on, today)}
                </span>
              </li>
            ))}
          </ul>
          {!upcoming.data?.length && <p className="app-note">No returns due yet. Tick what you file on a client&apos;s page.</p>}
        </section>
        </div>
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
      <h1>
        {closed ? `${closed.firm_name} is closed now.` : invites.length ? "Welcome to InboxCA." : "You are not part of a firm yet."}
        <span className="app-role">
          {closed
            ? describeHours(closed.hours as Hours)
              ? `Your firm uses InboxCA during office hours: ${describeHours(closed.hours as Hours)}, India time.`
              : "Your firm has no office hours set. Ask the owner."
            : invites.length
              ? "Join your firm to start."
              : "Ask your firm's owner to invite you."}
        </span>
      </h1>
      {!!invites.length && (
        <section className="app-card" aria-labelledby="invites">
          <h2 id="invites">Invites</h2>
          <ul className="app-list">
            {invites.map((invite) => (
              <li key={invite.firm_id}>
                <span>
                  <strong>{invite.firm_name}</strong> has invited you as {roleNames[invite.role]}.
                </span>
                <form action={joinFirm}>
                  <input type="hidden" name="firm" value={invite.firm_id} />
                  <button className="btn" type="submit">
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
