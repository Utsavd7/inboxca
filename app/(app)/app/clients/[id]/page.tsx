import { Archive, ChevronLeft, FileText, Upload } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { manageClient, manageDocument, removeDocument, uploadDocument } from "@/app/(app)/actions";
import { dueLabel, periodLabel, taskStatuses, todayInIndia } from "@/src/lib/calendar";
import { assignmentRoles, canManageClients, clientKinds, type ClientKind } from "@/src/lib/clients";
import { serverCrypto } from "@/src/lib/crypto";
import { documentTypes, periodChoices, periodName } from "@/src/lib/documents";
import { workTypes, type WorkType } from "@/src/lib/drive";
import { numberKinds, type NumberKind } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";
import { LinkTabs } from "../../link-tabs";
import { Avatar, Badge, Empty, PageHead } from "../../ui";

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
  document: "Choose the file's type, work and period. A type of your own needs a name.",
  drive: "The firm's drive is not connected or could not be reached. Try again in a minute.",
  upload: "Choose a file of up to 25 MB, and its type, work and period.",
  twin: "This client already has this file.",
  owner: "Only the owner can remove a file.",
};

// One client. Its numbers are opened with the firm's key on the server, for this page only.
export default async function Client({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; tab?: string; edit?: string; renamed?: string; saved?: string; removed?: string; upload?: string }> }) {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ id }, { error, tab: asked, edit, renamed, saved, removed, upload }] = await Promise.all([params, searchParams]);
  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, name, kind, archived_at, email_enc, group_id, branch_id, client_registrations(id, kind, number_enc, services), client_assignments(user_id, team_id, role), contact_clients(contact_id, relation, can_view_status, can_receive_documents, contacts(name_enc, email_enc))",
    )
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
  const [{ data: people }, { data: groups }, { data: rules }, { data: tasks }, { data: files }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "client_group", "branch"]).order("name"),
    supabase.from("compliance_types").select("code, name, frequency, due_rule, verified_on").eq("period_key", "").order("code"),
    supabase.from("tasks").select("id, code, period_key, due_on, status").eq("client_id", id).neq("status", "filed").order("due_on").limit(12),
    supabase.from("documents").select("id, name, document_type, work_type, period_key, status, sha256, received_at").eq("client_id", id).order("received_at", { ascending: false }).limit(500),
  ]);
  const documents = (files ?? []).filter((file) => file.status !== "deleted");
  const removedFiles = (files ?? []).filter((file) => file.status === "deleted");
  const owner = membership.role === "owner";
  // A file waiting to be checked because the client already has it, or one like it.
  const sameAs = (file: (typeof documents)[number]) => {
    const twin = documents.find((other) => other.id !== file.id && other.sha256 === file.sha256);
    if (twin) return `Same file as ${twin.name}`;
    const like = file.period_key && documents.find((other) => other.id !== file.id && other.document_type === file.document_type && other.period_key === file.period_key);
    return like ? `Same type and period as ${like.name}` : "";
  };
  const editing = documents.find((file) => file.id === edit);
  const noticeFile = (files ?? []).find((file) => file.id === (renamed ?? saved ?? removed));
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
  // One part of the client at a time, so the page stays short; each save returns to its tab.
  const tabs: [string, string, number?][] = [
    ["overview", "Overview"],
    ["files", "Files", documents.length],
    ["due", "Due dates", tasks?.length ?? 0],
    ["contacts", "Contacts", contacts.length],
    ["team", "Team", client.client_assignments.length],
    ...(manage ? ([["details", "Details"]] as [string, string][]) : []),
  ];
  const tab = tabs.some(([key]) => key === asked) ? asked! : "overview";
  const hidden = (
    <>
      <input type="hidden" name="client" value={client.id} />
      <input type="hidden" name="tab" value={tab} />
    </>
  );

  return (
    <>
      <PageHead
        crumb={
          <Link className="crumb" href="/app/clients">
            <ChevronLeft size={14} aria-hidden />
            Clients
          </Link>
        }
        title={
          <span className="who">
            <Avatar name={client.name} big />
            {client.name}
          </span>
        }
        sub={
          <span className="head-meta">
            <Badge>{clientKinds[client.kind as ClientKind]}</Badge>
            {client.archived_at && <Badge tone="late">Archived</Badge>}
          </span>
        }
        actions={
          manage && (
            <form
              action={manageClient}
              title={client.archived_at ? "Archived clients are hidden from the list. Nothing was deleted." : "Archiving hides the client from the list. Nothing is deleted, and you can restore it."}
            >
              {hidden}
              <button className="b b-secondary" name="intent" value={client.archived_at ? "restore" : "archive"}>
                <Archive size={15} aria-hidden />
                {client.archived_at ? "Restore client" : "Archive client"}
              </button>
            </form>
          )
        }
      />
      <div className="record">
        <div className="record-main">
          <LinkTabs label="Client" items={tabs.map(([key, label, count]) => ({ href: `/app/clients/${client.id}${key === "overview" ? "" : `?tab=${key}`}`, label, count, current: tab === key }))} />
          {error && errors[error] && (
            <p className="alert" role="alert">
              {errors[error]}
            </p>
          )}

          {tab === "overview" && (
            <div>
              <div>
                <section className="panel" aria-labelledby="numbers">
                  <h2 id="numbers">Registrations</h2>
                  <ul className="rows">
                    {numbers.map((registration) => (
                      <li key={registration.id}>
                        <span className="name">{numberKinds[registration.kind as NumberKind].name}</span>
                        <span className="end">
                          <span className="num">{registration.number}</span>
                          {manage && (
                            <form action={manageClient}>
                              {hidden}
                              <input type="hidden" name="registration" value={registration.id} />
                              <button className="b b-ghost b-small" name="intent" value="remove-number">
                                Remove
                              </button>
                            </form>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!numbers.length && <p className="hint">No numbers yet.</p>}
                  {manage && (
                    <form action={manageClient} className="form-row">
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
                      <button className="b b-secondary" name="intent" value="add-number">
                        Add number
                      </button>
                    </form>
                  )}
                </section>
              </div>
              <div>
                {numbers.some((registration) => servicesFor(registration.kind).length) && (
                  <section className="panel" aria-labelledby="services">
                    <h2 id="services">Services</h2>
                    <p className="hint">What your firm files for this client. InboxCA makes the due dates for the next 12 months.</p>
                    <ul className="rows">
                      {numbers
                        .filter((registration) => servicesFor(registration.kind).length)
                        .map((registration) => (
                          <li key={registration.id}>
                            <span className="name">
                              {numberKinds[registration.kind as NumberKind].name} <span className="num">{registration.number}</span>
                            </span>
                            <form key={registration.services.join()} action={manageClient} className="end">
                              {hidden}
                              <input type="hidden" name="registration" value={registration.id} />
                              {servicesFor(registration.kind).map((service) => (
                                <label key={service.code} className="check">
                                  <input type="checkbox" name="service" value={service.code} defaultChecked={registration.services.includes(service.code)} disabled={!manage} /> {service.name}
                                </label>
                              ))}
                              {manage && (
                                <button className="b b-secondary" name="intent" value="services">
                                  Save services
                                </button>
                              )}
                            </form>
                          </li>
                        ))}
                    </ul>
                  </section>
                )}
              </div>
            </div>
          )}
          {tab === "files" && (
            <section className="panel" aria-labelledby="files">
              <div className="panel-head">
                <h2 id="files">Files</h2>
                {manage && (
                  <Link className="b b-secondary b-small" href={`/app/clients/${client.id}?tab=files&upload=1`} scroll={false}>
                    <Upload size={14} aria-hidden />
                    Upload a file
                  </Link>
                )}
              </div>
              <p className="hint">Saved in your firm&apos;s drive. Files marked To check need a person to confirm their type or period.</p>
              {noticeFile && (
                <form action={removed ? removeDocument : manageDocument} className="notice" role="status">
                  <input type="hidden" name="document" value={noticeFile.id} />
                  <span>{removed ? `Removed ${noticeFile.name}. It waits 30 days in the drive's Deleted and old versions folder.` : `Saved as ${noticeFile.name}.`}</span>
                  {(renamed || removed) && (
                    <button className="b b-ghost b-small" name="intent" value={removed ? "restore" : "undo"}>
                      {removed ? "Put back" : "Undo"}
                    </button>
                  )}
                </form>
              )}
              {upload && manage && (
                <section className="reveal-panel" aria-labelledby="upload-file">
                  <Link className="b b-ghost b-small reveal-close" href={`/app/clients/${client.id}?tab=files`} scroll={false}>
                    Close
                  </Link>
                  <h3 id="upload-file">Upload a file for {client.name}</h3>
                  <p className="hint">Up to 25 MB. It is saved in the client&apos;s folder in your firm&apos;s drive, named by what you choose.</p>
                  <form action={uploadDocument} className="fields">
                    <input type="hidden" name="client" value={client.id} />
                    <div>
                      <label htmlFor="file-file">File</label>
                      <input id="file-file" name="file" type="file" required />
                    </div>
                    <DocumentFields />
                    <button className="b b-primary" type="submit">
                      Upload
                    </button>
                  </form>
                </section>
              )}
              {editing && (
                <section className="reveal-panel" aria-labelledby="edit-file">
                  <Link className="b b-ghost b-small reveal-close" href={`/app/clients/${client.id}?tab=files`} scroll={false}>
                    Close
                  </Link>
                  <h3 id="edit-file">Correct {editing.name}</h3>
                  <p className="hint">The file moves to the folder and name these give, in your firm&apos;s drive.</p>
                  <form action={manageDocument} className="fields">
                    <input type="hidden" name="document" value={editing.id} />
                    <DocumentFields type={editing.document_type} work={editing.work_type} period={editing.period_key} />
                    <button className="b b-primary" name="intent" value="save">
                      Save
                    </button>
                  </form>
                </section>
              )}
              {documents.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Work</th>
                        <th scope="col">Received</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="shrink">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((document) => (
                        <tr key={document.id}>
                          <td>
                            <span className="who">
                              <FileText size={16} aria-hidden className="file-icon" />
                              {owner ? (
                                <a className="row-link" href={`/app/files/${document.id}`} target="_blank" rel="noopener">
                                  {document.name}
                                </a>
                              ) : (
                                <span className="name">{document.name}</span>
                              )}
                            </span>
                            <span className="sub">
                              {[document.document_type, periodName(document.period_key), document.status === "to_check" && sameAs(document)].filter(Boolean).join(", ")}
                            </span>
                          </td>
                          <td className="shrink">{workTypes[document.work_type as WorkType]}</td>
                          <td className="shrink hint">{dueLabel(document.received_at.slice(0, 10))}</td>
                          <td className="shrink">
                            <Badge tone={document.status === "to_check" ? "warn" : "done"}>{document.status === "to_check" ? "To check" : "Filed"}</Badge>
                          </td>
                          <td className="shrink">
                            <span className="cell-form">
                              {document.status === "to_check" && (
                                <form action={manageDocument}>
                                  <input type="hidden" name="document" value={document.id} />
                                  <input type="hidden" name="type" value={document.document_type} />
                                  <input type="hidden" name="work" value={document.work_type} />
                                  <input type="hidden" name="period" value={document.period_key} />
                                  <button className="b b-secondary b-small" name="intent" value="save" aria-label={`Confirm ${document.name}`}>
                                    Confirm
                                  </button>
                                </form>
                              )}
                              <Link className="b b-ghost b-small" href={`/app/clients/${client.id}?tab=files&edit=${document.id}`} scroll={false} aria-label={`Change ${document.name}`}>
                                Change
                              </Link>
                              {owner && (
                                <form action={removeDocument}>
                                  <input type="hidden" name="document" value={document.id} />
                                  <button className="b b-ghost b-small" name="intent" value="remove" aria-label={`Remove ${document.name}`}>
                                    Remove
                                  </button>
                                </form>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty Icon={FileText} title="No files yet">
                  <span>Attachments this client emails are saved here, in your firm&apos;s drive, once the email and the drive are connected.</span>
                </Empty>
              )}
              {owner && !!removedFiles.length && (
                <>
                  <h3 className="sub-head">Removed in the last 30 days</h3>
                  <ul className="rows">
                    {removedFiles.map((document) => (
                      <li key={document.id}>
                        <FileText size={16} aria-hidden className="file-icon" />
                        <span className="grow name">{document.name}</span>
                        <form action={removeDocument}>
                          <input type="hidden" name="document" value={document.id} />
                          <button className="b b-ghost b-small" name="intent" value="restore">
                            Put back
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {tab === "due" && (
            <section className="panel" aria-labelledby="due">
              <h2 id="due">Due dates</h2>
              {tasks?.some((task) => !rule.get(task.code ?? "")?.verified_on) && <p className="hint">Dates marked * are not yet confirmed by a CA against the official notification.</p>}
              {tasks?.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th scope="col">Return</th>
                        <th scope="col">Period</th>
                        <th scope="col">Due</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((task) => {
                        const r = rule.get(task.code ?? "");
                        const late = task.status !== "filed" && task.due_on < todayInIndia();
                        return (
                          <tr key={task.id}>
                            <td>{r?.name}</td>
                            <td className="hint">{periodLabel(r?.frequency ?? null, task.period_key)}</td>
                            <td className="shrink">
                              {dueLabel(task.due_on)}
                              {!r?.verified_on && "*"}
                            </td>
                            <td className="shrink">
                              <Badge tone={task.status === "filed" ? "done" : late ? "late" : task.status === "in_progress" ? "blue" : ""}>
                                {late ? "Overdue" : taskStatuses[task.status as keyof typeof taskStatuses]}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint">No due dates yet. Add a number and choose its services.</p>
              )}
            </section>
          )}
          {tab === "contacts" && (
            <section className="panel" aria-labelledby="contacts">
              <h2 id="contacts">Contact people</h2>
              <p className="hint">People who write for this client. InboxCA recognises their emails, and sends documents only to those allowed.</p>
              <ul className="rows">
                {contacts.map((contact) => (
                  <li key={contact.contact_id}>
                    <span className="name">
                      {contact.name}
                      <span className="sub">
                        {contact.email}
                        {contact.relation && `, ${contact.relation}`}
                      </span>
                    </span>
                    {manage ? (
                      <form key={`${contact.can_view_status}${contact.can_receive_documents}`} action={manageClient} className="end">
                        {hidden}
                        <input type="hidden" name="contact" value={contact.contact_id} />
                        <label className="check">
                          <input type="checkbox" name="can_view_status" defaultChecked={contact.can_view_status} /> Sees work status
                        </label>
                        <label className="check">
                          <input type="checkbox" name="can_receive_documents" defaultChecked={contact.can_receive_documents} /> Receives documents
                        </label>
                        <button className="b b-secondary" name="intent" value="contact-rights">
                          Save
                        </button>
                        <button className="b b-ghost b-small" name="intent" value="unlink-contact">
                          Remove
                        </button>
                      </form>
                    ) : (
                      <span className="end">{[contact.can_view_status && "Sees work status", contact.can_receive_documents && "Receives documents"].filter(Boolean).join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
              {!contacts.length && <p className="hint">No contact people yet.</p>}
              {manage && (
                <form action={manageClient} className="fields">
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
                  <label className="check">
                    <input type="checkbox" name="can_view_status" /> Sees work status
                  </label>
                  <label className="check">
                    <input type="checkbox" name="can_receive_documents" /> Receives documents
                  </label>
                  <button className="b b-secondary" name="intent" value="add-contact">
                    Add contact
                  </button>
                </form>
              )}
            </section>
          )}
          {tab === "team" && (
            <section className="panel" aria-labelledby="assigned">
              <h2 id="assigned">Assigned to</h2>
              <ul className="rows">
                {assigned.map((assignment) => (
                  <li key={assignment.value}>
                    <span className="name">{labelOf.get(assignment.value)}</span>
                    <span className="end">
                      {assignmentRoles[assignment.role as keyof typeof assignmentRoles]}
                      {manage && (
                        <form action={manageClient}>
                          {hidden}
                          <input type="hidden" name="who" value={assignment.value} />
                          <button className="b b-ghost b-small" name="intent" value="unassign">
                            Unassign
                          </button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {!client.client_assignments.length && <p className="hint">Nobody is assigned yet.</p>}
              {manage && !!unassigned.length && (
                <form action={manageClient} className="form-row">
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
                  <button className="b b-secondary" name="intent" value="assign">
                    Assign
                  </button>
                </form>
              )}
            </section>
          )}
          {tab === "details" && manage && (
            <section className="panel" aria-labelledby="details">
              <h2 id="details">Details</h2>
              <form action={manageClient} className="fields">
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
                <button className="b b-primary" name="intent" value="details">
                  Save details
                </button>
              </form>
            </section>
          )}
        </div>
        <aside className="record-side" aria-labelledby="props">
          <h2 id="props">Details</h2>
          <dl className="props">
            <div>
              <dt>Kind</dt>
              <dd>{clientKinds[client.kind as ClientKind]}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{email || <span className="hint">None yet</span>}</dd>
            </div>
            <div>
              <dt>Group</dt>
              <dd>{groupName ? <Link href={`/app/clients?group=${client.group_id}`}>{groupName}</Link> : <span className="hint">None</span>}</dd>
            </div>
            {!!branches.length && (
              <div>
                <dt>Branch</dt>
                <dd>{branchName ? <Link href={`/app/clients?branch=${client.branch_id}`}>{branchName}</Link> : <span className="hint">None</span>}</dd>
              </div>
            )}
            {numbers.map((registration) => (
              <div key={registration.id}>
                <dt>{numberKinds[registration.kind as NumberKind].name}</dt>
                <dd className="num">{registration.number}</dd>
              </div>
            ))}
            <div>
              <dt>Status</dt>
              <dd>{client.archived_at ? <Badge tone="late">Archived</Badge> : <Badge tone="done">Active</Badge>}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}

// Type, work and period for a file, filled in when correcting one.
function DocumentFields({ type = "", work = "other", period = "" }: { type?: string; work?: string; period?: string }) {
  const known = !type || documentTypes.includes(type);
  return (
    <>
      <div>
        <label htmlFor="file-type">Type</label>
        <select id="file-type" name="type" defaultValue={known ? type || "Document" : "Other"}>
          {documentTypes.map((choice) => (
            <option key={choice}>{choice}</option>
          ))}
          <option value="Other">Other, named below</option>
        </select>
      </div>
      <div>
        <label htmlFor="file-custom">Name for Other</label>
        <input id="file-custom" name="custom" maxLength={80} defaultValue={known ? "" : type} placeholder="HDFC loan sanction letter" />
      </div>
      <div>
        <label htmlFor="file-work">Work</label>
        <select id="file-work" name="work" defaultValue={work}>
          {Object.entries(workTypes).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="file-period">Period</label>
        <select id="file-period" name="period" defaultValue={period}>
          <option value="">No period</option>
          {periodChoices(todayInIndia()).map((choice) => (
            <option key={choice} value={choice}>
              {periodName(choice)}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
