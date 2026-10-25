import "./calendar.css";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { manageTasks, markTasksInProgress, reopenTasks } from "@/app/(app)/actions";
import { addDays, calendarViews, dueLabel, periodLabel, todayInIndia, type CalendarView } from "@/src/lib/calendar";
import { currentMember } from "@/src/lib/member";
import { AutoSelect } from "../auto-select";
import { LinkTabs } from "../link-tabs";
import { MarkFiled } from "../mark-filed";
import { Badge, Empty, PageHead, SidePanel, Toast, type Tone } from "../ui";
import { RowKeys } from "../row-keys";

const columns = "id, client_id, code, period_key, due_on, status, details, clients!inner(name, archived_at)";
const uuid = /^[0-9a-f-]{36}$/;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const saved: Record<string, string> = { filed: "marked filed", in_progress: "marked in progress", reopen: "marked not filed" };

// The firm's compliance calendar: overdue, coming up and recently filed returns. Anyone in
// the firm marks a return in progress or filed, one at a time or many together (5.17.2).
export default async function Calendar({ searchParams }: { searchParams: Promise<{ view?: string; code?: string; day?: string; page?: string; error?: string; task?: string | string[]; saved?: string; t?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  const today = todayInIndia();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 100;
  const from = (page - 1) * pageSize;
  // One day, from the strip of days: everything due that day, filed or not.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day! : null;
  const code = params.code ?? "";
  const viewOnly = !!membership.viewOnlyUntil;

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
  // With no view asked for, it opens on the late returns when there are any.
  const view: CalendarView =
    params.view && params.view in calendarViews ? (params.view as CalendarView) : !day && (await returns("overdue", counted, true)).count ? "overdue" : "month";
  const href = (next: { view?: CalendarView; day?: string; page?: number; task?: string } = {}) => {
    const search = new URLSearchParams();
    const on = next.view ? null : (next.day ?? day);
    if (on) search.set("day", on);
    else search.set("view", next.view ?? view);
    if (code) search.set("code", code);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    if (next.task) search.set("task", next.task);
    return `/app/calendar?${search}`;
  };
  // The strip of days ahead, with how many returns are still to file on each.
  const strip = day || view === "week" || view === "month" ? Array.from({ length: (view === "week" && !day ? 7 : 30) + 1 }, (_, at) => addDays(today, at)) : null;
  const picked = [params.task ?? []].flat().filter((id) => uuid.test(id)).slice(0, 100);
  const views = Object.keys(calendarViews) as CalendarView[];
  const [{ data: tasks, count: total }, { data: rules }, { data: perDay }, { data: marking }, ...counts] = await Promise.all([
    returns(day ? null : view, columns).order("due_on").order("id").range(from, from + pageSize - 1),
    supabase.from("compliance_types").select("code, name, frequency, verified_on").eq("period_key", "").order("name"),
    strip ? supabase.rpc("calendar_days", { target_firm: membership.firmId, first_day: strip[0], last_day: strip.at(-1)!, only_code: code || undefined }) : Promise.resolve({ data: null }),
    picked.length ? supabase.from("tasks").select("id, code, period_key, due_on, clients(name)").eq("firm_id", membership.firmId).eq("kind", "compliance").neq("status", "filed").in("id", picked).order("due_on") : Promise.resolve({ data: null }),
    ...views.map((shown) => returns(shown, counted, true)),
  ]);
  if (total && from >= total) redirect(href({ page: Math.ceil(total / pageSize) }));
  const rule = new Map(rules?.map((r) => [r.code, r]));
  const name = (task: { code: string | null; period_key: string | null }) => [rule.get(task.code ?? "")?.name ?? task.code, periodLabel(rule.get(task.code ?? "")?.frequency ?? null, task.period_key)] as const;
  const onDay = new Map(perDay?.map((row) => [row.due_on, row.returns]));
  const most = Math.max(1, ...onDay.values());

  const status = (task: { status: string; due_on: string }): [Tone, string] =>
    task.status === "filed" ? ["done", "Filed"] : task.due_on < today ? ["late", "Late"] : task.status === "in_progress" ? ["", "In progress"] : ["", "Upcoming"];
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
    </>
  );

  return (
    <div className="fill cal">
      <PageHead
        title="Calendar"
        sub={`${period}: ${(total ?? 0).toLocaleString("en-IN")} return${total === 1 ? "" : "s"}${filedView ? " filed" : ""}.`}
        actions={<LinkTabs kind="pills" label="Show" items={views.map((shown, at) => ({ href: href({ view: shown }), label: calendarViews[shown].label, count: counts[at].count ?? 0, current: !day && view === shown }))} />}
      />
      {params.error === "filing" && (
        <p className="alert" role="alert">
          Your firm has not allowed you to record filing for all the chosen work.
        </p>
      )}

      {strip && (
        <nav className="cal-strip" aria-label="Days">
          {strip.map((date) => {
            const n = onDay.get(date) ?? 0;
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

      <section className="split cal-list" aria-label="Returns">
        <div className="cal-tools">
          <span className="hint">{tasks?.some((task) => !rule.get(task.code ?? "")?.verified_on) ? "Dates marked * are not yet confirmed by a CA against the official notification." : "Tick returns to mark many at once."}</span>
          <form>
            <input type="hidden" name="view" value={view} />
            {day && <input type="hidden" name="day" value={day} />}
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
          </form>
        </div>
        {tasks?.length ? (
          <div key={tasks.map((task) => task.id + task.status).join()} className="pane cal-table">
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
                  <th scope="col">Period</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const [form, of] = name(task);
                  const ack = (task.details as { ack?: string }).ack;
                  const [tone, word] = status(task);
                  return (
                    <tr key={task.id}>
                      {!viewOnly && (
                        <td className="shrink">
                          <input type="checkbox" form="cal-pick" name="task" value={task.id} aria-label={`Choose ${task.clients.name} ${form}`} />
                        </td>
                      )}
                      <td>
                        <Link className="row-link" href={`/app/clients/${task.client_id}`}>
                          {task.clients.name}
                        </Link>
                      </td>
                      <td>{form}</td>
                      <td>{of}</td>
                      <td>
                        {dueLabel(task.due_on)}
                        {!rule.get(task.code ?? "")?.verified_on && "*"}
                      </td>
                      <td>
                        <span className="cal-status">
                          <Badge tone={tone}>{word}</Badge>
                          {ack && <span className="num">{ack}</span>}
                        </span>
                      </td>
                      <td className="cal-act">
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
                            <button className="b b-secondary" name="intent" value="reopen" aria-label={`Mark ${task.clients.name} ${form} not filed`}>
                              Mark not filed
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <RowKeys />
          </div>
        ) : (
          <Empty Icon={CalendarDays} title={view === "overdue" && !day ? "Nothing is late" : "No returns here"}>
            <span>{view === "overdue" && !day ? "Every return that was due has been filed." : "Choose the services you file on a client's page, and their due dates appear here."}</span>
            {code ? (
              <Link className="b b-secondary" href={day ? `/app/calendar?day=${day}` : `/app/calendar?view=${view}`}>
                Show all returns
              </Link>
            ) : (
              <Link className="b b-secondary" href="/app/clients">
                Open clients
              </Link>
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

      {!viewOnly && (
        <form id="cal-pick" className="cal-bulk" aria-label="Chosen returns">
          {state}
          <span className="cal-chosen">chosen</span>
          {filedView ? (
            <button className="b b-primary" formAction={reopenTasks}>
              Mark chosen as not filed
            </button>
          ) : (
            <>
              <button className="b b-secondary" formAction={markTasksInProgress}>
                Mark chosen as in progress
              </button>
              <button className="b b-primary">Mark chosen as filed</button>
            </>
          )}
        </form>
      )}

      {marking && !viewOnly && (
        <SidePanel id="mark-filed" title={marking.length > 1 ? `Mark ${marking.length} returns filed` : "Mark filed"} close={href({ page })}>
          {marking.length ? (
            <MarkFiled state={state} rows={marking.map((task) => ({ id: task.id, name: task.clients?.name ?? "", sub: `${name(task).join(" ")}, due ${dueLabel(task.due_on)}` }))} />
          ) : (
            <p className="hint">These returns are already filed.</p>
          )}
        </SidePanel>
      )}

      {saved[params.saved ?? ""] && done.length > 0 && (
        <Toast
          undo={
            params.saved !== "reopen" && (
              <form action={manageTasks}>
                {state}
                {done.map((id) => (
                  <input key={id} type="hidden" name="task" value={id} />
                ))}
                <button className="b" name="intent" value="reopen">
                  Undo
                </button>
              </form>
            )
          }
        >
          {done.length} return{done.length === 1 ? "" : "s"} {saved[params.saved!]}.
        </Toast>
      )}
    </div>
  );
}
