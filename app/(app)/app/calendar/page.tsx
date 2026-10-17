import Link from "next/link";
import { redirect } from "next/navigation";
import { manageTasks } from "@/app/(app)/actions";
import { calendarViews, dueLabel, periodLabel, taskStatuses, todayInIndia, type CalendarView } from "@/src/lib/calendar";
import { currentMember } from "@/src/lib/member";

// The firm's compliance calendar: overdue, coming up and recently filed returns. Anyone in
// the firm marks a return in progress or filed, one at a time or many together (5.17.2).
export default async function Calendar({ searchParams }: { searchParams: Promise<{ view?: string; code?: string }> }) {
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
  const window: { from?: string; to?: string; filedSince?: string } = calendarViews[view].window(today);
  if (window.filedSince) query = query.eq("status", "filed").gte("details->>filed_on", window.filedSince);
  else query = query.neq("status", "filed").lte("due_on", window.to!);
  if (window.from) query = query.gte("due_on", window.from);
  if (params.code) query = query.eq("code", params.code);
  const [{ data: tasks }, { data: rules }] = await Promise.all([
    query,
    supabase.from("compliance_types").select("code, name, frequency, verified_on").eq("period_key", "").order("name"),
  ]);
  const rule = new Map(rules?.map((r) => [r.code, r]));

  return (
    <>
      <h1>Calendar</h1>
      <section className="app-card" aria-labelledby="returns">
        <h2 id="returns">
          {calendarViews[view].label}: {tasks?.length ?? 0} return{tasks?.length === 1 ? "" : "s"}
        </h2>
        <form className="app-form-row">
          <div>
            <label htmlFor="view">Show</label>
            <select id="view" name="view" defaultValue={view}>
              {Object.entries(calendarViews).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="code">Return</label>
            <select id="code" name="code" defaultValue={params.code ?? ""}>
              <option value="">All returns</option>
              {rules?.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-quiet" type="submit">
            Show
          </button>
        </form>
        {tasks?.length ? (
          <form key={tasks.map((task) => task.id + task.status).join()} action={manageTasks}>
            <div className="table-scroll table-tall">
              <table className="app-table">
                <thead>
                  <tr>
                    <th scope="col">
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
                    return (
                      <tr key={task.id}>
                        <td>
                          <input type="checkbox" name="task" value={task.id} aria-label={`Choose ${task.clients.name} ${r?.name}`} />
                        </td>
                        <td>
                          <Link href={`/app/clients/${task.client_id}`}>{task.clients.name}</Link>
                        </td>
                        <td>
                          {r?.name}
                          <span className="app-email">{periodLabel(r?.frequency ?? null, task.period_key)}</span>
                        </td>
                        <td>
                          <span className="num">{dueLabel(task.due_on)}</span>
                          {!r?.verified_on && <span className="app-email tag">Date not yet confirmed</span>}
                        </td>
                        <td>{taskStatuses[task.status as keyof typeof taskStatuses]}</td>
                        <td>
                          {task.status === "filed" ? (
                            <span className="num">{ack}</span>
                          ) : (
                            <input name={`ack-${task.id}`} maxLength={40} autoComplete="off" className="num" aria-label={`Acknowledgement for ${task.clients.name} ${r?.name}`} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="app-form-row">
              {window.filedSince ? (
                <button className="btn btn-quiet" name="intent" value="reopen">
                  Mark chosen as not filed
                </button>
              ) : (
                <>
                  <button className="btn" name="intent" value="filed">
                    Mark chosen as filed
                  </button>
                  <button className="btn btn-quiet" name="intent" value="in_progress">
                    Mark chosen as in progress
                  </button>
                </>
              )}
              <span className="app-note">Tick the returns first. An acknowledgement number is saved with each return marked filed.</span>
            </div>
          </form>
        ) : (
          <p className="app-note">{view === "overdue" ? "Nothing is overdue." : "No returns here. Choose services on a client's page to make its due dates."}</p>
        )}
      </section>
    </>
  );
}
