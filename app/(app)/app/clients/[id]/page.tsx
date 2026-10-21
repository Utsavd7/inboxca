import { SalesInput } from "./sales-input";
import { DatasetReview } from "./dataset-review";
import { Archive, ChevronLeft, FileText, Send, Upload } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setPaperSharing, askForDocuments, askPermission, findDocuments, manageClient, pauseReminders, manageDocument, removeDocument, sendDocument, uploadDocument } from "@/app/(app)/actions";
import { dueLabel, periodLabel, taskStatuses, todayInIndia } from "@/src/lib/calendar";
import { assignmentRoles, canManageClients, clientKinds, type ClientKind } from "@/src/lib/clients";
import { checklists, workOfService, type DocumentRequest } from "@/src/lib/checklists";
import { skipReasons, type Skip } from "@/src/lib/reminders";
import { type Right } from "@/src/lib/rights";
import { serverCrypto } from "@/src/lib/crypto";
import { documentTypes, periodChoices, periodName } from "@/src/lib/documents";
import { workTypes, type WorkType } from "@/src/lib/drive";
import { authorities, noticeStatuses, type NoticeDetails } from "@/src/lib/notices";
import { numberKinds, type NumberKind } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";
import { LinkTabs } from "../../link-tabs";
import { DroppedNotice, PortalDrop } from "../../portal-drop";
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
  needs: "This needs permission first. Ask, and the button appears here once it is allowed.",
  asked: "You already have several questions waiting. Wait for an answer first.",
  ask: "Tick at least one document, or name one, to ask for.",
  recipient: "Choose who gets the file: the client's own email, or a contact allowed to receive documents.",
  mailbox: "The file could not be emailed. Connect the firm's email in Settings, or try again in a minute.",
};

// What reminders did for a return: when it was last reminded, or why it was not.
const reminderNote = (details: { reminded?: string[]; skipped?: { reason: string } }) =>
  details.reminded?.length ? `Reminded ${dueLabel(details.reminded.at(-1)!)}` : details.skipped ? skipReasons[details.skipped.reason as Skip] : "";

