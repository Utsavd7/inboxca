import { Plus, Search, Upload, UsersRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageClients, clientKinds, type ClientKind } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { cleanNumber, isGstin, isPan } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";
import { AddClientForm } from "./add-client-form";
import { ImportForm } from "./import-form";
import { Avatar, Badge, Empty, PageHead } from "../ui";

// The client register. Search finds a name, or a whole email, PAN or GSTIN through its
// blind index, so those are never searched in plain text.
export default async function Clients({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string; group?: string; branch?: string; panel?: string; page?: string }>;
}) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const archived = params.archived === "1";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const number = cleanNumber(q);
  const kind = isGstin(number) ? "gstin" : isPan(number) ? "pan" : null;
  const pageHref = (next: number) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (params.branch) search.set("branch", params.branch);
    if (params.group) search.set("group", params.group);
    if (archived) search.set("archived", "1");
    search.set("page", String(next));
    return `/app/clients?${search}`;
  };

  let query = supabase
    .from("clients")
    .select("id, name, kind, group_id, branch_id", { count: "exact" })
    .eq("firm_id", membership.firmId)
    .order("name")
    .order("id");
  if (params.group) query = query.eq("group_id", params.group);
  if (params.branch) query = query.eq("branch_id", params.branch);
  query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (q.includes("@")) query = query.eq("email_bidx", await serverCrypto().blindIndex(membership.firmId, "email", q));
  else if (kind) {
    const index = await serverCrypto().blindIndex(membership.firmId, kind, number);
    const { data } = await supabase.from("client_registrations").select("client_id").eq("firm_id", membership.firmId).eq("kind", kind).eq("number_bidx", index);
    query = query.in("id", data?.map((row) => row.client_id) ?? []);
  } else if (q) query = query.ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  const [{ data: clients, count: total }, { data: groups }] = await Promise.all([
    query.range(from, from + pageSize - 1),
    supabase.from("groups").select("id, kind, name").eq("firm_id", membership.firmId).in("kind", ["client_group", "branch"]).order("name"),
  ]);
  if (total && from >= total) redirect(pageHref(Math.ceil(total / pageSize)));
  const nameOf = new Map(groups?.map((group) => [group.id, group.name]));
  const branches = groups?.filter((group) => group.kind === "branch") ?? [];
  const filtered = params.group || params.branch;
  const groupName = filtered ? nameOf.get(filtered) : null;
  const manage = canManageClients(membership.role);
  // Adding and importing open in place; a firm with no clients yet starts with Add open.
  const panel = manage ? (params.panel ?? (!clients?.length && !q && !filtered && !archived ? "add" : "")) : "";
  const count = `${total ?? 0} ${archived ? "archived " : ""}client${total === 1 ? "" : "s"}`;
  const shownFrom = total ? from + 1 : 0;
  const shownTo = Math.min(from + (clients?.length ?? 0), total ?? 0);

  return (
    <>
      <PageHead
        title="Clients"
        sub="Everyone your firm works for. Search by name, or by a whole email, PAN or GSTIN."
        actions={
          manage && (
            <>
              <Link className="b b-secondary" href="/app/clients?panel=import" scroll={false}>
                <Upload size={15} aria-hidden />
                Import
              </Link>
              <Link className="b b-primary" href="/app/clients?panel=add" scroll={false}>
                <Plus size={15} aria-hidden />
                New client
              </Link>
            </>
          )
        }
      />
      {panel === "add" && <AddClientForm />}
      {panel === "import" && <ImportForm />}

      <form className="toolbar" role="search">
        <div className="search">
          <Search size={15} aria-hidden />
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Name, email, PAN or GSTIN" aria-label="Find by name, email, PAN or GSTIN" />
        </div>
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
        <button className="b b-secondary" type="submit">
          Find
        </button>
        <Link className="b b-ghost" href={archived || filtered ? "/app/clients" : "/app/clients?archived=1"}>
          {archived || filtered ? "Show all current clients" : "Show archived clients"}
        </Link>
      </form>

      <section className="panel" aria-labelledby="register">
        <div className="panel-head">
          <h2 id="register">{q ? `Clients matching “${q}”` : groupName ? `${groupName}: ${count}` : count}</h2>
        </div>
        {clients?.length ? (
          <>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Group</th>
                    {!!branches.length && <th scope="col">Branch</th>}
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr key={client.id}>
                      <td>
                        <span className="who">
                          <Avatar name={client.name} />
                          <Link className="row-link" href={`/app/clients/${client.id}`}>
                            {client.name}
                          </Link>
                        </span>
                      </td>
                      <td>
                        <Badge plain>{clientKinds[client.kind as ClientKind]}</Badge>
                      </td>
                      <td>{client.group_id && <Link href={`/app/clients?group=${client.group_id}`}>{nameOf.get(client.group_id)}</Link>}</td>
                      {!!branches.length && <td>{client.branch_id && <Link href={`/app/clients?branch=${client.branch_id}`}>{nameOf.get(client.branch_id)}</Link>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="pager" aria-label="Client pages">
              <p>Showing {shownFrom.toLocaleString("en-IN")} to {shownTo.toLocaleString("en-IN")} of {(total ?? 0).toLocaleString("en-IN")} clients</p>
              <span>
                {page > 1 && (
                  <Link className="b b-secondary b-small" href={pageHref(page - 1)}>
                    Previous
                  </Link>
                )}
                {shownTo < (total ?? 0) && (
                  <Link className="b b-secondary b-small" href={pageHref(page + 1)}>
                    Next
                  </Link>
                )}
              </span>
            </nav>
          </>
        ) : (
          <Empty Icon={UsersRound} title={q ? "No client matches" : "No clients here yet"}>
            <span>{q ? "Check the spelling, or search by a whole PAN or GSTIN." : "Add a client above, or import the Excel list your firm already keeps."}</span>
          </Empty>
        )}
      </section>
    </>
  );
}
