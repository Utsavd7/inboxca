import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { manageClient } from "@/app/(app)/actions";
import { assignmentRoles, canManageClients, clientKinds, type ClientKind } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { numberKinds, type NumberKind } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";

const errors: Record<string, string> = {
  details: "Enter a name, choose a kind, and check the email address.",
  number: "That number is not valid for its kind. Check it for a typing mistake.",
  "one-pan": "This client already has a PAN.",
  "gstin-pan": "That GSTIN holds a different PAN from this client's.",
  taken: "Another client in your firm already has that number.",
  assign: "Choose a person and what they do for this client.",
  assigned: "That person is already assigned to this client.",
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
    .select("id, name, kind, archived_at, email_enc, group_id, client_registrations(id, kind, number_enc), client_assignments(user_id, team_id, role)")
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
  const email = client.email_enc ? await crypto.decrypt(membership.firmId, `clients/${client.id}/email`, client.email_enc) : "";
  const manage = canManageClients(membership.role);
  const [{ data: people }, { data: groups }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "client_group"]).order("name"),
  ]);
  const teams = groups?.filter((group) => group.kind === "team");
  const clientGroups = groups?.filter((group) => group.kind === "client_group") ?? [];
  const groupName = clientGroups.find((group) => group.id === client.group_id)?.name;
  // Who can be assigned: teams and active people, each as "team:<id>" or "person:<id>".
  const choices = [
    ...(teams ?? []).map((team) => ({ value: `team:${team.id}`, label: `Team: ${team.name}` })),
    ...(people ?? []).filter((person) => person.status === "active").map((person) => ({ value: `person:${person.user_id}`, label: person.email })),
  ];
  const assigned = client.client_assignments.map((a) => ({ ...a, value: a.team_id ? `team:${a.team_id}` : `person:${a.user_id}` }));
  const labelOf = new Map(choices.map((choice) => [choice.value, choice.label]));
  const unassigned = choices.filter((choice) => !assigned.some((a) => a.value === choice.value));
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
          {email && <span className="app-email">{email}</span>}
          {groupName && (
            <Link className="app-email" href={`/app/clients?group=${client.group_id}`}>
              Group: {groupName}
            </Link>
          )}
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

      <section className="app-card" aria-labelledby="assigned">
        <h2 id="assigned">Assigned to</h2>
        <ul className="app-list">
          {assigned.map((assignment) => (
            <li key={assignment.value}>
              <span className="person">{labelOf.get(assignment.value)}</span>
              <span className="person-role">
                {assignmentRoles[assignment.role as keyof typeof assignmentRoles]}
                {manage && (
                  <form action={manageClient}>
                    {hidden}
                    <input type="hidden" name="who" value={assignment.value} />
                    <button className="btn btn-quiet" name="intent" value="unassign">
                      Unassign
                    </button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
        {!client.client_assignments.length && <p className="app-note">Nobody is assigned yet.</p>}
        {manage && !!unassigned.length && (
          <form action={manageClient} className="app-form-row">
            {hidden}
            <div>
              <label htmlFor="assign-who">Person or team</label>
              <select id="assign-who" name="who">
                {unassigned.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="assign-role">Does</label>
              <select id="assign-role" name="role" defaultValue="staff">
                {Object.entries(assignmentRoles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-quiet" name="intent" value="assign">
              Assign
            </button>
          </form>
        )}
      </section>

      {manage && (
        <section className="app-card" aria-labelledby="details">
          <h2 id="details">Details</h2>
          <form action={manageClient} className="app-grid-form">
            {hidden}
            <div>
              <label htmlFor="client-name">Name</label>
              <input id="client-name" name="name" required defaultValue={client.name} />
            </div>
            <div>
              <label htmlFor="client-email">Email</label>
              <input id="client-email" name="email" type="email" defaultValue={email} />
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
            <div>
              <label htmlFor="client-group">Group</label>
              <select id="client-group" name="group" defaultValue={client.group_id ?? ""}>
                <option value="">No group</option>
                {clientGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="client-new-group">Or a new group</label>
              <input id="client-new-group" name="new_group" maxLength={120} />
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
