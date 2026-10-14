import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageClients, clientKinds, type ClientKind } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { cleanNumber, isGstin, isPan } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";
import { AddClientForm } from "./add-client-form";

// The client register. Search finds a name, or a whole PAN or GSTIN through its blind
// index, so numbers are never searched in plain text.
export default async function Clients({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const q = (await searchParams).q?.trim() ?? "";
  const number = cleanNumber(q);
  const kind = isGstin(number) ? "gstin" : isPan(number) ? "pan" : null;

  let query = supabase.from("clients").select("id, name, kind").eq("firm_id", membership.firmId).order("name").limit(500);
  if (kind) {
    const index = await serverCrypto().blindIndex(membership.firmId, kind, number);
    const { data } = await supabase.from("client_registrations").select("client_id").eq("kind", kind).eq("number_bidx", index);
    query = query.in("id", data?.map((row) => row.client_id) ?? []);
  } else if (q) query = query.ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  const { data: clients } = await query;

  return (
    <>
      <h1>Clients</h1>
      <section className="app-card" aria-labelledby="register">
        <h2 id="register">{q ? `Clients matching “${q}”` : `${clients?.length ?? 0} clients`}</h2>
        <form className="app-form-row" role="search">
          <div>
            <label htmlFor="q">Find by name, PAN or GSTIN</label>
            <input id="q" name="q" type="search" defaultValue={q} />
          </div>
          <button className="btn btn-quiet" type="submit">
            Find
          </button>
        </form>
        <ul className="app-list">
          {clients?.map((client) => (
            <li key={client.id}>
              <Link className="person" href={`/app/clients/${client.id}`}>
                {client.name}
              </Link>
              <span className="person-role">{clientKinds[client.kind as ClientKind]}</span>
            </li>
          ))}
        </ul>
        {q && !clients?.length && <p className="app-note">No client matches. Check the spelling or the number.</p>}
      </section>
      {canManageClients(membership.role) && <AddClientForm />}
    </>
  );
}
