import { dueLabel, periodLabel, todayInIndia } from "@/src/lib/calendar";
import { documentTypes, periodChoices, periodName } from "@/src/lib/documents";
import { sendSkip, type BulkSend } from "@/src/lib/records";
import { CircleCheck, FileCheck2, Search, Send, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageClients } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { cleanNumber, isGstin, isPan } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { AddClientForm } from "./add-client-form";
import { BulkSendBar } from "./bulk-send";
import { ImportForm } from "./import-form";
import { LinkTabs } from "../link-tabs";
import { Item, List, Presence } from "../motion";
import { Avatar, Badge, Card, Empty, PageHead } from "../ui";
import { RowKeys } from "../row-keys";
import "./clients.css";

const pills = { all: "All", late: "Late", missing: "Missing papers", mine: "Assigned to me" } as const;
type Pill = keyof typeof pills;
const columns = "id, name, client_registrations(kind, number_enc), client_assignments(user_id, team_id, role), next:tasks(code, period_key, due_on), asks:requests(id), late:tasks(id)";
// What each pill adds: a client counts when it has at least one such row (late returns are
// joined by every list, to count them, and by a count that asks for them).
const pillJoin: Record<Pill, string> = { all: "", late: "", missing: ", missing:requests!inner(id)", mine: ", mine:client_assignments!inner(role)" };
type Lateness = "late" | "on" | null;
const lookAfter = ["partner_in_charge", "manager", "staff"];