// One client. Its numbers are opened with the firm's key on the server, for this page only.
export default async function Client({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; tab?: string; page?: string; show?: string; draft?: string; line?: string; check?: string; source?: string; section?: string; header?: string; read?: string; edit?: string; renamed?: string; saved?: string; removed?: string; upload?: string; dropped?: string; ask?: string; asked?: string; send?: string; shared?: string; find?: string; asked_right?: string }> }) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ id }, { error, tab: asked, page: askedPage, show, draft, line, check, source, section, header, read, edit, renamed, saved, removed, upload, dropped, ask, asked: askedFor, send, shared, find, asked_right: askedRight }] = await Promise.all([params, searchParams]);
  const page = /^\d{1,6}$/.test(askedPage ?? "") ? Math.max(1,Number(askedPage)) : 1;
  const start = (page-1)*50;
  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, name, kind, archived_at, email_enc, group_id, branch_id, reminders_paused, client_registrations(id, kind, number_enc, services), client_assignments(user_id, team_id, role), contact_clients(contact_id, relation, can_view_status, can_receive_documents, contacts(name_enc, email_enc))",
    )
    .eq("id", id)
    .eq("firm_id",membership.firmId)
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
  const [{ data: people }, { data: groups }, { data: rules }, { data: tasks, count: taskCount }, { data: files }, { data: asks }, { data: notices, count: noticeCount }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "client_group", "branch"]).order("name"),
    supabase.from("compliance_types").select("code, name, frequency, due_rule, verified_on").eq("period_key", "").order("code"),
    supabase.from("tasks").select("id, code, period_key, due_on, status, details",{count:"exact"}).eq("firm_id",membership.firmId).eq("kind", "compliance").eq("client_id", id).filter("status",show==="filed" ? "eq" : "neq","filed").order("due_on",{ascending:show!=="filed"}).order("id").range(start,start+49),
    supabase.from("documents").select("id, name, document_type, work_type, period_key, status, share_policy, sha256, received_at").eq("client_id", id).order("received_at", { ascending: false }).limit(500),
    supabase.from("requests").select("id, expires_at, details").eq("kind", "documents").eq("client_id", id).eq("status", "pending").gt("expires_at", new Date().toISOString()),
    supabase.from("tasks").select("id,due_on,status,details",{count:"exact"}).eq("firm_id",membership.firmId).eq("client_id",id).eq("kind","notice").order("due_on").order("id").range(start,start+49),
  ]);
  const {count:drafts}=await supabase.from("datasets").select("id",{count:"exact",head:true}).eq("firm_id",membership.firmId).eq("client_id",id);
  const activity = asked==="activity" ? await supabase.rpc("client_activity",{target_client:id}) : null;
  if (activity?.error) throw new Error("Client activity could not be read");
  // The lists for the work this client's services need are ticked when asking for files.
  const usualWork = new Set(client.client_registrations.flatMap((registration) => (registration.services ?? []).map(workOfService)));
  // A search keeps only the files whose words include every word typed.
  const matching = find?.trim() ? new Set((await findDocuments(find, id)).map((file) => file.id)) : null;
  const documents = (files ?? []).filter((file) => file.status !== "deleted" && (!matching || matching.has(file.id)));
  const removedFiles = (files ?? []).filter((file) => file.status === "deleted");
  const owner = membership.role === "owner";
  // What this person may do here, with any grant or request of theirs still open (5.17.2).
  const { data: mine } = await supabase
    .from("requests")
    .select("reason_code, status, details")
    .eq("kind", "permission")
    .eq("client_id", id)
    .eq("details->>by", userId)
    .in("status", ["pending", "approved"])
    .gt("expires_at", new Date().toISOString());
  const open = (right: Right, status: string, documentId?: string) =>
    (mine ?? []).some((request) => request.reason_code === right && request.status === status && (!documentId || (request.details as { document_id?: string }).document_id === documentId));
  // A personal device allowed away from the office only views.
  const viewOnly = !!membership.viewOnlyUntil;
  const canUpload = !viewOnly && (membership.may("upload") || open("upload", "approved"));
  const canSend = (documentId: string) => !viewOnly && (membership.may("send") || open("send", "approved", documentId));
  const canRemove = (documentId: string) => !viewOnly && (owner || open("remove", "approved", documentId));
  const askButton = (right: Right, label: string, documentId?: string) =>
    viewOnly ? null : open(right, "pending", documentId) ? (
      <span className="hint">Asked</span>
    ) : (
      <form action={askPermission}>
        <input type="hidden" name="client" value={client.id} />
        <input type="hidden" name="right" value={right} />
        {documentId && <input type="hidden" name="document" value={documentId} />}
        <button className="b b-ghost b-small" aria-label={documentId ? `${label}: ${documents.find((file) => file.id === documentId)?.name}` : label}>
          {label}
        </button>
      </form>
    );
  // A file waiting to be checked because the client already has it, or one like it.
  const sameAs = (file: (typeof documents)[number]) => {
    const twin = documents.find((other) => other.id !== file.id && other.sha256 === file.sha256);
    if (twin) return `Same file as ${twin.name}`;
    const like = file.period_key && documents.find((other) => other.id !== file.id && other.document_type === file.document_type && other.period_key === file.period_key);
    return like ? `Same type and period as ${like.name}` : "";
  };
  const editing = documents.find((file) => file.id === edit);
  const noticeFile = (files ?? []).find((file) => file.id === (renamed ?? saved ?? removed));
  const sending = documents.find((file) => file.id === send && file.share_policy !== "internal");
  const sharedFile = documents.find((file) => file.id === shared);
  const receivers = contacts.filter((contact) => contact.can_receive_documents);
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
    ["due", "Due dates", taskCount ?? 0],
    ["notices", "Notices", noticeCount ?? 0],
    ...(drafts || documents.some((file)=>file.work_type==="gst" && file.status==="filed" && /\.(xlsx?|csv)$/i.test(file.name)) ? [["extraction", "Extraction", drafts ?? undefined] as [string,string,number]] : []),
    ["activity", "Activity"],
    ["contacts", "Contacts", contacts.length],
    ["team", "Team", client.client_assignments.length],
    ...(manage ? ([["details", "Details"]] as [string, string][]) : []),
  ];
  const tab = tabs.some(([key]) => key === asked) ? asked! : "overview";
  const pager = (total: number, rows: number, label: string) => (
    <nav className="pager" aria-label={`${label} pages`}>
      <p>Showing {rows ? (start + 1).toLocaleString("en-IN") : 0} to {rows ? (start + rows).toLocaleString("en-IN") : 0} of {total.toLocaleString("en-IN")} {label.toLowerCase()}</p>
      <span>
        {page > 1 && <Link className="b b-secondary b-small" href={`?tab=${tab}&page=${page - 1}${show === "filed" ? "&show=filed" : ""}`}>Previous</Link>}
        {start + rows < total && <Link className="b b-secondary b-small" href={`?tab=${tab}&page=${page + 1}${show === "filed" ? "&show=filed" : ""}`}>Next</Link>}
      </span>
    </nav>
  );
  const activityNames: Record<string, string> = {
    "dataset.created": "Figures ready to check", "dataset.checked": "Figure checked", "dataset.changed": "Figure corrected",
    "client.added": "Client added", "client.changed": "Client details changed",
    "registration.added": "Number added", "registration.changed": "Services changed", "registration.removed": "Number removed",
    "assignment.added": "Person or team assigned", "assignment.removed": "Assignment removed",
    "contact_link.added": "Contact linked", "contact_link.changed": "Contact permissions changed", "contact_link.removed": "Contact removed",
    "task.changed": "Return or notice updated", "document.viewed": "Document viewed",
    "document.uploaded": "Document uploaded", "document.filed": "Document filed", "document.renamed": "Document renamed",
    "document.deleted": "Document removed", "document.shared": "Document shared", "document.downloaded": "Document downloaded",
    "reminder.sent": "Reminder sent", "email.changed": "Email label corrected",
    "email.acknowledged": "Files received reply sent", "request.changed": "Request updated",
  };
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
                <span className="page-actions">
                  <Link className="b b-secondary b-small" href={`/app/clients/${client.id}?tab=files&ask=1`} scroll={false}>
                    <Send size={14} aria-hidden />
                    Ask for files
                  </Link>
                  {canUpload ? (
                    <Link className="b b-secondary b-small" href={`/app/clients/${client.id}?tab=files&upload=1`} scroll={false}>
                      <Upload size={14} aria-hidden />
                      Upload a file
                    </Link>
                  ) : (
                    askButton("upload", "Ask to upload")
                  )}
                </span>
              </div>
              <p className="hint">Saved in your firm&apos;s drive. Files marked To check need a person to confirm their type or period.</p>
              <form className="toolbar files-find" role="search">
                <input type="hidden" name="tab" value="files" />
                <input name="find" defaultValue={find} placeholder="Find a file by a word in it or its name" aria-label="Find a file" />
                <button className="b b-secondary" type="submit">
                  Find
                </button>
                {find && (
                  <Link className="b b-ghost" href={`/app/clients/${client.id}?tab=files`}>
                    Show all
                  </Link>
                )}
              </form>
              <PortalDrop clientId={client.id} />
              <DroppedNotice value={dropped} />
              {askedRight && (
                <p className="notice" role="status">
                  Asked. Your manager or the owner answers in their Inbox; the button appears here once it is allowed, for one use within an hour.
                </p>
              )}
              {sharedFile && (
                <p className="notice" role="status">
                  Sent {sharedFile.name}. The link works for 7 days and 5 downloads.
                </p>
              )}
              {sending && canSend(sending.id) && (
                <section className="reveal-panel" aria-labelledby="send-file">
                  <Link className="b b-ghost b-small reveal-close" href={`/app/clients/${client.id}?tab=files`} scroll={false}>
                    Close
                  </Link>
                  <h3 id="send-file">Send {sending.name}</h3>
                  <p className="hint">Emailed from your firm&apos;s address as a secure link that works for 7 days and 5 downloads.</p>
                  <form action={sendDocument} className="send-to">
                    <input type="hidden" name="document" value={sending.id} />
                    {email && (
                      <label className="check">
                        <input type="radio" name="to" value="client" defaultChecked />
                        {client.name}, {email}
                      </label>
                    )}
                    {receivers.map((contact) => (
                      <label key={contact.contact_id} className="check">
                        <input type="radio" name="to" value={contact.contact_id} defaultChecked={!email && contact === receivers[0]} />
                        {contact.name}, {contact.email}
                      </label>
                    ))}
                    {!email && !receivers.length && <p className="hint">Add the client&apos;s email on Details, or a contact who may receive documents, to send files.</p>}
                    <button className="b b-primary" type="submit" disabled={!email && !receivers.length}>
                      <Send size={14} aria-hidden />
                      Send
                    </button>
                  </form>
                </section>
              )}
              {askedFor && (
                <p className="notice" role="status">
                  {askedFor === "sent" ? (
                    "The client was emailed a private upload link. What they upload is saved here."
                  ) : (
                    <span>
                      Send the client this private upload link; it is shown only now and works for 30 days: <span className="num link-once">{askedFor}</span>
                    </span>
                  )}
                </p>
              )}
              {ask && (
                <section className="reveal-panel" aria-labelledby="ask-files">
                  <Link className="b b-ghost b-small reveal-close" href={`/app/clients/${client.id}?tab=files`} scroll={false}>
                    Close
                  </Link>
                  <h3 id="ask-files">Ask {client.name} for files</h3>
                  <p className="hint">The client gets a private link to upload them, no sign in needed. It works for 30 days.</p>
                  <form action={askForDocuments}>
                    <input type="hidden" name="client" value={client.id} />
                    <div className="ask-groups">
                      {Object.entries(checklists).map(([work, list]) => (
                        <fieldset key={work}>
                          <legend>{workTypes[work as WorkType]}</legend>
                          {list.map((type) => (
                            <label key={type} className="check">
                              <input type="checkbox" name="item" value={`${work}:${type}`} defaultChecked={usualWork.has(work as WorkType)} />
                              {type}
                            </label>
                          ))}
                        </fieldset>
                      ))}
                    </div>
                    <div className="fields">
                      <div>
                        <label htmlFor="ask-others">Anything else, by name</label>
                        <input id="ask-others" name="others" maxLength={400} placeholder="Loan statement, Property tax receipt" />
                      </div>
                      <div>
                        <label htmlFor="ask-period">For</label>
                        <select id="ask-period" name="period" defaultValue={periodChoices(todayInIndia())[1]}>
                          <option value="">No period</option>
                          {periodChoices(todayInIndia()).map((choice) => (
                            <option key={choice} value={choice}>
                              {periodName(choice)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button className="b b-primary" type="submit">
                        Ask for files
                      </button>
                    </div>
                  </form>
                </section>
              )}
              {!!asks?.length && (
                <ul className="rows asks" aria-label="Files asked for">
                  {asks.map((request) => {
                    const details = request.details as unknown as DocumentRequest;
                    const got = details.items.filter((item) => item.received.length).length;
                    return (
                      <li key={request.id}>
                        <Send size={16} aria-hidden className="file-icon" />
                        <span className="grow">
                          <span className="name">
                            Asked for {details.items.map((item) => item.type).join(", ")}
                            {details.period && ` for ${periodName(details.period)}`}
                          </span>
                          <span className="sub">
                            {got} of {details.items.length} received. The link works until {dueLabel(request.expires_at!.slice(0, 10))}.
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
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
              {upload && canUpload && (
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
                  {owner && <form key={editing.share_policy ?? "firm"} action={setPaperSharing} className="form-row">
                    <input type="hidden" name="document" value={editing.id} />
                    <div><label htmlFor="paper-sharing">Sending this paper</label><select id="paper-sharing" name="policy" defaultValue={editing.share_policy ?? ""}><option value="">Use the firm&apos;s choice</option><option value="auto">Routine paper</option><option value="approval">Ask before sending</option><option value="internal">Keep inside the firm</option></select></div>
                    <button className="b b-secondary">Save sending choice</button>
                  </form>}
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
                              <Link className="row-link" href={`/app/files/${document.id}/view`}>
                                {document.name}
                              </Link>
                            </span>
                            <span className="sub">
                              {[document.document_type, periodName(document.period_key), document.status === "to_check" && sameAs(document)].filter(Boolean).join(", ")}
                            </span>
                          </td>
                          <td className="shrink">{workTypes[document.work_type as WorkType]}</td>
                          <td className="shrink hint">{dueLabel(document.received_at.slice(0, 10))}</td>
                          <td className="shrink">
                            <Badge tone={document.status === "to_check" ? "warn" : document.status === "missing" ? "late" : "done"}>
                              {document.status === "to_check" ? "To check" : document.status === "missing" ? "Missing in the drive" : "Filed"}
                            </Badge>
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
                              {document.status === "filed" && document.share_policy !== "internal" &&
                                (canSend(document.id) ? (
                                  <Link className="b b-ghost b-small" href={`/app/clients/${client.id}?tab=files&send=${document.id}`} scroll={false} aria-label={`Send ${document.name}`}>
                                    Send
                                  </Link>
                                ) : (
                                  askButton("send", "Ask to send", document.id)
                                ))}
                              {!canRemove(document.id) && askButton("remove", "Ask to remove", document.id)}
                              {canRemove(document.id) && (
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
              <p className="hint"><Link href={`?tab=due${show==="filed" ? "" : "&show=filed"}`}>{show==="filed" ? "Show returns still to file" : "Show filed returns"}</Link></p>
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
                              <span className="sub">{reminderNote(task.details as { reminded?: string[]; skipped?: { reason: string } })}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint">{show==="filed" ? "No filed returns on this page." : "No due dates on this page. Add a number and choose its services."}</p>
              )}
              {pager(taskCount ?? 0,tasks?.length ?? 0,"Returns")}
            </section>
          )}
          {tab === "notices" && (
            <section className="panel" aria-labelledby="client-notices">
              <h2 id="client-notices">Notices</h2>
              <p className="hint">Review a suggested date against the notice before confirming it. <Link href="/app/notices">Open the notice tracker</Link></p>
              {notices?.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th scope="col">Notice</th><th scope="col">Received</th><th scope="col">Action date</th><th scope="col">Status</th></tr></thead>
                    <tbody>{notices.map((notice) => {
                      const details = notice.details as unknown as NoticeDetails;
                      return (
                        <tr key={notice.id}>
                          <td>{details.notice_type}<span className="sub">{[authorities[details.authority], details.reference].filter(Boolean).join(", ")}</span></td>
                          <td>{dueLabel(details.received_on)}</td>
                          <td>{details.action_date ? dueLabel(details.action_date) : <Badge tone="warn">Review by {dueLabel(notice.due_on)}</Badge>}</td>
                          <td>{noticeStatuses[notice.status as keyof typeof noticeStatuses]}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              ) : <p className="hint">No notices on this page.</p>}
              {pager(noticeCount ?? 0, notices?.length ?? 0, "Notices")}
            </section>
          )}
          {tab === "activity" && (
            <section className="panel" aria-labelledby="client-activity">
              <h2 id="client-activity">Activity</h2>
              <p className="hint">The latest 50 changes for this client.</p>
              {activity?.data?.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th scope="col">When</th><th scope="col">What happened</th><th scope="col">Who</th></tr></thead>
                    <tbody>{activity.data.map((entry, index) => (
                      <tr key={index}>
                        <td className="shrink num">{new Date(entry.at).toLocaleString("en-IN", {timeZone:"Asia/Kolkata", day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:false})}</td>
                        <td>{activityNames[entry.action] ?? "Client record changed"}</td>
                        <td>{entry.actor_id ? people?.find((person) => person.user_id === entry.actor_id)?.email ?? "Former team member" : "InboxCA"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="hint">No changes recorded yet.</p>}
            </section>
          )}
          {tab === "extraction" && <><DatasetReview clientId={id} draftId={draft} lineId={line} check={check}/><SalesInput clientId={id} source={source} section={section} header={header} read={read}/></>}
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
            <section className="panel" aria-labelledby="pause-title">
              <h2 id="pause-title">Reminders</h2>
              <form action={pauseReminders} className="form-row">
                <input type="hidden" name="client" value={client.id} />
                <label className="check">
                  <input type="checkbox" name="paused" defaultChecked={client.reminders_paused} />
                  Pause reminders for this client
                </label>
                <button className="b b-secondary" type="submit">
                  Save
                </button>
              </form>
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
