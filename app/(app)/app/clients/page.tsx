import { sendClientPapers } from "@/app/(app)/actions";
import { dueLabel, todayInIndia } from "@/src/lib/calendar";
import { documentTypes, periodChoices, periodName } from "@/src/lib/documents";
import { sendSkip, type BulkSend } from "@/src/lib/records";
import { Search, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageClients } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { cleanNumber, isGstin, isPan } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { AddClientForm } from "./add-client-form";
import { ImportForm } from "./import-form";
import { LinkTabs } from "../link-tabs";
import { Badge, Empty, PageHead } from "../ui";
import "./clients.css";

const pills = { all: "All", late: "Late", missing: "Missing papers", mine: "Assigned to me" } as const;
type Pill = keyof typeof pills;
const columns = "id, name, client_registrations(kind, number_enc), client_assignments(user_id, team_id, role), next:tasks(code, due_on), asks:requests(id)";
// What each pill adds: a client counts when it has at least one such row.
const pillJoin: Record<Pill, string> = { all: "", late: ", late:tasks!inner(id)", missing: ", missing:requests!inner(id)", mine: ", mine:client_assignments!inner(role)" };
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
  const emailIndex = q.includes("@") ? await crypto.blindIndex(firm, "email", q) : null;
  const { data: byNumber } = kind
    ? await supabase.from("client_registrations").select("client_id").eq("firm_id", firm).eq("kind", kind).eq("number_bidx", await crypto.blindIndex(firm, kind, number))
    : { data: null };
  const [{ data: people }, { data: groups }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: firm }),
    supabase.from("groups").select("id, kind, name").eq("firm_id", firm).in("kind", ["client_group", "branch", "team"]).order("name"),
  ]);
  const myTeam = people?.find((person) => person.user_id === userId)?.team_id;
  // The same search, group, branch and archive choice for the list and every pill's count.
  const clientsIn = (pill: Pill, select: string, head = false) => {
    let query = supabase.from("clients").select(`${select}${pillJoin[pill]}` as typeof columns, { count: "exact", head }).eq("firm_id", firm);
    if (params.group) query = query.eq("group_id", params.group);
    if (params.branch) query = query.eq("branch_id", params.branch);
    query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (emailIndex) query = query.eq("email_bidx", emailIndex);
    else if (byNumber) query = query.in("id", byNumber.map((row) => row.client_id));
    else if (q) query = query.ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
    if (pill === "late") query = query.eq("late.kind", "compliance").neq("late.status", "filed").lt("late.due_on", today).limit(1, { referencedTable: "late" });
    if (pill === "missing") query = query.eq("missing.kind", "documents").eq("missing.status", "pending").gt("missing.expires_at", now).limit(1, { referencedTable: "missing" });
    if (pill === "mine") query = query.or(`user_id.eq.${userId}${myTeam ? `,team_id.eq.${myTeam}` : ""}`, { referencedTable: "mine" });
    return query;
  };
  const list = clientsIn(show, columns)
    .eq("client_registrations.kind", "gstin")
    .eq("next.kind", "compliance").neq("next.status", "filed").order("due_on", { referencedTable: "next" }).limit(1, { referencedTable: "next" })
    .eq("asks.kind", "documents").eq("asks.status", "pending").gt("asks.expires_at", now).limit(1, { referencedTable: "asks" })
    .order("name").order("id").range(from, from + pageSize - 1);
  const [{ data: clients, count: total }, { data: rules }, ...counts] = await Promise.all([
    list,
    supabase.from("compliance_types").select("code, name").eq("period_key", ""),
    ...(Object.keys(pills) as Pill[]).map((pill) => clientsIn(pill, "id", true)),
  ]);
  if (total && from >= total) redirect(pageHref(Math.ceil(total / pageSize)));
  const countOf = Object.fromEntries((Object.keys(pills) as Pill[]).map((pill, at) => [pill, counts[at].count ?? 0])) as Record<Pill, number>;
  const nameOf = new Map(groups?.map((group) => [group.id, group.name]));
  const emailOf = new Map(people?.map((person) => [person.user_id, person.email]));
  const ruleName = new Map(rules?.map((rule) => [rule.code, rule.name]));
  const branches = groups?.filter((group) => group.kind === "branch") ?? [];
  const filtered = params.group || params.branch;
  const groupName = filtered ? nameOf.get(filtered) : null;
  const manage = canManageClients(membership.role);
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
        next,
        state: archived ? (["Archived", ""] as const) : next && next.due_on < today ? (["Late", "late"] as const) : client.asks.length ? (["Missing papers", "warn"] as const) : next ? (["On track", "done"] as const) : (["No returns", ""] as const),
      };
    }),
  );
  // Adding and importing open beside the list; a firm with no clients yet starts with Add open.
  const panel = manage ? (params.panel ?? (!countOf.all && !q && !filtered && !archived ? "add" : "")) : "";
  const { data: batch } = manage && params.bulk ? await supabase.from("requests").select("id,status,details").eq("firm_id", firm).eq("id", params.bulk).eq("kind", "bulk_send").maybeSingle() : { data: null };
  const progress = batch?.details as unknown as BulkSend | undefined;
  const { data: chosen } = progress ? await supabase.from("clients").select("id,name").eq("firm_id", firm).in("id", progress.clients.map((client) => client.id)) : { data: [] };
  const clientNames = new Map(chosen?.map((client) => [client.id, client.name]));
  const { data: sends } = progress ? await supabase.from("shares").select("id,status").eq("firm_id", firm).in("id", progress.clients.map((client) => client.share)) : { data: [] };
  const sendState = new Map(sends?.map((share) => [share.id, share.status]));
  const plural = (n: number) => `${n.toLocaleString("en-IN")} ${archived ? "archived " : ""}client${n === 1 ? "" : "s"}`;
  const shownFrom = total ? from + 1 : 0;
  const shownTo = Math.min(from + (clients?.length ?? 0), total ?? 0);
  const empty = q
    ? ["No client matches", "Check the spelling, or search by a whole PAN or GSTIN."]
    : { all: ["No clients here yet", "Add a client, or import the Excel list your firm already keeps."], late: ["No client is late", "Every return due so far is filed."], missing: ["No papers are missing", "Clients you ask for papers show here until they send them."], mine: ["Nobody is assigned to you yet", "A manager assigns people on each client's page."] }[show];

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
      {panel === "add" && <AddClientForm />}
      {panel === "import" && <ImportForm />}

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
        <section className="clients-progress" aria-labelledby="send-progress">
          <div className="panel-head">
            <h2 id="send-progress">Sending {progress.type}, {periodName(progress.period)}</h2>
            <Link className="b b-secondary" href={pageHref(page)}>
              Refresh
            </Link>
          </div>
          <p role="status" className="hint">{batch?.status === "done" ? "Every chosen client has been checked." : "Sending in the background. Refresh to see progress."}</p>
          <ul>
            {progress.clients.map((client) => (
              <li key={client.id}>
                {clientNames.get(client.id) ?? "Client no longer available"}: {client.state === "skipped" ? `Skipped. ${sendSkip[client.reason ?? ""] ?? "Please check the client's page"}` : sendState.get(client.share) === "refused" ? "Not sent" : client.state === "sent" || sendState.get(client.share) === "sent" ? "Sent" : client.state === "waiting" ? "Waiting for approval in the Inbox" : "Waiting to send"}
              </li>
            ))}
          </ul>
        </section>
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
            <tbody>
              {rows.map((client) => (
                <tr key={client.id}>
                  {canSend && <td className="shrink"><input type="checkbox" form="bulk-send" name="client" value={client.id} aria-label={`Send a paper to ${client.name}`} /></td>}
                  <td>
                    <Link className="row-link" href={`/app/clients/${client.id}`}>
                      {client.name}
                    </Link>
                  </td>
                  <td className="num">{client.gstin || <span className="hint">None</span>}</td>
                  <td>{client.lead || <span className="hint">Nobody yet</span>}</td>
                  <td>{client.next ? `${ruleName.get(client.next.code ?? "") ?? client.next.code}, ${dueLabel(client.next.due_on)}` : <span className="hint">None due</span>}</td>
                  <td>
                    <Badge tone={client.state[1]}>{client.state[0]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty Icon={UsersRound} title={empty[0]}>
          <span>{empty[1]}</span>
          {manage && show === "all" && !q && (
            <Link className="b b-primary" href="/app/clients?panel=add" scroll={false}>
              New client
            </Link>
          )}
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
        <form id="bulk-send" action={sendClientPapers} className="clients-bulk" aria-label="Send filed papers">
          <span>Send the chosen clients a filed paper. Private papers wait in the Inbox.</span>
          <select id="bulk-paper" name="type" required aria-label="Paper">
            {documentTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <select id="bulk-year" name="period" required aria-label="Year">
            {periodChoices(todayInIndia())
              .filter((key) => key.length === 4)
              .map((key) => (
                <option value={key} key={key}>
                  {periodName(key)} (AY {key}-{String(Number(key) + 1).slice(2)})
                </option>
              ))}
          </select>
          <button className="b b-primary">Send chosen papers</button>
        </form>
      )}
    </div>
  );
}
