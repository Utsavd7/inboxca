import "../calendar/calendar.css";
import "./notices.css";
import { Building2, FileWarning, Landmark, Receipt, Scale, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { manageNotice } from "@/app/(app)/actions";
import { dueLabel, todayInIndia } from "@/src/lib/calendar";
import { canManageClients } from "@/src/lib/clients";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { supabaseAdmin } from "@/src/lib/supabase";
import { authorities, confirmAction, confirmers, noticeStatuses, type NoticeDetails } from "@/src/lib/notices";
import { LinkTabs } from "../link-tabs";
import { Item, List, Presence } from "../motion";
import { Pending } from "../pending";
import { Avatar, Badge, Empty, IconTile, PageHead, Row, SidePanel, Toast, type Tone } from "../ui";
import { RowKeys } from "../row-keys";

const catalog = ["Intimation u/s 143(1)", "Notice u/s 143(2)", "Notice u/s 142(1)", "Notice u/s 148", "Demand notice u/s 156", "DRC-01", "ASMT-10", "Registration notice", "Show cause notice", "Summons"];
const pills = { open: "Open", confirm: "Date to confirm", done: "Replied or closed", all: "All" } as const;
type Pill = keyof typeof pills;
const columns = "id, client_id, due_on, status, details, clients(name)";
const moves: Record<string, string> = { upcoming: "Mark open", in_progress: "Mark in progress", replied: "Mark replied", closed: "Close notice" };
const saved: Record<string, string> = { add: "Notice added.", confirm: "Action date confirmed.", upcoming: "Notice marked open.", in_progress: "Notice marked in progress.", replied: "Notice marked replied.", closed: "Notice closed." };
const PAGE = 50;
const PICK = 8;
const uuid = /^[0-9a-f-]{36}$/;
// Each authority's notices carry its own icon.
const authorityIcons: Record<string, LucideIcon> = { income_tax: Landmark, gst: Receipt, roc: Building2 };
const statusTones: Record<string, Tone> = { upcoming: "warn", in_progress: "blue" };

// Notices the firm's clients received (PLAN.md 5.6), the nearest date first. A date the rules
// found is only a suggestion until a person confirms it against the notice; until then the
// firm's own review deadline shows, never as the legal one.
export default async function Notices({ searchParams }: { searchParams: Promise<{ show?: string; page?: string; add?: string; for?: string; at?: string; client?: string; notice?: string; error?: string; saved?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  const firm = membership.firmId;
  const show: Pill = params.show && params.show in pills ? (params.show as Pill) : "open";
  const page = /^\d{1,6}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const today = todayInIndia();
  const viewOnly = !!membership.viewOnlyUntil;
  const add = !!params.add && !viewOnly;
  // Confirming a date and moving a notice on are for the owner, partners and managers.
  const decides = !viewOnly && canManageClients(membership.role);
  const find = params.for?.trim().slice(0, 100) ?? "";
  const at = /^\d{1,6}$/.test(params.at ?? "") ? Number(params.at) : 0;

  const href = (next: { show?: Pill; page?: number; add?: boolean; for?: string; at?: number; client?: string; notice?: string } = {}) => {
    const search = new URLSearchParams();
    const pill = next.show ?? show;
    const to = next.show ? 1 : (next.page ?? page);
    if (pill !== "open") search.set("show", pill);
    if (to > 1) search.set("page", String(to));
    if (next.add) search.set("add", "1");
    if (next.for) search.set("for", next.for);
    if (next.at) search.set("at", String(next.at));
    if (next.client) search.set("client", next.client);
    if (next.notice) search.set("notice", next.notice);
    return `/app/notices${search.size ? `?${search}` : ""}`;
  };
  // The notices each pill shows, for the list and its true count.
  const notices = (pill: Pill, select: typeof columns, head = false) => {
    const query = supabase.from("tasks").select(select, { count: "exact", head }).eq("firm_id", firm).eq("kind", "notice");
    if (pill === "open") return query.in("status", ["upcoming", "in_progress"]);
    if (pill === "confirm") return query.in("status", ["upcoming", "in_progress"]).is("details->>action_date", null);
    return pill === "done" ? query.in("status", ["replied", "closed"]) : query;
  };
  // Adding a notice: the client is found by name, a few at a time, never the whole list.
  const findClients = () => {
    const query = supabase.from("clients").select("id, name", { count: "exact" }).eq("firm_id", firm).eq("stage", "client").is("archived_at", null);
    return (find ? query.ilike("name", `%${find.replace(/[\\%_]/g, "\\$&")}%`) : query).order("name").order("id").range(at, at + PICK - 1);
  };
  const chosenId = add && uuid.test(params.client ?? "") ? params.client! : "";
  const openId = uuid.test(params.notice ?? "") ? params.notice! : "";
  // All at once: the list, the panels and each pill's count; for the open notice, who
  // confirmed its date, from the firm's activity.
  const [{ data: rows, count: total }, picker, { data: chosen }, { data: opened }, { data: confirms }, { data: people }, ...counts] = await Promise.all([
    notices(show, columns)
      .order("due_on", { ascending: show === "open" || show === "confirm" })
      .order("id")
      .range((page - 1) * PAGE, page * PAGE - 1),
    add && !chosenId ? findClients() : Promise.resolve(null),
    chosenId ? supabase.from("clients").select("id, name").eq("firm_id", firm).eq("id", chosenId).is("archived_at", null).maybeSingle() : Promise.resolve({ data: null }),
    openId ? supabase.from("tasks").select(columns).eq("firm_id", firm).eq("kind", "notice").eq("id", openId).maybeSingle() : Promise.resolve({ data: null }),
    openId ? supabaseAdmin().from("activity_log").select("entity_id, action, actor_id").eq("firm_id", firm).eq("entity_id", openId).in("action", confirmAction) : Promise.resolve({ data: null }),
    openId ? supabase.rpc("firm_people", { target_firm: firm }) : Promise.resolve({ data: null }),
    ...(Object.keys(pills) as Pill[]).map((pill) => notices(pill, "id" as typeof columns, true)),
  ]);
  if (total && (page - 1) * PAGE >= total) redirect(href({ page: Math.ceil(total / PAGE) }));
  const count = Object.fromEntries((Object.keys(pills) as Pill[]).map((pill, i) => [pill, counts[i].count ?? 0])) as Record<Pill, number>;

  const done = (status: string) => status === "replied" || status === "closed";
  const label = (status: string) => noticeStatuses[status as keyof typeof noticeStatuses] ?? status;
  const tag = (notice: { status: string; due_on: string }): [Tone, string] => (done(notice.status) ? ["done", label(notice.status)] : notice.due_on < today ? ["late", "Late"] : [statusTones[notice.status] ?? "", label(notice.status)]);
  const actionDate = (notice: { due_on: string; status: string; details: unknown }) => {
    const details = notice.details as NoticeDetails;
    return details.action_date ? <span className={notice.due_on < today && !done(notice.status) ? "notices-late" : undefined}>{dueLabel(details.action_date)}</span> : <Badge tone="warn">Review by {dueLabel(notice.due_on)}</Badge>;
  };
  // The list, kept by every form so each change comes back to it.
  const state = (
    <>
      {show !== "open" && <input type="hidden" name="show" value={show} />}
      {page > 1 && <input type="hidden" name="page" value={page} />}
    </>
  );
  const shownTo = (page - 1) * PAGE + (rows?.length ?? 0);
  const empty = {
    open: ["No open notices", "A notice a client emails is recorded here by itself. Add one by hand if it came another way."],
    confirm: ["Every action date is confirmed", "A date InboxCA finds in a notice waits here until someone checks it."],
    done: ["Nothing replied or closed yet", "Notices you mark replied or closed move here."],
    all: ["No notices yet", "A notice a client emails is recorded here by itself. Add one by hand if it came another way."],
  }[show];
  const openDetails = opened?.details as NoticeDetails | undefined;
  const confirmer = openDetails?.action_date ? confirmers(confirms ?? []).get(opened?.id ?? "") : undefined;
  const confirmedBy = confirmer && personName(people?.find((person) => person.user_id === confirmer)?.email);

  return (
    <div className="fill notices">
      <PageHead
        title="Notices"
        sub="Notices your clients received, the nearest date first. A date InboxCA found is only a suggestion until someone confirms it."
        actions={
          !viewOnly && (
            <Link className="b b-primary" href={href({ add: true })} scroll={false}>
              Add a notice
            </Link>
          )
        }
      />
      <LinkTabs kind="pills" label="Show" items={(Object.keys(pills) as Pill[]).map((pill) => ({ href: href({ show: pill }), label: pills[pill], count: count[pill], current: show === pill }))} />

      <section className="split cal-list" aria-label="Notices">
        {rows?.length ? (
          <div className="pane cal-table">
            <table className="t">
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col">Notice</th>
                  <th scope="col">Received</th>
                  <th scope="col">Action date</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <List key={href()} as="tbody">
                {rows.map((notice) => {
                  const details = notice.details as unknown as NoticeDetails;
                  const [tone, word] = tag(notice);
                  return (
                    <Item as="tr" key={notice.id} className={notice.id === openId ? "on" : undefined}>
                      <td>
                        <span className="who">
                          <Avatar name={notice.clients?.name ?? ""} />
                          <Link className="row-link" href={`/app/clients/${notice.client_id}`}>
                            {notice.clients?.name}
                          </Link>
                        </span>
                      </td>
                      <td>
                        <span className="notices-what">
                          <IconTile Icon={authorityIcons[details.authority] ?? Scale} kind="notice" />
                          <span>
                            {details.notice_type}
                            <span className="sub">{[authorities[details.authority] ?? details.authority, details.reference].filter(Boolean).join(", ")}</span>
                          </span>
                        </span>
                      </td>
                      <td>{dueLabel(details.received_on)}</td>
                      <td>{actionDate(notice)}</td>
                      <td>
                        <Badge tone={tone}>{word}</Badge>
                      </td>
                      <td className="cal-act">
                        <Link className="b b-secondary" href={href({ notice: notice.id })} scroll={false} aria-label={`${decides ? "Update" : "Open"} the notice for ${notice.clients?.name}`}>
                          {decides ? "Update" : "Open"}
                        </Link>
                      </td>
                    </Item>
                  );
                })}
              </List>
            </table>
            <RowKeys />
          </div>
        ) : (
          <Empty Icon={FileWarning} kind={show === "confirm" ? "done" : "notice"} title={empty[0]}>
            <span>{empty[1]}</span>
            {!viewOnly && (show === "open" || show === "all") && (
              <Link className="b b-secondary" href={href({ add: true })} scroll={false}>
                Add a notice
              </Link>
            )}
          </Empty>
        )}
        <nav className="cal-pages" aria-label="Notice pages">
          <span>
            {total ? ((page - 1) * PAGE + 1).toLocaleString("en-IN") : 0} to {shownTo.toLocaleString("en-IN")} of {(total ?? 0).toLocaleString("en-IN")} notices
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

      <Presence>
      {opened && openDetails && (
        <SidePanel key="notice" id="notice-panel" title={openDetails.notice_type} close={href()}>
          <div className="notices-head">
            <IconTile Icon={authorityIcons[openDetails.authority] ?? Scale} kind="notice" />
            <span className="grow">
              <strong>{authorities[openDetails.authority] ?? openDetails.authority}</strong>
              <span className="sub">Received {dueLabel(openDetails.received_on)}</span>
            </span>
            <Badge tone={tag(opened)[0]}>{tag(opened)[1]}</Badge>
          </div>
          <dl className="props">
            <div>
              <dt>Client</dt>
              <dd className="who">
                <Avatar name={opened.clients?.name ?? ""} />
                <Link className="row-link" href={`/app/clients/${opened.client_id}`}>
                  {opened.clients?.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{authorities[openDetails.authority] ?? openDetails.authority}</dd>
            </div>
            {openDetails.reference && (
              <div>
                <dt>Reference</dt>
                <dd className="num">{openDetails.reference}</dd>
              </div>
            )}
            <div>
              <dt>Received</dt>
              <dd>{dueLabel(openDetails.received_on)}</dd>
            </div>
            <div>
              <dt>Action date</dt>
              <dd>{actionDate(opened)}</dd>
            </div>
            {confirmedBy && (
              <div>
                <dt>Confirmed by</dt>
                <dd>{confirmedBy}</dd>
              </div>
            )}
          </dl>
          {decides && !openDetails.action_date && (
            <form action={manageNotice} className="fields notices-confirm">
              {state}
              <input type="hidden" name="notice" value={opened.id} />
              <p className="hint">Until it is confirmed, your firm&apos;s review deadline shows instead. Check the date on the notice, then confirm it.</p>
              <div>
                <label htmlFor="notice-confirm">Action date, as the notice states it</label>
                <input id="notice-confirm" name="date" type="date" defaultValue={openDetails.suggested_date} required />
                <span className="hint need-date">Pick the date from the notice first</span>
              </div>
              <Pending className="b b-primary" name="intent" value="confirm">
                Confirm date
              </Pending>
            </form>
          )}
          {!viewOnly && !decides && <p className="hint">The owner, a partner or a manager confirms the date and moves the notice on.</p>}
          {decides && (
            <>
              <h3>Move it on</h3>
              <p className="hint">Now {label(opened.status).toLowerCase()}.</p>
              <form action={manageNotice} className="notices-moves">
                {state}
                <input type="hidden" name="notice" value={opened.id} />
                {Object.keys(noticeStatuses)
                  .filter((status) => status !== opened.status)
                  .map((status) => (
                    <Pending key={status} className="b b-secondary" name="intent" value={status}>
                      {moves[status]}
                    </Pending>
                  ))}
              </form>
            </>
          )}
        </SidePanel>
      )}

      {add && (
        <SidePanel key="add" id="add-notice" title="Add a notice" close={href()}>
          {params.error === "notice" && (
            <p className="alert" role="alert">
              Choose the client, the authority and the day it was received.
            </p>
          )}
          {chosen ? (
            <form action={manageNotice} className="fields">
              {state}
              <input type="hidden" name="client" value={chosen.id} />
              <div className="notices-chosen">
                <Avatar name={chosen.name} />
                <span className="grow">
                  <span className="sub">Client</span>
                  <strong>{chosen.name}</strong>
                </span>
                <Link className="b b-ghost" href={href({ add: true })} scroll={false}>
                  Change
                </Link>
              </div>
              <div>
                <label htmlFor="notice-authority">Authority</label>
                <select id="notice-authority" name="authority">
                  {Object.entries(authorities).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="notice-type">Notice</label>
                <input id="notice-type" name="type" list="notice-types" maxLength={80} placeholder="Notice u/s 148" />
                <datalist id="notice-types">
                  {catalog.map((type) => (
                    <option key={type} value={type} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="notice-reference">Reference or DIN</label>
                <input id="notice-reference" name="reference" maxLength={60} className="num" />
              </div>
              <div>
                <label htmlFor="notice-received">Received on</label>
                <input id="notice-received" name="received" type="date" defaultValue={today} required />
              </div>
              <div>
                <label htmlFor="notice-date">Action date, as the notice states it</label>
                <input id="notice-date" name="date" type="date" />
              </div>
              <Pending className="b b-primary" name="intent" value="add">
                Add notice
              </Pending>
            </form>
          ) : (
            <>
              <p className="hint">Find the client the notice is for.</p>
              <form className="notices-find" role="search">
                {show !== "open" && <input type="hidden" name="show" value={show} />}
                <input type="hidden" name="add" value="1" />
                <span className="search">
                  <Search size={16} aria-hidden />
                  <input name="for" type="search" defaultValue={find} placeholder="Client name" aria-label="Client name" autoFocus />
                </span>
                <button className="b b-secondary">Find</button>
              </form>
              {picker?.data?.length ? (
                <>
                  <ul className="app-rows notices-clients">
                    {picker.data.map((client) => (
                      <Row
                        key={client.id}
                        lead={<Avatar name={client.name} />}
                        title={client.name}
                        action={
                          <Link className="b b-secondary" href={href({ add: true, client: client.id })} scroll={false} aria-label={`Choose ${client.name}`}>
                            Choose
                          </Link>
                        }
                      />
                    ))}
                  </ul>
                  <nav className="cal-pages notices-pick-pages" aria-label="Client pages">
                    <span>
                      {(at + 1).toLocaleString("en-IN")} to {(at + picker.data.length).toLocaleString("en-IN")} of {(picker.count ?? 0).toLocaleString("en-IN")}
                    </span>
                    {at > 0 && (
                      <Link className="b b-secondary" href={href({ add: true, for: find, at: Math.max(0, at - PICK) })} scroll={false}>
                        Previous
                      </Link>
                    )}
                    {at + PICK < (picker.count ?? 0) && (
                      <Link className="b b-secondary" href={href({ add: true, for: find, at: at + PICK })} scroll={false}>
                        Next
                      </Link>
                    )}
                  </nav>
                </>
              ) : (
                <p className="hint">{find ? "No client by that name. Try part of the name." : "Add the client on the Clients page first."}</p>
              )}
            </>
          )}
        </SidePanel>
      )}
      </Presence>

      {saved[params.saved ?? ""] && <Toast>{saved[params.saved!]}</Toast>}
    </div>
  );
}
