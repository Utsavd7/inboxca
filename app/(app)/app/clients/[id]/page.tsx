import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { manageClient } from "@/app/(app)/actions";
import { dueLabel, periodLabel, taskStatuses } from "@/src/lib/calendar";
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
  contact: "Enter the contact's name and a valid email address.",
  linked: "That contact is already linked to this client.",
  services: "Those services do not fit together. Choose one GSTR-1 and one GSTR-3B frequency, and not composition with regular returns.",
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
    .select("id, name, kind, archived_at, email_enc, group_id, branch_id, client_registrations(id, kind, number_enc, services), client_assignments(user_id, team_id, role), contact_clients(contact_id, relation, can_view_status, can_receive_documents, contacts(name_enc, email_enc))")
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
  const contacts = await Promise.all(
    client.contact_clients.map(async (link) => ({
      ...link,
      name: link.contacts ? await crypto.decrypt(membership.firmId, `contacts/${link.contact_id}/name`, link.contacts.name_enc) : "",
      email: link.contacts ? await crypto.decrypt(membership.firmId, `contacts/${link.contact_id}/email`, link.contacts.email_enc) : "",
    })),
  );
  const manage = canManageClients(membership.role);
  const [{ data: people }, { data: groups }, { data: rules }, { data: tasks }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "client_group", "branch"]).order("name"),
    supabase.from("compliance_types").select("code, name, frequency, due_rule, verified_on").eq("period_key", "").order("code"),
    supabase.from("tasks").select("id, code, period_key, due_on, status").eq("client_id", id).neq("status", "filed").order("due_on").limit(12),
  ]);
  const rule = new Map(rules?.map((r) => [r.code, r]));
  // Services sit on a number: GST returns on a GSTIN, TDS on a TAN, income tax on the PAN.
  const servicesFor = (kind: string) => rules?.filter((r) => (r.due_rule as { for?: string }).for === kind) ?? [];
  const teams = groups?.filter((group) => group.kind === "team");
  const clientGroups = groups?.filter((group) => group.kind === "client_group") ?? [];
  const branches = groups?.filter((group) => group.kind === "branch") ?? [];
  const groupName = clientGroups.find((group) => group.id === client.group_id)?.name;
  const branchName = branches.find((branch) => branch.id === client.branch_id)?.name;
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
          {branchName && (
            <Link className="app-email" href={`/app/clients?branch=${client.branch_id}`}>
              Branch: {branchName}
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

      {numbers.some((registration) => servicesFor(registration.kind).length) && (
        <section className="app-card" aria-labelledby="services">
          <h2 id="services">Services</h2>
          <p className="app-note">What your firm files for this client. InboxCA makes the due dates for the next 12 months.</p>
          <ul className="app-list">
            {numbers
              .filter((registration) => servicesFor(registration.kind).length)
              .map((registration) => (
                <li key={registration.id}>
                  <span className="person">
                    {numberKinds[registration.kind as NumberKind].name} <span className="num">{registration.number}</span>
                  </span>
                  <form key={registration.services.join()} action={manageClient} className="person-role">
                    {hidden}
                    <input type="hidden" name="registration" value={registration.id} />
                    {servicesFor(registration.kind).map((service) => (
                      <label key={service.code} className="app-check-inline">
                        <input type="checkbox" name="service" value={service.code} defaultChecked={registration.services.includes(service.code)} disabled={!manage} /> {service.name}
                      </label>
                    ))}
                    {manage && (
                      <button className="btn btn-quiet" name="intent" value="services">
                        Save services
                      </button>
                    )}
                  </form>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="app-card" aria-labelledby="due">
        <h2 id="due">Due dates</h2>
        <ul className="app-list">
          {tasks?.map((task) => (
            <li key={task.id}>
              <span className="person">
                {rule.get(task.code ?? "")?.name}
                <span className="app-email">{periodLabel(rule.get(task.code ?? "")?.frequency ?? null, task.period_key)}</span>
              </span>
              <span className="person-role">
                {!rule.get(task.code ?? "")?.verified_on && <span className="tag">Date not yet confirmed</span>}
                {taskStatuses[task.status as keyof typeof taskStatuses]}
                <span className="num">{dueLabel(task.due_on)}</span>
              </span>
            </li>
          ))}
        </ul>
        {!tasks?.length && <p className="app-note">No due dates yet. Add a number and choose its services.</p>}
      </section>

      <section className="app-card" aria-labelledby="contacts">
        <h2 id="contacts">Contact people</h2>
        <p className="app-note">People who write for this client. InboxCA recognises their emails, and sends documents only to those allowed.</p>
        <ul className="app-list">
          {contacts.map((contact) => (
            <li key={contact.contact_id}>
              <span className="person">
                {contact.name}
                <span className="app-email">
                  {contact.email}
                  {contact.relation && `, ${contact.relation}`}
                </span>
              </span>
              {manage ? (
                <form key={`${contact.can_view_status}${contact.can_receive_documents}`} action={manageClient} className="person-role">
                  {hidden}
                  <input type="hidden" name="contact" value={contact.contact_id} />
                  <label className="app-check-inline">
                    <input type="checkbox" name="can_view_status" defaultChecked={contact.can_view_status} /> Sees work status
                  </label>
                  <label className="app-check-inline">
                    <input type="checkbox" name="can_receive_documents" defaultChecked={contact.can_receive_documents} /> Receives documents
                  </label>
                  <button className="btn btn-quiet" name="intent" value="contact-rights">
                    Save
                  </button>
                  <button className="btn btn-quiet" name="intent" value="unlink-contact">
                    Remove
                  </button>
                </form>
              ) : (
                <span className="person-role">
                  {[contact.can_view_status && "Sees work status", contact.can_receive_documents && "Receives documents"].filter(Boolean).join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
        {!contacts.length && <p className="app-note">No contact people yet.</p>}
        {manage && (
          <form action={manageClient} className="app-grid-form">
            {hidden}
            <div>
              <label htmlFor="contact-name">Contact&apos;s name</label>
              <input id="contact-name" name="contact_name" required maxLength={120} />
            </div>
            <div>
              <label htmlFor="contact-email">Contact&apos;s email</label>
              <input id="contact-email" name="contact_email" type="email" required />
            </div>
            <div>
              <label htmlFor="contact-relation">Who they are, if known</label>
              <input id="contact-relation" name="relation" maxLength={60} />
            </div>
            <label className="app-check-inline">
              <input type="checkbox" name="can_view_status" /> Sees work status
            </label>
            <label className="app-check-inline">
              <input type="checkbox" name="can_receive_documents" /> Receives documents
            </label>
            <button className="btn btn-quiet" name="intent" value="add-contact">
              Add contact
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
            {!!branches.length && (
              <div>
                <label htmlFor="client-branch">Branch</label>
                <select id="client-branch" name="branch" defaultValue={client.branch_id ?? ""}>
                  <option value="">No branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