// The client register. Search finds a name, or a whole email, PAN or GSTIN through its
// blind index, so those are never searched in plain text. Each pill's count is a true count.
export default async function Clients({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string; group?: string; branch?: string; panel?: string; bulk?: string; error?: string; page?: string; show?: string }>;
}) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const archived = params.archived === "1";
  const show: Pill = params.show && params.show in pills ? (params.show as Pill) : "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const number = cleanNumber(q);
  const kind = isGstin(number) ? "gstin" : isPan(number) ? "pan" : null;
  const firm = membership.firmId;
  const today = todayInIndia();
  const now = new Date().toISOString();
  const href = (next: { show?: Pill; page?: number }) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (params.branch) search.set("branch", params.branch);
    if (params.group) search.set("group", params.group);
    if (archived) search.set("archived", "1");
    if (params.bulk) search.set("bulk", params.bulk);
    const pill = next.show ?? show;
    if (pill !== "all") search.set("show", pill);
    if (next.page) search.set("page", String(next.page));
    return `/app/clients${search.size ? `?${search}` : ""}`;
  };
  const pageHref = (next: number) => href({ page: next });

  const crypto = serverCrypto();
  const manage = canManageClients(membership.role);
  // A whole email, PAN or GSTIN is found by its blind index; the rest of the page's first
  // reads go together.
  const [emailIndex, numberIndex] = await Promise.all([q.includes("@") ? crypto.blindIndex(firm, "email", q) : null, kind ? crypto.blindIndex(firm, kind, number) : null]);
  const [{ data: byNumber }, { data: people }, { data: groups }, { data: batch }] = await Promise.all([
    kind && numberIndex ? supabase.from("client_registrations").select("client_id").eq("firm_id", firm).eq("kind", kind).eq("number_bidx", numberIndex) : Promise.resolve({ data: null }),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabase.from("groups").select("id, kind, name").eq("firm_id", firm).in("kind", ["client_group", "branch", "team"]).order("name"),
    manage && params.bulk ? supabase.from("requests").select("id,status,details").eq("firm_id", firm).eq("id", params.bulk).eq("kind", "bulk_send").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const myTeam = people?.find((person) => person.user_id === userId)?.team_id;
  // The same search, group, branch and archive choice for the list and every pill's count.
  const clientsIn = (pill: Pill, select: string, head = false, only: Lateness = null) => {
    const lateness = only ?? (pill === "late" ? "late" : null);
    let query = supabase.from("clients").select(`${select}${pillJoin[pill]}${head && lateness ? ", late:tasks(id)" : ""}` as typeof columns, { count: "exact", head }).eq("firm_id", firm).eq("stage", "client");
    if (params.group) query = query.eq("group_id", params.group);
    if (params.branch) query = query.eq("branch_id", params.branch);
    query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (emailIndex) query = query.eq("email_bidx", emailIndex);
    else if (byNumber) query = query.in("id", byNumber.map((row) => row.client_id));
    else if (q) query = query.ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
    if (!head || lateness) query = query.eq("late.kind", "compliance").neq("late.status", "filed").lt("late.due_on", today);
    if (head && lateness) query = query.limit(1, { referencedTable: "late" });
    if (lateness) query = lateness === "late" ? query.not("late", "is", null) : query.is("late", null);
    if (pill === "missing") query = query.eq("missing.kind", "documents").eq("missing.status", "pending").gt("missing.expires_at", now).limit(1, { referencedTable: "missing" });
    if (pill === "mine") query = query.or(`user_id.eq.${userId}${myTeam ? `,team_id.eq.${myTeam}` : ""}`, { referencedTable: "mine" });
    return query;
  };
  const list = (lateness: Lateness, at: number, to: number) =>
    clientsIn(show, columns, false, lateness)
      .eq("client_registrations.kind", "gstin")
      .eq("next.kind", "compliance").neq("next.status", "filed").order("due_on", { referencedTable: "next" }).limit(1, { referencedTable: "next" })
      .eq("asks.kind", "documents").eq("asks.status", "pending").gt("asks.expires_at", now).limit(1, { referencedTable: "asks" })
      .order("name").order("id").range(at, to);
  // Late clients come first, then the rest, each by name; a page can hold some of both. Every
  // pill's count starts at once (Promise.resolve sends each query now); the late count, which the
  // Late pill already has when All is shown, places the page.
  const lateFirst = show !== "late" && !archived;
  const counting = (Object.keys(pills) as Pill[]).map((pill) => Promise.resolve(clientsIn(pill, "id", true)));
  const ruling = Promise.resolve(supabase.from("compliance_types").select("code, name, frequency").eq("period_key", ""));
  const late = lateFirst ? ((show === "all" ? await counting[1] : await clientsIn(show, "id", true, "late")).count ?? 0) : 0;
  const last = from + pageSize - 1;
  const [lateClients, restClients, { data: rules }, counts] = await Promise.all([
    lateFirst && from < late ? list("late", from, Math.min(last, late - 1)) : { data: [] },
    !lateFirst ? list(null, from, last) : last >= late ? list("on", Math.max(0, from - late), last - late) : { data: [] },
    ruling,
    Promise.all(counting),
  ]);
  const clients = [...(lateClients.data ?? []), ...(restClients.data ?? [])];
  const countOf = Object.fromEntries((Object.keys(pills) as Pill[]).map((pill, at) => [pill, counts[at].count ?? 0])) as Record<Pill, number>;
  const total = countOf[show];
  if (total && from >= total) redirect(pageHref(Math.ceil(total / pageSize)));
  const nameOf = new Map(groups?.map((group) => [group.id, group.name]));
  const emailOf = new Map(people?.map((person) => [person.user_id, person.email]));
  const ruleOf = new Map(rules?.map((rule) => [rule.code, rule]));
  // The return over its date: "GSTR-1 (monthly)" over "Due 11 Nov 2026", or for a late one
  // "GSTR-1 (monthly) Sep 2026" over "Late since 11 Oct".
  const returnLine = (task: { code: string | null; period_key: string | null; due_on: string }) => {
    const rule = ruleOf.get(task.code ?? "");
    const name = rule?.name ?? task.code;
    if (task.due_on >= today) return [name, `Due ${dueLabel(task.due_on)}`];
    const since = task.due_on.slice(0, 4) === today.slice(0, 4) ? dueLabel(task.due_on).slice(0, -5) : dueLabel(task.due_on);
    return [`${name} ${periodLabel(rule?.frequency ?? null, task.period_key)}`.trim(), `Late since ${since}`];
  };
  const branches = groups?.filter((group) => group.kind === "branch") ?? [];
  const filtered = params.group || params.branch;
  const groupName = filtered ? nameOf.get(filtered) : null;
  const canSend = manage && !archived && !!clients?.some((client) => membership.may("send", client.id));
  const rows = await Promise.all(
    (clients ?? []).map(async (client) => {
      const gstin = client.client_registrations[0];
      const lead = [...client.client_assignments].sort((a, b) => lookAfter.indexOf(a.role) - lookAfter.indexOf(b.role))[0];
      const next = client.next[0];
      return {
        ...client,
        gstin: gstin ? await crypto.decrypt(firm, `clients/${client.id}/gstin`, gstin.number_enc) : "",
        lead: lead ? (lead.team_id ? nameOf.get(lead.team_id) : personName(emailOf.get(lead.user_id ?? ""))) : "",
        team: !!lead?.team_id,
        next,
        // Late first, then missing papers; one tag when neither.
        tags: archived
          ? [["Archived", ""] as const]
          : [
              ...(client.late.length ? [[`Late: ${client.late.length} return${client.late.length === 1 ? "" : "s"}`, "late"] as const] : []),
              ...(client.asks.length ? [["Missing papers", "warn"] as const] : []),
              ...(client.late.length || client.asks.length ? [] : [next ? (["On track", "done"] as const) : (["No returns", ""] as const)]),
            ],
      };
    }),
  );
  // Adding and importing open beside the list; a firm with no clients yet starts with Add open.
  const panel = manage ? (params.panel ?? (!countOf.all && !q && !filtered && !archived ? "add" : "")) : "";
  const progress = batch?.details as unknown as BulkSend | undefined;
  const [{ data: chosen }, { data: sends }] = progress
    ? await Promise.all([
        supabase.from("clients").select("id,name").eq("firm_id", firm).in("id", progress.clients.map((client) => client.id)),
        supabase.from("shares").select("id,status").eq("firm_id", firm).in("id", progress.clients.map((client) => client.share)),
      ])
    : [{ data: [] }, { data: [] }];
  const clientNames = new Map(chosen?.map((client) => [client.id, client.name]));
  const sendState = new Map(sends?.map((share) => [share.id, share.status]));
  const plural = (n: number) => `${n.toLocaleString("en-IN")} ${archived ? "archived " : ""}client${n === 1 ? "" : "s"}`;
  const shownFrom = total ? from + 1 : 0;
  const shownTo = Math.min(from + (clients?.length ?? 0), total ?? 0);
  // Nothing to list: what that means for this view, and the one way on from it.
  const showAll = <Link className="b b-secondary" href={href({ show: "all" })}>Show all clients</Link>;
  const empty = q
    ? { Icon: Search, kind: "" as const, title: "No client matches", text: "Check the spelling, or search by a whole PAN or GSTIN.", button: <Link className="b b-secondary" href={`/app/clients${show === "all" ? "" : `?show=${show}`}`}>Clear the search</Link> }
    : {
        all: { Icon: UsersRound, kind: "approve" as const, title: archived ? "No archived clients" : "No clients here yet", text: archived ? "Clients you archive wait here, and can be restored." : "Add a client, or import the Excel list your firm already keeps.", button: manage && !archived && !filtered && <Link className="b b-primary" href="/app/clients?panel=add" scroll={false}>New client</Link> },
        late: { Icon: CircleCheck, kind: "done" as const, title: "No client is late", text: "Every return due so far is filed.", button: showAll },
        missing: { Icon: FileCheck2, kind: "done" as const, title: "No papers are missing", text: "Clients you ask for papers show here until they send them.", button: showAll },
        mine: { Icon: UserRound, kind: "papers" as const, title: "Nobody is assigned to you yet", text: "A manager assigns people on each client's page.", button: showAll },
      }[show];

  return (
    <div className="fill clients-page">
      <PageHead
        title="Clients"
        sub={q ? `${plural(countOf.all)} matching “${q}”.` : groupName ? `${groupName}: ${plural(countOf.all)}.` : `${plural(countOf.all)}. Click a client to see its emails, papers and returns.`}
        actions={
          manage && (
            <>
              <Link className="b b-secondary" href="/app/clients?panel=import" scroll={false}>
                Import from Excel
              </Link>
              <Link className="b b-primary" href="/app/clients?panel=add" scroll={false}>
                New client
              </Link>
            </>
          )
        }
      />
      <Presence>
        {panel === "add" && <AddClientForm key="add" />}
        {panel === "import" && <ImportForm key="import" />}
      </Presence>

      <div className="clients-bar">
        <LinkTabs kind="pills" label="Show" items={(Object.keys(pills) as Pill[]).map((pill) => ({ href: href({ show: pill }), label: pills[pill], count: countOf[pill], current: show === pill }))} />
        <form className="clients-find" role="search">
          <span className="search">
            <Search size={16} aria-hidden />
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Name, email, PAN or GSTIN" aria-label="Find by name, email, PAN or GSTIN" />
          </span>
          {!!branches.length && (
            <select id="branch" name="branch" defaultValue={params.branch ?? ""} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          )}
          {archived && <input type="hidden" name="archived" value="1" />}
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          <button className="b b-secondary" type="submit">
            Find
          </button>
        </form>
      </div>

      {params.error === "send_permission" && <p className="alert" role="alert">Your owner needs to allow sending papers first.</p>}
      {params.error === "send" && <p className="alert" role="alert">Choose clients, a paper and a year. If they could not be queued, try again.</p>}
      {progress && (
        <Card
          id="send-progress"
          title={`Sending ${progress.type}, ${periodName(progress.period)}`}
          Icon={Send}
          kind="approve"
          end={
            <Link className="b b-secondary" href={pageHref(page)}>
              Refresh
            </Link>
          }
        >
          <p role="status" className="app-card-none">{batch?.status === "done" ? "Every chosen client has been checked." : "Sending in the background. Refresh to see progress."}</p>
          <ul className="app-rows">
            {progress.clients.map((client) => {
              const name = clientNames.get(client.id) ?? "Client no longer available";
              return (
                <li key={client.id} className="app-row">
                  <Avatar name={name} />
                  <span className="grow">
                    {name}: {client.state === "skipped" ? `Skipped. ${sendSkip[client.reason ?? ""] ?? "Please check the client's page"}` : sendState.get(client.share) === "refused" ? "Not sent" : client.state === "sent" || sendState.get(client.share) === "sent" ? "Sent" : client.state === "waiting" ? "Waiting for approval in the Inbox" : "Waiting to send"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {rows.length ? (
        <div className="pane clients-table">
          <table className="t">
            <thead>
              <tr>
                {canSend && <th scope="col" className="shrink"><span className="sr-only">Choose</span></th>}
                <th scope="col">Client</th>
                <th scope="col">GST number</th>
                <th scope="col">Looked after by</th>
                <th scope="col">Next return</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <List key={pageHref(page)} as="tbody">
              {rows.map((client) => {
                const [next, when] = client.next ? returnLine(client.next) : [];
                return (
                  <Item as="tr" key={client.id}>
                    {canSend && <td className="shrink"><input type="checkbox" form="bulk-send" name="client" value={client.id} data-name={client.name} aria-label={`Choose ${client.name}`} /></td>}
                    <td>
                      <span className="who">
                        <Avatar name={client.name} />
                        <Link className="row-link" id={`c-${client.id}`} href={`/app/clients/${client.id}`}>
                          {client.name}
                        </Link>
                      </span>
                    </td>
                    <td className="num">{client.gstin || <span className="hint">None</span>}</td>
                    <td>
                      {client.lead ? (
                        <span className="who">
                          <Avatar name={client.lead} square={client.team} />
                          {client.lead}
                        </span>
                      ) : (
                        <span className="hint">Nobody yet</span>
                      )}
                    </td>
                    <td className="clients-next">{next ? <>{next}<span className="sub">{when}</span></> : <span className="hint">None due</span>}</td>
                    <td>
                      <span className="row-swap">
                        <span className="clients-tags">
                          {client.tags.map(([word, tone]) => (
                            <Badge key={word} tone={tone}>{word}</Badge>
                          ))}
                        </span>
                        {/* The quick things to do for a client, shown while its row is pointed at.
                            Words only: an icon on every row would double the page's size. */}
                        {!archived && !membership.viewOnlyUntil && (
                          <span className="row-more">
                            <Link className="b b-secondary" href={`/app/inbox?compose=${client.id}`} aria-describedby={`c-${client.id}`}>
                              Write
                            </Link>
                            <Link className="b b-secondary" href={`/app/clients/${client.id}?tab=documents&ask=1`} aria-describedby={`c-${client.id}`}>
                              Ask for papers
                            </Link>
                          </span>
                        )}
                      </span>
                    </td>
                  </Item>
                );
              })}
            </List>
          </table>
          <RowKeys />
        </div>
      ) : (
        <Empty Icon={empty.Icon} kind={empty.kind} title={empty.title}>
          <span>{empty.text}</span>
          {empty.button}
        </Empty>
      )}
      <nav className="pager" aria-label="Client pages">
        <p>
          {total ? `Showing ${shownFrom.toLocaleString("en-IN")} to ${shownTo.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} clients` : ""}
        </p>
        <span>
          <Link className="b b-ghost" href={archived || filtered ? "/app/clients" : "/app/clients?archived=1"}>
            {archived || filtered ? "Show all current clients" : "Show archived clients"}
          </Link>
          {page > 1 && (
            <Link className="b b-secondary" href={pageHref(page - 1)}>
              Previous
            </Link>
          )}
          {shownTo < (total ?? 0) && (
            <Link className="b b-secondary" href={pageHref(page + 1)}>
              Next
            </Link>
          )}
        </span>
      </nav>
      {canSend && (
        <BulkSendBar
          types={documentTypes}
          years={periodChoices(todayInIndia())
            .filter((key) => key.length === 4)
            .map((key) => [key, `${periodName(key)} (AY ${key}-${String(Number(key) + 1).slice(2)})`])}
        />
      )}
    </div>
  );
}

