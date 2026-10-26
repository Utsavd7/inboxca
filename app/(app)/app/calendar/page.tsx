import "./calendar.css";
import { BellRing, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { manageTasks, markTasksInProgress, remindClient, reopenTasks, stopSend } from "@/app/(app)/actions";
import { addDays, calendarViews, dueLabel, periodLabel, todayInIndia, type CalendarView } from "@/src/lib/calendar";
import type { DocumentRequest } from "@/src/lib/checklists";
import { canManageClients } from "@/src/lib/clients";
import { periodName } from "@/src/lib/documents";
import { MAX_FOLLOW_UPS } from "@/src/lib/reminders";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";
import { AutoSelect } from "../auto-select";
import { LinkTabs } from "../link-tabs";
import { MarkFiled } from "../mark-filed";
import { Item, List, Presence } from "../motion";
import { Pending } from "../pending";
import { Avatar, Badge, Empty, IconTile, PageHead, Row, SidePanel, Toast, type Tone } from "../ui";
import { RowKeys } from "../row-keys";

const columns = "id, client_id, code, period_key, due_on, status, details, clients!inner(name, archived_at)";
const uuid = /^[0-9a-f-]{36}$/;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const saved: Record<string, string> = { filed: "marked filed", in_progress: "marked in progress", reopen: "marked not filed" };
const problems: Record<string, string> = {
  filing: "Your firm has not allowed you to record filing for all the chosen work.",
  send: "The reminder could not start. Try again.",
  started: "The reminder had already gone, so it could not be stopped.",
};
// A month as YYYY-MM, moved on or back.
const shiftMonth = (month: string, by: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);

// The firm's compliance calendar: overdue, coming up and recently filed returns, as a list or
// a month. Anyone in the firm marks a return in progress or filed, one at a time or many
// together (5.17.2); those who manage clients remind a client of returns due this week.
export default async function Calendar({ searchParams }: { searchParams: Promise<{ view?: string; code?: string; day?: string; page?: string; month?: string; error?: string; task?: string | string[]; saved?: string; t?: string; remind?: string; reminding?: string; job?: string; stopped?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  const today = todayInIndia();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 100;
  const from = (page - 1) * pageSize;
  // One day, from the strip or the month: everything due that day, filed or not.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day! : null;
  // The month grid, when asked for: YYYY-MM.
  const month = /^20\d\d-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : null;
  const code = params.code ?? "";
  const viewOnly = !!membership.viewOnlyUntil;
  const reminds = !viewOnly && canManageClients(membership.role);

  // The returns a view shows, for the list and for each pill's true count.
  const returns = (shown: CalendarView | null, select: typeof columns, head = false) => {
    let query = supabase.from("tasks").select(select, { count: "exact", head }).eq("firm_id", membership.firmId).eq("kind", "compliance").is("clients.archived_at", null);
    const window: { from?: string; to?: string; filedSince?: string } = shown ? calendarViews[shown].window(today) : {};
    if (!shown) query = query.eq("due_on", day!);
    else if (window.filedSince) query = query.eq("status", "filed").gte("details->>filed_on", window.filedSince);
    else query = query.neq("status", "filed").lte("due_on", window.to!);
    if (window.from) query = query.gte("due_on", window.from);
    return code ? query.eq("code", code) : query;
  };
  const counted = "id, clients!inner(archived_at)" as typeof columns;
  const pageOf = (shown: CalendarView | null) => Promise.resolve(returns(shown, columns).order("due_on").order("id").range(from, from + pageSize - 1));
  const picked = [params.task ?? []].flat().filter((id) => uuid.test(id)).slice(0, 100);
  const remindId = reminds && uuid.test(params.remind ?? "") ? params.remind! : "";
  const views = Object.keys(calendarViews) as CalendarView[];
  // Everything that does not hang on the view starts at once: the rules, the panels, the counts.
  const rest = Promise.all([
    supabase.from("compliance_types").select("code, name, frequency, verified_on").eq("period_key", "").order("name"),
    picked.length ? supabase.from("tasks").select("id, code, period_key, due_on, clients(name)").eq("firm_id", membership.firmId).eq("kind", "compliance").neq("status", "filed").in("id", picked).order("due_on") : Promise.resolve({ data: null }),
    // Remind client: the client, its returns due within 7 days, and whether the email can go.
    remindId ? supabase.from("clients").select("id, name, email_enc, reminders_paused").eq("firm_id", membership.firmId).eq("id", remindId).is("archived_at", null).maybeSingle() : Promise.resolve({ data: null }),
    remindId ? supabase.from("tasks").select("id, code, period_key, due_on").eq("firm_id", membership.firmId).eq("kind", "compliance").eq("client_id", remindId).neq("status", "filed").gte("due_on", addDays(today, -366)).lte("due_on", addDays(today, 7)).order("due_on") : Promise.resolve({ data: null }),
    remindId ? supabase.from("connected_accounts").select("status").eq("firm_id", membership.firmId).eq("kind", "mail").maybeSingle() : Promise.resolve({ data: null }),
    remindId ? supabaseAdmin().from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", membership.firmId).eq("entity_id", remindId).eq("action", "reminder.sent").gte("at", `${today}T00:00:00+05:30`) : Promise.resolve({ count: 0 }),
    Promise.all(views.map((shown) => returns(shown, counted, true))),
  ]);
  // With no view asked for, it opens on the late returns when there are any: their page is read
  // straight away, and the next 30 days only when nothing is late.
  const asked = params.view && params.view in calendarViews ? (params.view as CalendarView) : null;
  const late = !asked && !day ? pageOf("overdue") : null;
  const view: CalendarView = asked ?? (late && (await late).count ? "overdue" : "month");
  const href = (next: { view?: CalendarView; day?: string; page?: number; task?: string; month?: string | null; remind?: string } = {}) => {
    const search = new URLSearchParams();
    const on = next.view ? null : (next.day ?? day);
    const shownMonth = next.month === undefined ? month : next.month;
    if (on) search.set("day", on);
    else search.set("view", next.view ?? view);
    if (code) search.set("code", code);
    if (shownMonth) search.set("month", shownMonth);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    if (next.task) search.set("task", next.task);
    if (next.remind) search.set("remind", next.remind);
    return `/app/calendar?${search}`;
  };
  // The strip of days ahead, with how many returns are still to file on each; or the month's
  // weeks, Monday first, with a dot for each kind of return on each day.
  const strip = month ? null : day || view === "week" || view === "month" ? Array.from({ length: (view === "week" && !day ? 7 : 30) + 1 }, (_, at) => addDays(today, at)) : null;
  const lead = month ? (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const cells = month ? Array.from({ length: Math.ceil((lead + new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()) / 7) * 7 }, (_, at) => addDays(`${month}-01`, at - lead)) : null;
  const span = strip ?? cells;
  const [{ data: tasks, count: total }, { data: perDay }, [{ data: rules }, { data: marking }, { data: reminding }, { data: remindTasks }, { data: mailbox }, { count: remindedToday }, counts]] = await Promise.all([
    late && view === "overdue" ? late : pageOf(day ? null : view),
    span ? supabase.rpc("calendar_days", { target_firm: membership.firmId, first_day: span[0], last_day: span.at(-1)!, only_code: code || undefined }) : Promise.resolve({ data: null }),
    rest,
  ]);
  if (total && from >= total) redirect(href({ page: Math.ceil(total / pageSize) }));
  const rule = new Map(rules?.map((r) => [r.code, r]));
  const name = (task: { code: string | null; period_key: string | null }) => [rule.get(task.code ?? "")?.name ?? task.code, periodLabel(rule.get(task.code ?? "")?.frequency ?? null, task.period_key)] as const;
  const onDay = new Map(perDay?.map((row) => [row.due_on, row]));
  const most = Math.max(1, ...[...onDay.values()].map((row) => row.returns));

  // Remind client: anything that stops the email. It names the returns late or due within 7
  // days and the papers still missing (src/jobs/reminders.ts).
  const soon = (due: string) => due >= addDays(today, -366) && due <= addDays(today, 7);
  const remindable = remindTasks?.filter((task) => rule.get(task.code ?? "")?.verified_on) ?? [];
  const { data: asking } = remindId ? await supabase.from("requests").select("id, details").eq("kind", "documents").eq("client_id", remindId).eq("status", "pending").gt("expires_at", new Date().toISOString()) : { data: null };
  const stillMissing = (asking ?? []).flatMap((request) => {
    const details = request.details as unknown as DocumentRequest;
    const missing = details.items.filter((item) => !item.received.length).map((item) => item.type);
    return missing.length && (details.followups?.length ?? 0) < MAX_FOLLOW_UPS ? [{ id: request.id, what: `${missing.join(", ")}${details.period ? ` for ${periodName(details.period)}` : ""}` }] : [];
  });
  const stops = reminding && [
    mailbox?.status !== "connected" && "Connect the firm's email in Settings first. Reminders go from the firm's own address.",
    !reminding.email_enc && "This client has no email address. Add one on the client's page.",
    reminding.reminders_paused && "Reminders are paused for this client. Resume them on the client's page.",
    !!remindedToday && "This client was already reminded today. Each client gets at most one reminder a day.",
  ].filter((stop): stop is string => !!stop);

  const status = (task: { status: string; due_on: string }): [Tone, string] =>
    task.status === "filed" ? ["done", "Filed"] : task.due_on < today ? ["late", "Late"] : task.status === "in_progress" ? ["blue", "In progress"] : ["warn", "Upcoming"];
  const filedView = !day && view === "filed";
  const period = day ? `Due on ${dueLabel(day)}` : view === "overdue" ? "Due before today" : filedView ? `Filed since ${dueLabel(addDays(today, -30))}` : `${dueLabel(today)} to ${dueLabel(addDays(today, view === "week" ? 7 : 30))}`;
  const shownFrom = total ? from + 1 : 0;
  const shownTo = Math.min(from + (tasks?.length ?? 0), total ?? 0);
  const done = params.t?.split(".").filter((id) => uuid.test(id)) ?? [];
  // The view, kept by every form so each action comes back to it.
  const state = (
    <>
      <input type="hidden" name="view" value={view} />
      {day && <input type="hidden" name="day" value={day} />}
      {code && <input type="hidden" name="code" value={code} />}
      {page > 1 && <input type="hidden" name="page" value={page} />}
      {month && <input type="hidden" name="month" value={month} />}
    </>
  );
  const close = href({ page });
  // Beside the month the list is narrower: the period goes under the return, and a chosen
  // day's returns need no due date.
  const compact = !!month;
  // Ticks clear once any return shown changes, as after marking the chosen ones.
  const ticks = tasks?.map((task) => task.id + task.status).join();
  const thisMonth = today.slice(0, 7);

  const list = (
    <section className="split cal-list" aria-label="Returns">
      <div className="cal-tools">
        <span className="hint">{tasks?.some((task) => !rule.get(task.code ?? "")?.verified_on) ? "Dates marked * are not yet confirmed by a CA against the official notification." : "Tick returns to mark many at once."}</span>
        <Form action="/app/calendar">
          <input type="hidden" name="view" value={view} />
          {day && <input type="hidden" name="day" value={day} />}
          {month && <input type="hidden" name="month" value={month} />}
          <AutoSelect save="code" name="code" defaultValue={code} aria-label="Return">
            <option value="">All returns</option>
            {rules?.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </AutoSelect>
          <noscript>
            <button className="b b-secondary">Show</button>
          </noscript>
        </Form>
      </div>
      {tasks?.length ? (
        <div key={close} className={`pane cal-table${compact ? " pane-in" : ""}`}>
          <table className="t">
            <thead>
              <tr>
                {!viewOnly && (
                  <th scope="col" className="shrink">
                    <span className="sr-only">Choose</span>
                  </th>
                )}
                <th scope="col">Client</th>
                <th scope="col">Return</th>
                {!compact && <th scope="col">Period</th>}
                {!(compact && day) && <th scope="col">Due</th>}
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <List as="tbody">
              {tasks.map((task) => {
                const [form, of] = name(task);
                const ack = (task.details as { ack?: string }).ack;
                const [tone, word] = status(task);
                return (
                  <Item as="tr" key={task.id}>
                    {!viewOnly && (
                      <td className="shrink">
                        <input key={ticks} className="pick" type="checkbox" form="cal-pick" name="task" value={task.id} aria-label={`Choose ${task.clients.name} ${form}`} />
                      </td>
                    )}
                    <td>
                      <span className="who">
                        <Avatar name={task.clients.name} />
                        <Link className="row-link" href={`/app/clients/${task.client_id}`}>
                          {task.clients.name}
                        </Link>
                      </span>
                    </td>
                    <td>
                      {form}
                      {compact && <span className="sub">{of}</span>}
                    </td>
                    {!compact && <td>{of}</td>}
                    {!(compact && day) && (
                      <td>
                        {dueLabel(task.due_on)}
                        {!rule.get(task.code ?? "")?.verified_on && "*"}
                      </td>
                    )}
                    <td>
                      <span className="cal-status">
                        <Badge tone={tone}>{word}</Badge>
                        {ack && <span className="num">{ack}</span>}
                      </span>
                    </td>
                    <td className="cal-act">
                      {reminds && task.status !== "filed" && soon(task.due_on) && (
                        <Link className={`b b-ghost${compact ? " b-icon" : ""}`} href={href({ page, remind: task.client_id })} scroll={false} aria-label={`Remind ${task.clients.name}`} title="Remind client">
                          <BellRing size={14} aria-hidden />
                          {!compact && "Remind client"}
                        </Link>
                      )}
                      {viewOnly ? null : task.status !== "filed" ? (
                        membership.may("mark_filed", task.client_id) && (
                          <Link className="b b-secondary" href={href({ page, task: task.id })} scroll={false} aria-label={`Mark ${task.clients.name} ${form} filed`}>
                            Mark filed
                          </Link>
                        )
                      ) : (
                        <form action={manageTasks}>
                          {state}
                          <input type="hidden" name="task" value={task.id} />
                          <Pending className="b b-secondary" name="intent" value="reopen" aria-label={`Mark ${task.clients.name} ${form} not filed`}>
                            Mark not filed
                          </Pending>
                        </form>
                      )}
                    </td>
                  </Item>
                );
              })}
            </List>
          </table>
          <RowKeys />
        </div>
      ) : (
        <Empty Icon={CalendarDays} kind={view === "overdue" && !day ? "done" : "week"} title={day ? `Nothing due on ${dueLabel(day)}` : view === "overdue" ? "Nothing is late" : "No returns here"}>
          <span>{day ? "Choose another day, or a view above." : view === "overdue" ? "Every return that was due has been filed." : "Choose the services you file on a client's page, and their due dates appear here."}</span>
          {code ? (
            <Link className="b b-secondary" href={day ? `/app/calendar?day=${day}` : `/app/calendar?view=${view}`}>
              Show all returns
            </Link>
          ) : (
            !day && (
              <Link className="b b-secondary" href="/app/clients">
                Open clients
              </Link>
            )
          )}
        </Empty>
      )}
      <nav className="cal-pages" aria-label="Calendar pages">
        <span>
          {shownFrom.toLocaleString("en-IN")} to {shownTo.toLocaleString("en-IN")} of {(total ?? 0).toLocaleString("en-IN")} returns
        </span>
        {page > 1 && (
          <Link className="b b-secondary" href={href({ page: page - 1 })}>
            Previous
          </Link>
        )}
        {shownTo < (total ?? 0) && (
          <Link className="b b-secondary" href={href({ page: page + 1 })}>
            Next
          </Link>
        )}
      </nav>
    </section>
  );

  return (
    <div className={`${month ? "" : "fill "}cal has-bulk`}>
      <PageHead
        title="Calendar"
        sub={`${period}: ${(total ?? 0).toLocaleString("en-IN")} return${total === 1 ? "" : "s"}${filedView ? " filed" : ""}.`}
        actions={
          <>
            <LinkTabs
              kind="pills"
              label="Layout"
              items={[
                { href: href({ month: null }), label: "List", current: !month },
                { href: href({ month: month ?? thisMonth }), label: "Month", current: !!month },
              ]}
            />
            <LinkTabs kind="pills" label="Show" items={views.map((shown, at) => ({ href: href({ view: shown }), label: calendarViews[shown].label, count: counts[at].count ?? 0, current: !day && view === shown }))} />
          </>
        }
      />
      {problems[params.error ?? ""] && (
        <p className="alert" role="alert">
          {problems[params.error!]}
        </p>
      )}

      {strip && (
        <nav className="cal-strip" aria-label="Days">
          {strip.map((date) => {
            const n = onDay.get(date)?.returns ?? 0;
            const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
            return (
              <Link
                key={date}
                href={day === date ? href({ view }) : href({ day: date })}
                scroll={false}
                className={`cal-day${date === today ? " is-today" : ""}`}
                aria-current={day === date ? "date" : undefined}
                aria-label={`${dueLabel(date)}: ${n} to file`}
              >
                <span>{date.endsWith("-01") || date === strip[0] ? dueLabel(date).split(" ")[1] : weekdays[weekday].slice(0, 2)}</span>
                <strong>{Number(date.slice(8))}</strong>
                <i style={{ "--n": n / most } as React.CSSProperties} />
                <small>{n || ""}</small>
              </Link>
            );
          })}
        </nav>
      )}

      {month && cells ? (
        <div className="cal-month-split">
          <section className="app-card cal-month" aria-labelledby="cal-month-title">
            <header className="app-card-head">
              <IconTile Icon={CalendarDays} kind="week" />
              <h2 id="cal-month-title">{new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
              <nav className="head-end" aria-label="Months">
                <Link className="b b-ghost b-icon" href={href({ view, month: shiftMonth(month, -1) })} scroll={false} aria-label="Previous month">
                  <ChevronLeft size={16} aria-hidden />
                </Link>
                {month !== thisMonth && (
                  <Link className="b b-secondary" href={href({ view, month: thisMonth })} scroll={false}>
                    This month
                  </Link>
                )}
                <Link className="b b-ghost b-icon" href={href({ view, month: shiftMonth(month, 1) })} scroll={false} aria-label="Next month">
                  <ChevronRight size={16} aria-hidden />
                </Link>
              </nav>
            </header>
            <div className="cal-week" aria-hidden>
              {[...weekdays.slice(1), weekdays[0]].map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <nav key={month} className="cal-grid" aria-label={`Days of ${dueLabel(`${month}-01`).slice(2)}`}>
              {cells.map((date) => {
                const tally = onDay.get(date);
                const late = date < today ? (tally?.returns ?? 0) : 0;
                const waiting = date < today ? 0 : (tally?.returns ?? 0) - (tally?.working ?? 0);
                const working = date < today ? 0 : (tally?.working ?? 0);
                const filed = tally?.filed ?? 0;
                const words = [late && `${late} late`, waiting && `${waiting} to file`, working && `${working} in progress`, filed && `${filed} filed`].filter(Boolean).join(", ") || "nothing due";
                return (
                  <Link
                    key={date}
                    href={day === date ? href({ view }) : href({ day: date })}
                    scroll={false}
                    className={`cal-cell${date.startsWith(month) ? "" : " is-out"}${date === today ? " is-today" : ""}`}
                    aria-current={day === date ? "date" : undefined}
                    aria-label={`${dueLabel(date)}: ${words}`}
                  >
                    <strong>{Number(date.slice(8))}</strong>
                    {!!tally?.returns && <small>{tally.returns}</small>}
                    <span className="cal-dots">
                      {!!late && <i className="d-late" />}
                      {!!waiting && <i className="d-wait" />}
                      {!!working && <i className="d-info" />}
                      {!!filed && <i className="d-done" />}
                    </span>
                  </Link>
                );
              })}
            </nav>
            <ul className="cal-legend" aria-label="What the dots mean">
              <li>
                <i className="d-late" aria-hidden />
                Late
              </li>
              <li>
                <i className="d-wait" aria-hidden />
                To file
              </li>
              <li>
                <i className="d-info" aria-hidden />
                In progress
              </li>
              <li>
                <i className="d-done" aria-hidden />
                Filed
              </li>
            </ul>
          </section>
          {list}
        </div>
      ) : (
        list
      )}

      {!viewOnly && (
        <form id="cal-pick" className="bulk" aria-label="Chosen returns">
          {state}
          <span className="bulk-count">chosen</span>
          {filedView ? (
            <Pending className="b b-primary" formAction={reopenTasks}>
              Mark chosen as not filed
            </Pending>
          ) : (
            <>
              <Pending className="b b-secondary" formAction={markTasksInProgress}>
                Mark chosen as in progress
              </Pending>
              <Pending className="b b-primary">Mark chosen as filed</Pending>
            </>
          )}
        </form>
      )}

      <Presence>
      {marking && !viewOnly && (
        <SidePanel key="filed" id="mark-filed" title={marking.length > 1 ? `Mark ${marking.length} returns filed` : "Mark filed"} close={close}>
          {marking.length ? (
            <MarkFiled state={state} rows={marking.map((task) => ({ id: task.id, name: task.clients?.name ?? "", sub: `${name(task).join(" ")}, due ${dueLabel(task.due_on)}` }))} />
          ) : (
            <p className="hint">These returns are already filed.</p>
          )}
        </SidePanel>
      )}

      {reminding && stops && (
        <SidePanel key="remind" id="remind-title" title={`Remind ${reminding.name}`} close={close}>
          <p className="hint">One email from your firm&apos;s address listing these returns and their due dates, and the papers still missing, the same as the daily reminders. Returns whose papers already arrived are left out.</p>
          {stops.map((stop) => (
            <p key={stop} className="alert" role="alert">
              {stop}
            </p>
          ))}
          {remindTasks?.length ? (
            <ul className="app-rows cal-remind">
              {remindTasks.map((task) => {
                const [form, of] = name(task);
                return <Row key={task.id} lead={<Avatar name={reminding.name} />} title={`${form} ${of}`} meta={`Due ${dueLabel(task.due_on)}`} status={rule.get(task.code ?? "")?.verified_on ? <Badge tone="blue">In the email</Badge> : <Badge plain>Date not confirmed, left out</Badge>} />;
              })}
            </ul>
          ) : (
            <p className="hint">This client has no return late or due in the next 7 days.</p>
          )}
          {!!stillMissing.length && (
            <ul className="app-rows cal-remind">
              {stillMissing.map((ask) => <Row key={ask.id} lead={<Avatar name={reminding.name} />} title="Papers still missing" meta={ask.what} status={<Badge tone="blue">In the email</Badge>} />)}
            </ul>
          )}
          <form action={remindClient} className="cal-remind-foot">
            {state}
            <input type="hidden" name="client" value={reminding.id} />
            <Pending className="b b-primary" busy="Sending" disabled={!!stops.length || (!remindable.length && !stillMissing.length)}>
              Send reminder
            </Pending>
            <Link className="b b-secondary" href={close} scroll={false}>
              Cancel
            </Link>
          </form>
        </SidePanel>
      )}
      </Presence>

      {saved[params.saved ?? ""] && done.length > 0 && (
        <Toast
          undo={
            params.saved !== "reopen" && (
              <form action={manageTasks}>
                {state}
                {done.map((id) => (
                  <input key={id} type="hidden" name="task" value={id} />
                ))}
                <Pending className="b" name="intent" value="reopen">
                  Undo
                </Pending>
              </form>
            )
          }
        >
          {done.length} return{done.length === 1 ? "" : "s"} {saved[params.saved!]}.
        </Toast>
      )}
      {uuid.test(params.reminding ?? "") && params.job && (
        <Toast
          undo={
            <form action={stopSend}>
              {state}
              <input type="hidden" name="client" value={params.reminding} />
              <input type="hidden" name="job" value={params.job} />
              <Pending className="b" busy="Stopping">
                Undo
              </Pending>
            </form>
          }
        >
          The reminder goes out in a minute from your firm&apos;s email.
        </Toast>
      )}
      {params.stopped && <Toast>Stopped. Nothing was sent.</Toast>}
    </div>
  );
}
