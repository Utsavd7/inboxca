import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { manageTasks } from "@/app/(app)/actions";
import { calendarViews, dueLabel, periodLabel, todayInIndia, type CalendarView } from "@/src/lib/calendar";
import { currentMember } from "@/src/lib/member";
import { LinkTabs } from "../link-tabs";
import { Badge, Empty, PageHead, type Tone } from "../ui";

// The firm's compliance calendar: overdue, coming up and recently filed returns. Anyone in
// the firm marks a return in progress or filed, one at a time or many together (5.17.2).
export default async function Calendar({ searchParams }: { searchParams: Promise<{ view?: string; code?: string; day?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  const view: CalendarView = params.view && params.view in calendarViews ? (params.view as CalendarView) : "month";
  const today = todayInIndia();

  let query = supabase
    .from("tasks")
    .select("id, client_id, code, period_key, due_on, status, details, clients!inner(name, archived_at)")
    .is("clients.archived_at", null)
    .order("due_on")
    .limit(500);
  // One day, from the Home ribbon: everything due that day, filed or not.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day! : null;
  const window: { from?: string; to?: string; filedSince?: string } = day ? {} : calendarViews[view].window(today);
  if (day) query = query.eq("due_on", day);
  else if (window.filedSince) query = query.eq("status", "filed").gte("details->>filed_on", window.filedSince);
  else query = query.neq("status", "filed").lte("due_on", window.to!);
  if (window.from) query = query.gte("due_on", window.from);
  if (params.code) query = query.eq("code", params.code);
  const [{ data: tasks }, { data: rules }] = await Promise.all([
    query,
    supabase.from("compliance_types").select("code, name, frequency, verified_on").eq("period_key", "").order("name"),
  ]);
  const rule = new Map(rules?.map((r) => [r.code, r]));

  const title = `${day ? `Due on ${dueLabel(day)}` : calendarViews[view].label}: ${tasks?.length ?? 0} return${tasks?.length === 1 ? "" : "s"}`;
  const status = (task: { status: string; due_on: string }): [Tone, string] =>
    task.status === "filed" ? ["done", "Filed"] : task.due_on < today ? ["late", "Overdue"] : task.status === "in_progress" ? ["blue", "In progress"] : ["", "Upcoming"];
  const code = params.code ? `&code=${params.code}` : "";

  return (
    <>
      <PageHead title="Calendar" sub="Every return your firm files, by due date. Tick returns to mark them in progress or filed." />
      <div className="toolbar">
        <LinkTabs
          id="calendar-view"
          kind="segment"
          label="Show"
          items={Object.entries(calendarViews).map(([value, { label }]) => ({ href: `/app/calendar?view=${value}${code}`, label, current: !day && view === value }))}
        />
        <form className="toolbar-end">
          <input type="hidden" name="view" value={view} />
          <select id="code" name="code" defaultValue={params.code ?? ""} aria-label="Return">
            <option value="">All returns</option>
            {rules?.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="b b-secondary" type="submit">
            Show
          </button>
        </form>
      </div>
      <section aria-labelledby="returns">
        <div className="section-head">
          <h2 id="returns">{title}</h2>
          {tasks?.some((task) => !rule.get(task.code ?? "")?.verified_on) && <p>Dates marked * are not yet confirmed by a CA against the official notification.</p>}
        </div>
        {tasks?.length ? (
          <form key={tasks.map((task) => task.id + task.status).join()} action={manageTasks}>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th scope="col" className="shrink">
                      <span className="sr-only">Choose</span>
                    </th>
                    <th scope="col">Client</th>
                    <th scope="col">Return</th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                    <th scope="col">Acknowledgement</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const r = rule.get(task.code ?? "");
                    const ack = (task.details as { ack?: string }).ack;
                    const [tone, word] = status(task);
                    return (
                      <tr key={task.id}>
                        <td className="shrink">
                          <input type="checkbox" name="task" value={task.id} aria-label={`Choose ${task.clients.name} ${r?.name}`} />
                        </td>
                        <td>
                          <Link className="row-link" href={`/app/clients/${task.client_id}`}>
                            {task.clients.name}
                          </Link>
                        </td>
                        <td>
                          {r?.name}
                          <span className="sub">{periodLabel(r?.frequency ?? null, task.period_key)}</span>
                        </td>
                        <td className="shrink">
                          <span className="num">{dueLabel(task.due_on)}</span>
                          {!r?.verified_on && "*"}
                        </td>
                        <td className="shrink">
                          <Badge tone={tone}>{word}</Badge>
                        </td>
                        <td>
                          {task.status === "filed" ? (
                            <span className="num">{ack}</span>
                          ) : (
                            <input name={`ack-${task.id}`} maxLength={40} autoComplete="off" className="num" placeholder="Optional" aria-label={`Acknowledgement for ${task.clients.name} ${r?.name}`} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bulk" role="region" aria-label="Chosen returns">
              <span>Chosen returns</span>
              {window.filedSince ? (
                <button className="b b-primary" name="intent" value="reopen">
                  Mark chosen as not filed
                </button>
              ) : (
                <>
                  <button className="b b-secondary" name="intent" value="in_progress">
                    Mark chosen as in progress
                  </button>
                  <button className="b b-primary" name="intent" value="filed">
                    Mark chosen as filed
                  </button>
                </>
              )}
            </div>
            <p className="hint">Tick returns to act on them. An acknowledgement number typed in a row is saved when that return is marked filed.</p>
          </form>
        ) : (
          <div className="box">
            <Empty Icon={CalendarDays} title={view === "overdue" && !day ? "Nothing is overdue." : "No returns here"}>
              <span>{view === "overdue" && !day ? "Every return that was due has been filed." : "Tick what you file on a client's page, and its due dates appear here."}</span>
            </Empty>
          </div>
        )}
      </section>
    </>
  );
}
