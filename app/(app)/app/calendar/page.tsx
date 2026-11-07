import "./calendar.css";
import { BellRing, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { manageTasks, markTasksInProgress, remindClient, reopenTasks, stopSend } from "@/app/(app)/actions";
import { addDays, calendarViews, dueLabel, isItr, periodLabel, todayInIndia, verifyBy, type CalendarView } from "@/src/lib/calendar";
import { firmChecked } from "@/src/lib/due-dates";
import type { DocumentRequest } from "@/src/lib/checklists";
import { canManageClients } from "@/src/lib/clients";
import { periodName } from "@/src/lib/documents";
import { MAX_FOLLOW_UPS } from "@/src/lib/reminders";
import { currentMember } from "@/src/lib/member";
import { supabaseAdmin } from "@/src/lib/supabase";
import { isLead } from "@/src/lib/work/today";
import { AutoSelect } from "../auto-select";
import { LinkTabs } from "../link-tabs";
import { MarkFiled } from "../mark-filed";
import { Fill } from "../fill";
import { returnStages } from "../return-work";
import { queueSteps, stepQueue, type QueueStep } from "../work-data";
import { fillable, fills } from "@/src/lib/return-work";
import { statementPeriod } from "@/src/lib/tds";
import { Item, List, Presence } from "../motion";
import { Pending } from "../pending";
import { Avatar, Badge, Empty, IconTile, PageHead, Row, SidePanel, Toast, type Tone } from "../ui";
import { SetupArt } from "../setup-art";
import { RowKeys } from "../row-keys";
import { DeskChip } from "../desk-chip";
import { deskViewer, readDesks, workOf } from "@/src/lib/desks";

const columns = "id, client_id, registration_id, kind, code, period_key, due_on, status, details, doer, clients!inner(name, archived_at)";
const uuid = /^[0-9a-f-]{36}$/;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const saved: Record<string, string> = { filed: "marked filed", in_progress: "marked in progress", reopen: "marked not filed" };
const problems: Record<string, string> = {
  filing: "You are not allowed to mark one or more of the chosen returns filed. Ask the owner to turn this on for you.",
  send: "The reminder could not start. Try again.",
  started: "The reminder had already gone, so it could not be stopped.",
};
// A month as YYYY-MM, moved on or back.
const shiftMonth = (month: string, by: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);

// The firm's compliance calendar: overdue, coming up and recently filed returns, as a list or
// a month. Anyone in the firm marks a return in progress or filed, one at a time or many
// together (5.17.2); those who manage clients remind a client of returns due this week.
export default async function Calendar({ searchParams }: { searchParams: Promise<{ view?: string; code?: string; day?: string; page?: string; month?: string; error?: string; task?: string | string[]; saved?: string; t?: string; remind?: string; reminding?: string; job?: string; stopped?: string; step?: string; mine?: string }> }) {
  const { supabase, membership, userId } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  // Mine: the returns of this person's desks, and those they cover (public.is_mine).
  // A step's list (from Today) is already the person's own.
  const mine = params.mine === "1" && !params.step;
  const today = todayInIndia();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 100;
  const from = (page - 1) * pageSize;
  // One day, from the strip or the month: everything due that day, filed or not.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day! : null;
  // The month grid, when asked for: YYYY-MM, or this month for ?view=month.
  const month = /^20\d\d-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : params.view === "month" ? today.slice(0, 7) : null;
  const code = params.code ?? "";
  const viewOnly = !!membership.viewOnlyUntil;
  const reminds = !viewOnly && canManageClients(membership.role);
  // One step's returns, late or due in 30 days, from Today's Work by step (work-data.ts).
  const step = !day && params.step && params.step in queueSteps ? (params.step as QueueStep) : null;
  const queue = step && stepQueue({ supabase, membership });

  // The returns a view shows, for the list and for each pill's true count.
  const returns = (shown: CalendarView | null, select: typeof columns, head = false) => {
    // Returns, and the licence expiry dates a firm entered on its clients (kind licence).
    let query = supabase.from("tasks").select(select, { count: "exact", head }).eq("firm_id", membership.firmId).in("kind", ["compliance", "licence"]).is("clients.archived_at", null);
    const window: { from?: string; to?: string; filedSince?: string } = shown ? calendarViews[shown].window(today) : {};
    if (!shown) query = query.eq("due_on", day!);
    else if (window.filedSince) query = query.eq("status", "filed").gte("details->>filed_on", window.filedSince);
    else query = query.neq("status", "filed").lte("due_on", window.to!);
    if (window.from) query = query.gte("due_on", window.from);
    if (mine) query = query.eq("is_mine", true);
    return code ? query.eq("code", code) : query;
  };
  const counted = "id, clients!inner(archived_at)" as typeof columns;
  const pageOf = (shown: CalendarView | null) => Promise.resolve(returns(shown, columns).order("due_on").order("id").range(from, from + pageSize - 1));
  const picked = [params.task ?? []].flat().filter((id) => uuid.test(id)).slice(0, 100);
  const remindId = reminds && uuid.test(params.remind ?? "") ? params.remind! : "";
  const views = Object.keys(calendarViews) as CalendarView[];
  // Everything that does not hang on the view starts at once: the rules, the panels, the counts.
  const rest = Promise.all([
    Promise.resolve(supabase.from("compliance_types").select("code, name, frequency, verified_on").eq("period_key", "").order("name")).then(async ({ data }) => ({ data: await firmChecked(supabase, membership.firmId, data) })),
    picked.length ? supabase.from("tasks").select("id, code, period_key, due_on, clients(name)").eq("firm_id", membership.firmId).eq("kind", "compliance").neq("status", "filed").in("id", picked).order("due_on") : Promise.resolve({ data: null }),
    // Remind client: the client, its returns due within 7 days, and whether the email can go.
    remindId ? supabase.from("clients").select("id, name, email_enc, reminders_paused").eq("firm_id", membership.firmId).eq("id", remindId).is("archived_at", null).maybeSingle() : Promise.resolve({ data: null }),
    remindId ? supabase.from("tasks").select("id, code, period_key, due_on").eq("firm_id", membership.firmId).eq("kind", "compliance").eq("client_id", remindId).neq("status", "filed").gte("due_on", addDays(today, -366)).lte("due_on", addDays(today, 7)).order("due_on") : Promise.resolve({ data: null }),
    remindId ? supabase.from("connected_accounts").select("status").eq("firm_id", membership.firmId).eq("kind", "mail").maybeSingle() : Promise.resolve({ data: null }),
    remindId ? supabaseAdmin().from("activity_log").select("at", { count: "exact", head: true }).eq("firm_id", membership.firmId).eq("entity_id", remindId).eq("action", "reminder.sent").gte("at", `${today}T00:00:00+05:30`) : Promise.resolve({ count: 0 }),
    Promise.all(views.map((shown) => returns(shown, counted, true))),
    // The periods moved by an official notice (the Sunday check), named beside their dates.
    supabase.from("compliance_types").select("code, period_key, due_rule, source_url").neq("period_key", "").not("verified_on", "is", null).not("due_rule->notice", "is", null),
  ]);
  // With no view asked for, it opens on the late returns when there are any: their page is read
  // straight away, and the next 30 days only when nothing is late.
  const asked = params.view && params.view in calendarViews ? (params.view as CalendarView) : null;
  const late = !asked && !day && !step ? pageOf("overdue") : null;
  const view: CalendarView = asked ?? (late && (await late).count ? "overdue" : "soon");
  const href = (next: { view?: CalendarView; day?: string; page?: number; task?: string; month?: string | null; remind?: string; mine?: boolean } = {}) => {
    const search = new URLSearchParams();
    const on = next.view ? null : (next.day ?? day);
    const shownMonth = next.month === undefined ? month : next.month;
    if (on) search.set("day", on);
    else if (step && !next.view) search.set("step", step);
    else search.set("view", next.view ?? view);
    if (code) search.set("code", code);
    if (shownMonth) search.set("month", shownMonth);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    if (next.task) search.set("task", next.task);
    if (next.remind) search.set("remind", next.remind);
    if (next.mine ?? mine) search.set("mine", "1");
    return `/app/calendar?${search}`;
  };
  // The strip of days ahead, with how many returns are still to file on each; or the month's
  // weeks, Monday first, with what is due on each day.
  const strip = month || step ? null : day || view === "week" || view === "soon" ? Array.from({ length: (view === "week" && !day ? 7 : 30) + 1 }, (_, at) => addDays(today, at)) : null;
  const lead = month ? (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const cells = month ? Array.from({ length: Math.ceil((lead + new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()) / 7) * 7 }, (_, at) => addDays(`${month}-01`, at - lead)) : null;
  const span = strip ?? cells;
  const inGrid = cells && supabase.from("tasks").select(columns).eq("firm_id", membership.firmId).in("kind", ["compliance", "licence"]).is("clients.archived_at", null).gte("due_on", cells[0]).lte("due_on", cells.at(-1)!).match(mine ? { is_mine: true } : {});
  const [{ data: tasks, count: total }, { data: perDay }, { data: inMonth }, [{ data: rules }, { data: marking }, { data: reminding }, { data: remindTasks }, { data: mailbox }, { count: remindedToday }, counts, { data: extensions }]] = await Promise.all([
    queue ? queue.then(({ groups }) => groups[step].filter((task) => (!code || task.code === code))).then((rows) => ({ data: rows.slice(from, from + pageSize), count: rows.length })) : late && view === "overdue" ? late : pageOf(day ? null : view),
    span ? supabase.rpc("calendar_days", { target_firm: membership.firmId, first_day: span[0], last_day: span.at(-1)!, only_code: code || undefined }) : Promise.resolve({ data: null }),
    // The month's own returns, the first few named in each day.
    inGrid ? Promise.resolve((code ? inGrid.eq("code", code) : inGrid).order("due_on").order("id").limit(1000)) : Promise.resolve({ data: null }),
    rest,
  ]);
  // Who does each listed return, for the chip beside its client (src/lib/desks.ts).
  const { desks, personOf } = await readDesks(supabase, membership.firmId, (tasks ?? []).map((task) => task.client_id));
  const viewer = deskViewer(membership, userId);
  if (total && from >= total) redirect(href({ page: Math.ceil(total / pageSize) }));
  // GST returns and ITRs with figures in but not filled yet, for Fill.
  const stages = queue && !viewOnly ? (await queue).stages : await returnStages(supabase, membership.firmId, viewOnly ? [] : (tasks ?? []).filter((task) => task.status !== "filed" && fills(task.code)).map((task) => task.id));
  const rule = new Map(rules?.map((r) => [r.code, r]));
  const extended = new Map(extensions?.map((row) => [`${row.code}:${row.period_key}`, { notice: (row.due_rule as { notice: string }).notice, link: row.source_url }]));
  const licence = (task: { kind?: string }) => task.kind === "licence";
  const name = (task: { kind?: string; code: string | null; period_key: string | null; details?: unknown }) =>
    licence(task) ? ([(task.details as { label?: string }).label ?? "Licence", "Licence or registration"] as const) : ([rule.get(task.code ?? "")?.name ?? task.code, periodLabel(rule.get(task.code ?? "")?.frequency ?? null, task.period_key, task.code)] as const);
  const onDay = new Map(perDay?.map((row) => [row.due_on, row]));
  const named = Map.groupBy(inMonth ?? [], (task) => task.due_on);
  const most = Math.max(1, ...[...onDay.values()].map((row) => row.returns));

  // Remind client: anything that stops the email. It names the returns late or due within 7
  // days and the papers still missing (src/jobs/reminders.ts).
  const soon = (due: string) => due >= addDays(today, -366) && due <= addDays(today, 7);
  const remindable = remindTasks?.filter((task) => rule.get(task.code ?? "")?.verified_on) ?? [];
  const { data: asking } = remindId ? await supabase.from("requests").select("id, details").eq("kind", "documents").eq("client_id", remindId).eq("status", "pending").gt("expires_at", new Date().toISOString()) : { data: null };
  const stillMissing = (asking ?? []).flatMap((request) => {
    const details = request.details as unknown as DocumentRequest;
    const missing = details.items.filter((item) => !item.received.length).map((item) => item.type);
    return missing.length && (details.followups?.length ?? 0) < MAX_FOLLOW_UPS ? [{ id: request.id, what: `${missing.join(", ")}${details.period ? ` for ${periodName(details.period, ...details.items.map((item) => item.work))}` : ""}` }] : [];
  });
  const stops = reminding && [
    mailbox?.status !== "connected" && "The firm email is not connected. The owner can connect it in Settings. Reminders go from the firm email.",
    !reminding.email_enc && "This client has no email address. Add one on the client's page.",
    reminding.reminders_paused && "Reminders are paused for this client. Resume them on the client's page.",
    !!remindedToday && "This client was already reminded today. Each client gets at most one reminder a day.",
  ].filter((stop): stop is string => !!stop);

  const status = (task: { kind: string; status: string; due_on: string }): [Tone, string] =>
    task.status === "filed" ? ["done", licence(task) ? "Renewed" : "Filed"] : task.due_on < today ? ["late", licence(task) ? "Expired" : "Late"] : task.status === "in_progress" ? ["blue", "In progress"] : ["warn", licence(task) ? "Expires" : "Upcoming"];
  const filedView = !day && view === "filed";
  const period = step ? `${queueSteps[step]}, late or due by ${dueLabel(addDays(today, 30))}` : day ? `Due on ${dueLabel(day)}` : view === "overdue" ? "Due before today" : filedView ? `Filed since ${dueLabel(addDays(today, -30))}` : `${dueLabel(today)} to ${dueLabel(addDays(today, view === "week" ? 7 : 30))}`;
  const shownFrom = total ? from + 1 : 0;
  const shownTo = Math.min(from + (tasks?.length ?? 0), total ?? 0);
  const done = params.t?.split(".").filter((id) => uuid.test(id)) ?? [];
  // The view, kept by every form so each action comes back to it.
  const state = (
    <>
      <input type="hidden" name="view" value={view} />
      {day && <input type="hidden" name="day" value={day} />}
      {code && <input type="hidden" name="code" value={code} />}
      {step && <input type="hidden" name="step" value={step} />}
      {page > 1 && <input type="hidden" name="page" value={page} />}
      {month && <input type="hidden" name="month" value={month} />}
    </>
  );
  const close = href({ page });
  // The period goes under the return, so a row fits a laptop; beside the month a chosen day's
  // returns need no due date either.
  const compact = !!month;
  // Ticks clear once any return shown changes, as after marking the chosen ones.
  const ticks = tasks?.map((task) => task.id + task.status).join();
  const thisMonth = today.slice(0, 7);
  // A step's one action for all its returns, the same ones the full list and a return's own page
  // have, with their own checks: remind every client still missing papers (the owner and
  // partners), Fill all, or open the next return to check, approve or file.
  const approver = ["owner", "partner", "manager"].includes(membership.role);
  const stepAction = viewOnly || !step || !tasks?.length ? null
    : step === "ask" ? isLead(membership.role) && <Link className="b b-secondary" href="/app/work?show=papers&confirm=papers">Remind clients missing papers</Link>
    : step === "prepare" ? (approver || membership.may("edit_figures")) && <Link className="b b-secondary" href="/app/work?show=returns&confirm=fill">Fill all due in 7 days</Link>
    : <Link className="b b-secondary" href={`/app/clients/${tasks[0].client_id}/returns/${tasks[0].id}`}>{step === "check" ? "Check the next one" : step === "approve" ? (approver ? "Approve the next one" : "Open the next one") : "File the next one"}</Link>;

  const list = (
    <section className="split cal-list" aria-label="Returns">
      <div className="cal-tools">
        {stepAction || <span className="hint">{tasks?.some((task) => !rule.get(task.code ?? "")?.verified_on) ? "* Date not yet checked against the notification." : "Tick returns to mark many at once."}</span>}
        {!step && <LinkTabs kind="pills" label="Whose" items={[{ href: href({ mine: false }), label: "Everyone", current: !mine }, { href: href({ mine: true }), label: "Mine", current: mine }]} />}
        <Form action="/app/calendar">
          <input type="hidden" name="view" value={view} />
          {mine && <input type="hidden" name="mine" value="1" />}
          {day && <input type="hidden" name="day" value={day} />}
          {month && <input type="hidden" name="month" value={month} />}
          {step && <input type="hidden" name="step" value={step} />}
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
        <Form action="/app/calendar">
          {code && <input type="hidden" name="code" value={code} />}
          <AutoSelect save="step" name="step" defaultValue={step ?? ""} aria-label="Step">
            <option value="">Every step</option>
            {(Object.keys(queueSteps) as QueueStep[]).map((key) => (
              <option key={key} value={key}>
                {queueSteps[key]}
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
                const { ack, filed_on, verified_on } = task.details as { ack?: string; filed_on?: string; verified_on?: string };
                const [tone, word] = status(task);
                // Remind client is its bell alone (named on hover), so the row fits a laptop.
                const fill = !viewOnly && membership.may("edit_figures", task.client_id) && fillable(stages.get(task.id));
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
                        <Link className="row-link" href={`/app/clients/${task.client_id}${licence(task) ? "" : `/returns/${task.id}`}`} title={task.clients.name}>
                          {task.clients.name}
                        </Link>
                        <DeskChip client={{ id: task.client_id, name: task.clients.name }} desks={desks.get(task.client_id) ?? []} work={workOf(task.code)} task={licence(task) || task.status === "filed" ? undefined : { id: task.id, doer: personOf(task.doer) }} viewer={viewer} />
                      </span>
                    </td>
                    <td className="cal-return" title={`${form}, ${of}`}>
                      {form}
                      <span className="sub">
                        {of}
                        {/* The quarter's TDS return opens its statements (Form No. 140 first), the TCS return its Form No. 143. */}
                        {!viewOnly && (task.code === "TDS_RET" || task.code === "TCS_RET") && task.status !== "filed" && task.registration_id && statementPeriod(task.period_key ?? "") && <Link className="cal-prepare" href={`/app/clients/${task.client_id}/returns/${task.id}?step=draft`} aria-label={`Prepare ${task.clients.name} ${form}`}>Prepare statement</Link>}
                      </span>
                    </td>
                    {!(compact && day) && (
                      <td>
                        {dueLabel(task.due_on)}
                        {!rule.get(task.code ?? "")?.verified_on && "*"}
                        {extended.has(`${task.code}:${task.period_key}`) && (
                          <a className="sub" href={extended.get(`${task.code}:${task.period_key}`)!.link ?? undefined} target="_blank" rel="noopener noreferrer">Extended by {extended.get(`${task.code}:${task.period_key}`)!.notice}</a>
                        )}
                      </td>
                    )}
                    <td>
                      <span className="cal-status">
                        <Badge tone={tone}>{word}</Badge>
                        {ack && <span className="num">{ack}</span>}
                        {task.status === "filed" && isItr(task.code) && <span className="sub">{verified_on ? `Verified ${dueLabel(verified_on)}` : `Verify by ${dueLabel(verifyBy(filed_on ?? task.due_on))}`}</span>}
                      </span>
                    </td>
                    <td className="cal-act">
                      {/* A client is reminded of returns late or due within 7 days; a licence never. */}
                      {reminds && !licence(task) && task.status !== "filed" && task.due_on > addDays(today, 7) && <span className="sub cal-later">Remind from {dueLabel(addDays(task.due_on, -7))}</span>}
                      {reminds && !licence(task) && task.status !== "filed" && soon(task.due_on) && (
                        <Link className="b b-ghost b-icon" href={href({ page, remind: task.client_id })} scroll={false} aria-label={`Remind ${task.clients.name}`} title="Remind client">
                          <BellRing size={14} aria-hidden />
                        </Link>
                      )}
                      {fill && <Fill task={task.id} label={`${task.clients.name} ${form}`} />}
                      {viewOnly ? null : task.status !== "filed" ? (
                        membership.may("mark_filed", task.client_id) && (licence(task) ? (
                          // A licence has no acknowledgement to type: renewed in one press.
                          <form action={manageTasks}>
                            {state}
                            <input type="hidden" name="task" value={task.id} />
                            <Pending className="b b-secondary" name="intent" value="filed" aria-label={`Mark ${task.clients.name} ${form} renewed`}>
                              Mark renewed
                            </Pending>
                          </form>
                        ) : (
                          <Link className="b b-secondary" href={href({ page, task: task.id })} scroll={false} aria-label={`Mark ${task.clients.name} ${form} filed`}>
                            Mark filed
                          </Link>
                        ))
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
        <Empty Icon={CalendarDays} kind={view === "overdue" && !day ? "done" : "week"} title={step ? "No returns at this step" : day ? `Nothing due on ${dueLabel(day)}` : view === "overdue" ? "Nothing is late" : "No returns here"} art={!day && !code && counts.every(({ count }) => !count) ? <SetupArt scene="calendar" /> : undefined}>
          <span>{step ? "Returns late or due in the next 30 days show here once they reach it." : day ? "Choose another day, or a view above." : view === "overdue" ? "Every return that was due has been filed." : "Choose the services you file on a client's page, and their due dates appear here."}</span>
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
            <LinkTabs kind="pills" label="Show" items={views.map((shown, at) => ({ href: href({ view: shown }), label: calendarViews[shown].label, count: counts[at].count ?? 0, current: !day && !step && view === shown }))} />
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
                    <span className="cal-items">
                      {named.get(date)?.slice(0, 3).map((task) => {
                        const [tone] = status(task);
                        return (
                          <span key={task.id} className={`cal-item ${tone === "late" || tone === "done" ? tone : "wait"}`} title={`${task.clients.name}: ${name(task)[0]}`}>
                            {task.clients.name}: {name(task)[0]}
                          </span>
                        );
                      })}
                      {(tally?.returns ?? 0) + filed > 3 && <span className="cal-more">{(tally?.returns ?? 0) + filed - 3} more</span>}
                    </span>
                  </Link>
                );
              })}
            </nav>
            <ul className="cal-legend" aria-label="What the colours mean">
              <li>
                <i className="d-late" aria-hidden />
                Late
              </li>
              <li>
                <i className="d-wait" aria-hidden />
                To file
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
            <MarkFiled state={state} rows={marking.map((task) => ({ id: task.id, name: task.clients?.name ?? "", sub: `${name(task).join(" ")}, due ${dueLabel(task.due_on)}`, itr: isItr(task.code), udin: task.code === "TAX_AUDIT" }))} />
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
                return <Row key={task.id} lead={<Avatar name={reminding.name} />} title={`${form} ${of}`} meta={`Due ${dueLabel(task.due_on)}`} status={rule.get(task.code ?? "")?.verified_on ? <Badge tone="blue">In the email</Badge> : <Badge plain>Date not checked yet, left out</Badge>} />;
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
          The reminder goes out from your firm email in about 20 seconds. Undo stops it.
        </Toast>
      )}
      {params.stopped && <Toast>Stopped. Nothing was sent.</Toast>}
    </div>
  );
}
