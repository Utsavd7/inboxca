import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { manageClient } from "@/app/(app)/actions";
import { canManageClients, clientKinds, type ClientKind } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { numberKinds, type NumberKind } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";

const errors: Record<string, string> = {
  details: "Enter a name and choose a kind.",
  number: "That number is not valid for its kind. Check it for a typing mistake.",
  "one-pan": "This client already has a PAN.",
  "gstin-pan": "That GSTIN holds a different PAN from this client's.",
  taken: "Another client in your firm already has that number.",
  role: "Only the owner, a partner or a manager can change clients.",
};

// One client. Its numbers are opened with the firm's key on the server, for this page only.
export default async function Client({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, kind, archived_at, client_registrations(id, kind, number_enc)")
    .eq("id", id)
    .maybeSingle();
  if (!client) notFound();
  const crypto = serverCrypto();
  const numbers = await Promise.all(
    client.client_registrations.map(async (registration) => ({
      ...registration,
      number: await crypto.decrypt(membership.firmId, `clients/${client.id}/${registration.kind}`, registration.number_enc),
    })),
  );
  const manage = canManageClients(membership.role);
  const hidden = <input type="hidden" name="client" value={client.id} />;

  return (
    <>
      <p className="app-note">
        <Link href="/app/clients">Clients</Link>
      </p>
      <h1>
        {client.name}
        <span className="app-role">
          {clientKinds[client.kind as ClientKind]}
          {client.archived_at && <span className="tag tag-deactivated">Archived</span>}
        </span>
      </h1>
      {error && errors[error] && (
        <p className="field-error" role="alert">
          {errors[error]}
        </p>
      )}

      <section className="app-card" aria-labelledby="numbers">
        <h2 id="numbers">Registrations</h2>
        <ul className="app-list">
          {numbers.map((registration) => (
            <li key={registration.id}>
              <span className="person">{numberKinds[registration.kind as NumberKind].name}</span>
              <span className="person-role">
                <span className="num">{registration.number}</span>
                {manage && (
                  <form action={manageClient}>
                    {hidden}
                    <input type="hidden" name="registration" value={registration.id} />
                    <button className="btn btn-quiet" name="intent" value="remove-number">
                      Remove
                    </button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
        {!numbers.length && <p className="app-note">No numbers yet.</p>}
        {manage && (
          <form action={manageClient} className="app-form-row">
            {hidden}
            <div>
              <label htmlFor="number-kind">Number</label>
              <select id="number-kind" name="kind" defaultValue="gstin">
                {Object.entries(numberKinds).map(([value, { name }]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="number-value">Value</label>
              <input id="number-value" name="number" required autoComplete="off" className="num" />
            </div>
            <button className="btn btn-quiet" name="intent" value="add-number">
              Add number
            </button>
          </form>
        )}
      </section>

      {manage && (
        <section className="app-card" aria-labelledby="details">
          <h2 id="details">Details</h2>
          <form action={manageClient} className="app-form-row">
            {hidden}
            <div>
              <label htmlFor="client-name">Name</label>
              <input id="client-name" name="name" required defaultValue={client.name} />
            </div>
            <div>
              <label htmlFor="client-kind">Kind</label>
              <select id="client-kind" name="kind" defaultValue={client.kind}>
                {Object.entries(clientKinds).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn" name="intent" value="details">
              Save details
            </button>
          </form>
          <form action={manageClient} className="app-form-row">
            {hidden}
            <button className="btn btn-quiet" name="intent" value={client.archived_at ? "restore" : "archive"}>
              {client.archived_at ? "Restore client" : "Archive client"}
            </button>
            <span className="app-note">
              {client.archived_at
                ? "Archived clients are hidden from the list. Nothing was deleted."
                : "Archiving hides the client from the list. Nothing is deleted, and you can restore it."}
            </span>
          </form>
        </section>
      )}
    </>
  );
}
