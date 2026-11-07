import { dueLabel, periodLabel, todayInIndia } from "@/src/lib/calendar";
import { listedTypes, periodChoices, periodName } from "@/src/lib/documents";
import { paperType } from "@/src/lib/paper-type";
import { sendSkip, type BulkSend } from "@/src/lib/records";
import { CircleCheck, FileCheck2, Search, Send, UserRound, UsersRound } from "lucide-react";
import Form from "next/form";
import { LiveSearch } from "../live-search";
import Link from "next/link";
import { redirect } from "next/navigation";
import { assignClients, setServices, tagClients } from "@/app/(app)/actions";
import { assignmentRoles, assignmentWork, canManageClients } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { cleanNumber, isGstin, isPan, numberKinds, type NumberKind } from "@/src/lib/identifiers";
import { clientsIn as clientsMatching, filterKeys, matchingClients, MOST_MATCHING, pills, readFilter, type Lateness, type Pill, columns } from "./matching";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { Pending } from "../pending";
import { AddClientForm } from "./add-client-form";
import { BulkSendBar } from "./bulk-send";
import { ImportForm } from "./import-form";
import { LinkTabs } from "../link-tabs";
import { Item, List, Presence } from "../motion";
import { Avatar, Badge, Card, Empty, PageHead, SidePanel, Toast } from "../ui";
import { DeskChip } from "../desk-chip";
import { deskViewer, desksOf } from "@/src/lib/desks";
import { SetupArt } from "../setup-art";
import { RowKeys } from "../row-keys";
import "./clients.css";

const uuid = /^[0-9a-f-]{36}$/;

// The client register. Search finds a name, or a whole email, PAN or GSTIN through its
// blind index, so those are never searched in plain text. Each pill's count is a true count.
export default async function Clients({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string; group?: string; branch?: string; tag?: string; panel?: string; bulk?: string; error?: string; page?: string; show?: string; clients?: string; services?: string; assigned?: string; tagged?: string; of?: string; email?: string; all?: string }>;
}) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  const filter = readFilter(params);
  const { q, tag, archived, show } = filter;
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
    if (tag) search.set("tag", tag);
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
  const [{ data: byNumber }, { data: people }, { data: groups }, { data: batch }, { data: firmTags }] = await Promise.all([
    kind && numberIndex ? supabase.from("client_registrations").select("client_id").eq("firm_id", firm).eq("kind", kind).eq("number_bidx", numberIndex) : Promise.resolve({ data: null }),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabase.from("groups").select("id, kind, name").eq("firm_id", firm).in("kind", ["client_group", "branch", "team"]).order("name"),
    manage && params.bulk ? supabase.from("requests").select("id,status,details").eq("firm_id", firm).eq("id", params.bulk).eq("kind", "bulk_send").maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("firm_tags", { target_firm: firm }),
  ]);
  // The same search, group, branch and archive choice for the list and every pill's count (matching.ts).
  const clientsIn = (pill: Pill, select: string, head = false, only: Lateness = null) => clientsMatching(supabase, firm, filter, { emailIndex, byNumber }, pill, select, head, only);
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
  const ruling = Promise.resolve(supabase.from("compliance_types").select("code, name, frequency, due_rule").eq("period_key", "").order("code"));
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
    return [`${name} ${periodLabel(rule?.frequency ?? null, task.period_key, task.code)}`.trim(), `Late since ${since}`];
  };
  const branches = groups?.filter((group) => group.kind === "branch") ?? [];
  const filtered = params.group || params.branch || tag;
  const groupName = filtered ? (nameOf.get(filtered) ?? (tag ? `Tagged ${tag}` : null)) : null;
  const canSend = manage && !archived && !!clients?.some((client) => membership.may("send", client.id));
  // Ticks choose clients for Set services, and for sending a paper when the person may send.
  const canTick = manage && !archived && !membership.viewOnlyUntil;
  const viewer = deskViewer(membership, userId);
  const rows = await Promise.all(
    (clients ?? []).map(async (client) => {
      const gstin = client.client_registrations[0];
      const next = client.next[0];
      return {
        ...client,
        gstin: gstin ? await crypto.decrypt(firm, `clients/${client.id}/gstin`, gstin.number_enc) : "",
        // Who does its GST and income tax work (src/lib/desks.ts).
        desks: desksOf(client.client_assignments, client.desk.flatMap((number) => number.services), (a) => (a.team_id ? nameOf.get(a.team_id) : personName(emailOf.get(a.user_id ?? ""))) ?? ""),
        next,
        // The firm's own tags, under the status.
        labels: client.tags,
        // Late first, then missing papers; one quiet tag when neither (green means done only).
        tags: archived
          ? [["Archived", ""] as const]
          : [
              ...(client.late.length ? [[`Late: ${client.late.length} return${client.late.length === 1 ? "" : "s"}`, "late"] as const] : []),
              ...(client.asks.length ? [["Missing papers", "warn"] as const] : []),
              ...(client.late.length || client.asks.length ? [] : [next ? (["On track", ""] as const) : (["No returns", ""] as const)]),
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
  // Set services and Assign, for the clients ticked on the list (?clients=, at most a page of
  // them) or for every client the list's filter matches (?all=1, the count shown first), with
  // the services each kind of number takes, or the people and teams, as on a client's page.
  const all = params.all === "1" && (panel === "services" || panel === "assign") && !archived;
  const matching = all ? await matchingClients(supabase, firm, filter) : [];
  const tooMany = matching.length > MOST_MATCHING;
  const ticked = all ? matching.slice(0, MOST_MATCHING) : panel === "services" || panel === "assign" || panel === "tags" ? (params.clients ?? "").split(",").filter((id) => uuid.test(id)).slice(0, 50) : [];
  const { data: named } = ticked.length ? await supabase.from("clients").select("id, name").eq("firm_id", firm).in("id", ticked.slice(0, 50)).is("archived_at", null).order("name") : { data: [] };
  const setFor = all ? ticked.map((id) => ({ id, name: named?.find((client) => client.id === id)?.name ?? "" })) : named;
  // The action reads the same filter again, as this person, rather than a list of ids.
  const chosenInputs = all
    ? <>{<input type="hidden" name="all" value="1" />}{filterKeys.map((key) => params[key] && <input key={key} type="hidden" name={key} value={params[key]} />)}</>
    : setFor?.map((client) => <input key={client.id} type="hidden" name="client" value={client.id} />);
  const offered = (Object.keys(numberKinds) as NumberKind[]).map((kind) => [kind, rules?.filter((rule) => (rule.due_rule as { for?: string }).for === kind) ?? []] as const).filter(([, list]) => list.length);
  const setNames = setFor?.map((client) => client.name) ?? [];
  const added = Number(params.services), assigned = Number(params.assigned), tagged = Number(params.tagged), addedOf = Number(params.of);
  const teams = groups?.filter((group) => group.kind === "team") ?? [];
  const activePeople = people?.filter((person) => person.status === "active") ?? [];
  const chosenNames = all ? `all ${setNames.length.toLocaleString("en-IN")} clients on this list${filtered || q || show !== "all" ? ` (${[q && `matching “${q}”`, groupName, show !== "all" && pills[show]].filter(Boolean).join(", ")})` : ""}` : setNames.length > 4 ? `${setNames.slice(0, 3).join(", ")} and ${setNames.length - 3} more` : setNames.join(", ").replace(/, ([^,]*)$/, " and $1");
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
        mine: { Icon: UserRound, kind: "papers" as const, title: "Nobody is assigned to you yet", text: "Take a client from the All list, or a manager gives you one.", button: showAll },
      }[show];

  return (
    <div className="fill clients-page">
      <PageHead
        title="Clients"
        sub={q ? `${plural(countOf.all)} matching “${q}”.` : groupName ? `${groupName}: ${plural(countOf.all)}.` : `${plural(countOf.all)}.`}
        actions={
          manage && (
            <>
              {!!countOf.all && membership.role === "owner" && (
                <a className="b b-secondary" href="/app/clients/export" download>
                  Export to Excel
                </a>
              )}
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
        {panel === "add" && <AddClientForm key="add" email={params.email?.slice(0, 254)} />}
        {panel === "import" && <ImportForm key="import" names={Object.fromEntries(rules?.map((rule) => [rule.code, rule.name ?? rule.code]) ?? [])} />}
        {panel === "services" && !!setNames.length && (
          <SidePanel key="services" id="set-services" title="Set services" close={pageHref(page)}>
            {params.error === "services" && <p className="alert" role="alert">Tick the services to add, at most one of each return (one GSTR-1, one GSTR-3B, one ITR), and not composition with regular GST returns.</p>}
            <p className="hint">
              For {chosenNames}. Each ticked service is added to the client&apos;s number it sits on, where it is for that client type. Services already chosen stay, and InboxCA makes the due dates for the next 12 months.
            </p>
            {tooMany && <p className="alert" role="alert">This list has more than {MOST_MATCHING.toLocaleString("en-IN")} clients. Narrow it by tag, branch or search first.</p>}
            <form action={setServices}>
              {chosenInputs}
              <input type="hidden" name="back" value={pageHref(page)} />
              <ul className="client-rows">
                {offered.map(([kind, list]) => (
                  <li key={kind}>
                    <div className="grow service-form">
                      <span className="name">{numberKinds[kind].name}</span>
                      {list.map((rule) => (
                        <label key={rule.code} className="check">
                          <input type="checkbox" name="service" value={rule.code} /> {rule.name}
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              <Pending className="b b-primary service-save" disabled={tooMany}>Add services to {plural(setNames.length)}</Pending>
            </form>
          </SidePanel>
        )}
        {panel === "assign" && !!setNames.length && (
          <SidePanel key="assign" id="assign-clients" title="Assign" close={pageHref(page)}>
            {params.error === "assign" && <p className="alert" role="alert">Choose a person or team and what they do for these clients.</p>}
            <p className="hint">For {chosenNames}. Whoever these clients already have keeps looking after them.</p>
            {tooMany && <p className="alert" role="alert">This list has more than {MOST_MATCHING.toLocaleString("en-IN")} clients. Narrow it by tag, branch or search first.</p>}
            <form action={assignClients} className="fields">
              {chosenInputs}
              <input type="hidden" name="back" value={pageHref(page)} />
              <div>
                <label htmlFor="assign-who">Who</label>
                <select id="assign-who" name="who" required defaultValue="">
                  <option value="">Choose</option>
                  {activePeople.map((person) => <option key={person.user_id} value={`person:${person.user_id}`}>{personName(person.email)}{person.user_id === userId && " (you)"}</option>)}
                  {teams.map((team) => <option key={team.id} value={`team:${team.id}`}>{team.name} (team)</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="assign-role">As</label>
                <select id="assign-role" name="role" defaultValue="staff">
                  {Object.entries(assignmentRoles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="assign-work">For</label>
                <select id="assign-work" name="work" defaultValue="">
                  {Object.entries(assignmentWork).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <Pending className="b b-primary" disabled={tooMany}>Assign to {plural(setNames.length)}</Pending>
            </form>
          </SidePanel>
        )}
        {panel === "tags" && !!setNames.length && (
          <SidePanel key="tags" id="tag-clients" title="Add tags" close={pageHref(page)}>
            {params.error === "tags" && <p className="alert" role="alert">Type at least one tag.</p>}
            <p className="hint">For {chosenNames}. Tags are your firm&apos;s own words for a client, like Priority or Audit 2027. Each client keeps the tags it has.</p>
            <form action={tagClients} className="fields">
              {setFor?.map((client) => <input key={client.id} type="hidden" name="client" value={client.id} />)}
              <input type="hidden" name="back" value={pageHref(page)} />
              <div>
                <label htmlFor="tag-words">Tags, separated by commas</label>
                <input id="tag-words" name="tags" required maxLength={200} list="firm-tags" autoComplete="off" />
                <datalist id="firm-tags">{firmTags?.map((word) => <option key={word} value={word} />)}</datalist>
              </div>
              <Pending className="b b-primary">Add tags to {plural(setNames.length)}</Pending>
            </form>
          </SidePanel>
        )}
      </Presence>
      {tagged >= 0 && addedOf > 0 && (
        <Toast>
          Tags added to {tagged === addedOf ? "" : `${tagged} of `}{addedOf === 1 ? "1 client" : `${addedOf} clients`}.{tagged < addedOf && " The rest already had them."}
        </Toast>
      )}
      {assigned >= 0 && addedOf > 0 && !params.services && (
        <Toast>
          Assigned {assigned === addedOf ? "" : `${assigned} of `}{addedOf === 1 ? "1 client" : `${addedOf} clients`}.{assigned < addedOf && " The rest were already assigned to them."}
        </Toast>
      )}
      {added >= 0 && addedOf > 0 && (
        <Toast>
          Services added for {added === addedOf ? "" : `${added} of `}{addedOf === 1 ? "1 client" : `${addedOf} clients`}.{added < addedOf && " The rest already had them, have no number for them, or have other services they cannot go with."}
        </Toast>
      )}

      <div className="clients-bar">
        <LinkTabs kind="pills" label="Show" items={(Object.keys(pills) as Pill[]).map((pill) => ({ href: href({ show: pill }), label: pills[pill], count: countOf[pill], current: show === pill }))} />
        <Form action="/app/clients" className="clients-find" role="search">
          <span className="search">
            <Search size={16} aria-hidden />
            <LiveSearch id="q" name="q" defaultValue={q} placeholder="Name, email, PAN or GSTIN" aria-label="Find by name, email, PAN or GSTIN" />
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
          {!!firmTags?.length && (
            <select id="tag" name="tag" defaultValue={tag} aria-label="Tag">
              <option value="">Any tag</option>
              {firmTags.map((word) => (
                <option key={word} value={word}>
                  {word}
                </option>
              ))}
            </select>
          )}
          {archived && <input type="hidden" name="archived" value="1" />}
          {show !== "all" && <input type="hidden" name="show" value={show} />}
        </Form>
      </div>

      {params.error === "send_permission" && <p className="alert" role="alert">You are not allowed to send papers for some of these clients. Ask the owner for permission.</p>}
      {params.error === "send" && <p className="alert" role="alert">Choose clients, a paper type and a year. If you did all three, InboxCA could not start sending. Try again.</p>}
      {progress && (
        <Card
          id="send-progress"
          title={`Sending ${paperType(progress.type)}, ${periodName(progress.period)}`}
          Icon={Send}
          kind="approve"
          end={
            <Link className="b b-secondary" href={pageHref(page)}>
              Refresh
            </Link>
          }
        >
          <p role="status" className="app-card-none">{batch?.status === "done" ? "Done. Each client below shows what happened." : "InboxCA is sending these now. Choose Refresh to see the latest."}</p>
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
                {canTick && <th scope="col" className="shrink"><span className="sr-only">Choose</span></th>}
                <th scope="col">Client</th>
                <th scope="col">GSTIN</th>
                <th scope="col" className="clients-desk">Looked after by</th>
                <th scope="col">Next return</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <List key={pageHref(page)} as="tbody">
              {rows.map((client) => {
                const [next, when] = client.next ? returnLine(client.next) : [];
                return (
                  <Item as="tr" key={client.id}>
                    {canTick && <td className="shrink"><input type="checkbox" form="bulk-send" name="client" value={client.id} data-name={client.name} aria-label={`Choose ${client.name}`} /></td>}
                    <td>
                      <span className="who">
                        <Avatar name={client.name} />
                        <Link className="row-link" id={`c-${client.id}`} href={`/app/clients/${client.id}`}>
                          {client.name}
                        </Link>
                      </span>
                    </td>
                    <td className="num">{client.gstin || <span className="hint">None</span>}</td>
                    <td className="clients-desk">
                      <DeskChip client={{ id: client.id, name: client.name }} desks={client.desks} viewer={archived ? { ...viewer, assign: false, take: false } : viewer} named />
                    </td>
                    <td className="clients-next" title={next ? `${next}, ${when}` : undefined}>{next ? <>{next}<span className="sub">{when}</span></> : <span className="hint">None due</span>}</td>
                    <td>
                      <span className="row-swap">
                        <span className="clients-tags">
                          {client.tags.map(([word, tone]) => (
                            <Badge key={word} tone={tone}>{word}</Badge>
                          ))}
                          {client.labels.length > 0 && <span className="sub">{client.labels.join(", ")}</span>}
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
        <Empty Icon={empty.Icon} kind={empty.kind} title={empty.title} art={show === "all" && !countOf.all && !q && !filtered && !archived ? <SetupArt scene="clients" /> : undefined}>
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
      {canTick && (
        <BulkSendBar
          send={canSend}
          list={pageHref(page)}
          total={countOf[show]}
          types={listedTypes}
          years={periodChoices(todayInIndia())
            .filter((key) => key.length === 4)
            .map((key) => [key, periodName(key, "income_tax")])}
        />
      )}
    </div>
  );
}

