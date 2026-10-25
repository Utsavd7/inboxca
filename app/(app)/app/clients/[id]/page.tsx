import {PreparedForms} from "../../prepared-forms";
import { PortalInput } from "./portal-input";
import { SalesInput } from "./sales-input";
import { DatasetReview } from "./dataset-review";
import { FileText } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setPaperSharing, askForDocuments, askPermission, checkRequestItem, findDocuments, manageClient, manageNotice, manageTasks, pauseReminders, manageDocument, removeDocument, saveChecklist, sendDocument } from "@/app/(app)/actions";
import { addDays, dueLabel, periodLabel, taskStatuses, todayInIndia } from "@/src/lib/calendar";
import { assignmentRoles, canManageClients, clientKinds, type ClientKind } from "@/src/lib/clients";
import { checklists, kindChecklist, workOfService, type DocumentRequest } from "@/src/lib/checklists";
import { skipReasons, type Skip } from "@/src/lib/reminders";
import { type Right } from "@/src/lib/rights";
import { serverCrypto } from "@/src/lib/crypto";
import { documentTypes, folderFor, periodChoices, periodName, receivedLabel, workOfType } from "@/src/lib/documents";
import { workTypes, type FolderOrder, type WorkType } from "@/src/lib/drive";
import { authorities, noticeStatuses, type NoticeDetails } from "@/src/lib/notices";
import { numberKinds, type NumberKind } from "@/src/lib/identifiers";
import { mailLive } from "@/src/lib/mail-live";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { supabaseAdmin } from "@/src/lib/supabase";
import { labels, type Label } from "@/src/lib/triage";
import { AutoSelect } from "../../auto-select";
import { LinkTabs } from "../../link-tabs";
import { DroppedNotice, PortalDrop } from "../../portal-drop";
import { MarkFiled } from "../../mark-filed";
import { Badge, Empty, PageHead, SidePanel, Toast } from "../../ui";
import { UploadForm } from "./upload-form";
import "../clients.css";

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
  gstin: "Choose the GSTIN this GST paper is for.",
  list: "Put one paper on each line, up to 30, each up to 80 letters and without a colon.",
  owner: "Only the owner can remove a file.",
  needs: "This needs permission first. Ask, and the button appears here once it is allowed.",
  asked: "You already have several questions waiting. Wait for an answer first.",
  ask: "Tick at least one document, or name one, to ask for.",
  recipient: "Choose who gets the file: the client's own email, or a contact allowed to receive documents.",
  mailbox: "The file could not be emailed. Connect the firm's email in Settings, or try again in a minute.",
  notice: "Choose the authority and the day the notice was received.",
};

// What reminders did for a return: when it was last reminded, or why it was not.
const reminderNote = (details: { reminded?: string[]; skipped?: { reason: string } }) =>
  details.reminded?.length ? `Reminded ${dueLabel(details.reminded.at(-1)!)}` : details.skipped ? skipReasons[details.skipped.reason as Skip] : "";
// "24 Oct, 10:05" in India time, for an email.
const mailTime = (at: string) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

// The five tabs. Older addresses (and each save) still arrive with the tab they had before:
// files, due dates, figures and forms open their tab; the rest open Overview with their panel.
const mains = { overview: "Overview", emails: "Emails", documents: "Documents", returns: "Returns", notices: "Notices" } as const;
type Main = keyof typeof mains;
const tabOf: Record<string, Main> = { files: "documents", due: "returns", extraction: "returns", outputs: "returns", notice: "notices", numbers: "overview", services: "overview", contacts: "overview", team: "overview", details: "overview", activity: "overview" };
const panels = ["notice", "numbers", "services", "contacts", "team", "details", "activity"];
const lookAfter = ["partner_in_charge", "manager", "staff"];
const uuid = /^[0-9a-f-]{36}$/;
const taskChanges: Record<string, string> = { filed: "marked filed", in_progress: "marked in progress", reopen: "marked not filed" };

// One client. Its numbers are opened with the firm's key on the server, for this page only.
export default async function Client({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; tab?: string; form?:string; page?: string; show?: string; draft?: string; line?: string; check?: string; source?: string; section?: string; header?: string; read?: string; portal?: string; edit?: string; renamed?: string; saved?: string; removed?: string; upload?: string; dropped?: string; ask?: string; asked?: string; send?: string; shared?: string; find?: string; asked_right?: string; task?: string; marked?: string; t?: string }> }) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ id }, { error, form:formMessage, tab: asked, page: askedPage, show, draft, line, check, source, section, header, read, portal, edit, renamed, saved, removed, upload, dropped, ask, asked: askedFor, send, shared, find, asked_right: askedRight, task: marking, marked, t: markedIds }] = await Promise.all([params, searchParams]);
  const tab: Main = asked && asked in mains ? (asked as Main) : tabOf[asked ?? ""] ?? "overview";
  const sub = asked === "extraction" || asked === "outputs" ? asked : tab;
  const panel = panels.includes(asked ?? "") ? asked! : "";
  const page = /^\d{1,6}$/.test(askedPage ?? "") ? Math.max(1,Number(askedPage)) : 1;
  const start = (page-1)*50;
  const today = todayInIndia();
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
  const mailRange = tab === "emails" ? start : 0;
  const [{ data: people }, { data: groups }, { data: rules }, { data: tasks, count: taskCount }, { data: files }, { data: asks }, { data: notices, count: noticeCount }, { data: late, count: lateCount }, { data: mails, count: mailCount }, { data: drive }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "client_group", "branch"]).order("name"),
    supabase.from("compliance_types").select("code, name, frequency, due_rule, verified_on").eq("period_key", "").order("code"),
    supabase.from("tasks").select("id, code, period_key, due_on, status, details",{count:"exact"}).eq("firm_id",membership.firmId).eq("kind", "compliance").eq("client_id", id).filter("status",show==="filed" ? "eq" : "neq","filed").order("due_on",{ascending:show!=="filed"}).order("id").range(start,start+49),
    supabase.from("documents").select("id, name, document_type, work_type, period_key, status, share_policy, sha256, received_at, prepared, email_event_id, registration_id").eq("client_id", id).order("received_at", { ascending: false }).limit(500),
    supabase.from("requests").select("id, expires_at, details").eq("kind", "documents").eq("client_id", id).in("status", ["pending", "done"]).gt("expires_at", new Date().toISOString()),
    supabase.from("tasks").select("id,due_on,status,details",{count:"exact"}).eq("firm_id",membership.firmId).eq("client_id",id).eq("kind","notice").order("due_on").order("id").range(start,start+49),
    supabase.from("tasks").select("id, code, due_on",{count:"exact"}).eq("firm_id",membership.firmId).eq("kind","compliance").eq("client_id",id).neq("status","filed").lt("due_on",today).order("due_on").limit(3),
    supabase.from("email_events").select("id, contact_id, received_at, label, delivery, provider_message_id, contacts(name_enc)",{count:"exact"}).eq("firm_id",membership.firmId).eq("client_id",id).order("received_at",{ascending:false}).order("id").range(mailRange, mailRange + (tab === "emails" ? 49 : 2)),
    tab === "documents" ? supabaseAdmin().from("connected_accounts").select("settings").eq("firm_id",membership.firmId).eq("kind","drive").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const {count:outputs}=await supabase.from("documents").select("id",{count:"exact",head:true}).eq("firm_id",membership.firmId).eq("client_id",id).not("prepared","is",null).neq("status","deleted");
  const {data:draftForms,count:drafts}=await supabase.from("datasets").select("form_code",{count:"exact"}).eq("firm_id",membership.firmId).eq("client_id",id);
  const activity = panel==="activity" ? await supabase.rpc("client_activity",{target_client:id}) : null;
  if (activity?.error) throw new Error("Client activity could not be read");
  const { data: replies } = mails?.length ? await supabase.from("requests").select("entity_id").eq("kind","team_reply").eq("status","pending").in("entity_id",mails.map((mail)=>mail.id)) : { data: [] };
  const waitingReply = new Set(replies?.map((request) => request.entity_id));
  const senders = new Map(await Promise.all((mails ?? []).map(async (mail) => [mail.id, mail.contacts ? await crypto.decrypt(membership.firmId, `contacts/${mail.contact_id}/name`, mail.contacts.name_enc) : client.name] as const)));
  // The subjects of the emails shown, read live in one call as the Inbox does; the label stands
  // in when the mailbox cannot be read.
  const live = mails?.length && (tab === "overview" || tab === "emails") ? await mailLive(membership.firmId, "list", { inbox: mails.map((mail) => mail.provider_message_id), sent: null }) : null;
  const subjects = new Map(live && !("error" in live) ? live.inbox.map((item) => [item.messageId, item.subject]) : []);
  // The lists for the work this client's services need are ticked when asking for files.
  const usualWork = new Set(client.client_registrations.flatMap((registration) => (registration.services ?? []).map(workOfService)));
  // A search keeps only the files whose words include every word typed.
  const matching = find?.trim() ? new Set((await findDocuments(find, id)).map((file) => file.id)) : null;
  const documents = (files ?? []).filter((file) => file.status !== "deleted" && file.status !== "earlier" && (!matching || matching.has(file.id)));
  const removedFiles = (files ?? []).filter((file) => file.status === "deleted");
  const owner = membership.role === "owner";
  // Requests stay listed until every file the client sent has been checked.
  const asking = (asks ?? []).filter((request) => (request.details as unknown as DocumentRequest).items.some((item) => !item.checked));
  const firmTypes = (membership.settings.document_types ?? []) as string[];
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
  const canRename = !viewOnly && membership.may("rename", id);
  const canUpload = !viewOnly && (membership.may("upload", id) || open("upload", "approved"));
  const canSend = (documentId: string) => !viewOnly && (membership.may("send", id) || open("send", "approved", documentId));
  const canRemove = (documentId: string) => !viewOnly && (owner || open("remove", "approved", documentId));
  const canFile = !viewOnly && membership.may("mark_filed", id);
  // Returns tab: the return being marked filed in the side panel, and the ones just changed.
  const doneIds = markedIds?.split(".").filter((taskId) => uuid.test(taskId)).slice(0, 100) ?? [];
  const [{ data: filing }, { data: done }] = await Promise.all([
    tab === "returns" && canFile && uuid.test(marking ?? "") ? supabase.from("tasks").select("id, code, period_key, due_on").eq("firm_id", membership.firmId).eq("kind", "compliance").eq("client_id", id).eq("id", marking!).neq("status", "filed").maybeSingle() : Promise.resolve({ data: null }),
    tab === "returns" && taskChanges[marked ?? ""] && doneIds.length ? supabase.from("tasks").select("id, code, period_key").eq("firm_id", membership.firmId).eq("client_id", id).in("id", doneIds) : Promise.resolve({ data: null }),
  ]);
  const askButton = (right: Right, label: string, documentId?: string) =>
    viewOnly ? null : open(right, "pending", documentId) ? (
      <span className="hint">Asked</span>
    ) : (
      <form action={askPermission}>
        <input type="hidden" name="client" value={client.id} />
        <input type="hidden" name="right" value={right} />
        {documentId && <input type="hidden" name="document" value={documentId} />}
        <button className="b b-secondary" aria-label={documentId ? `${label}: ${documents.find((file) => file.id === documentId)?.name}` : label}>
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
  // One paper's panel: correct it, send it, remove it. A send that failed comes back to it.
  const paper = documents.find((file) => file.id === (edit ?? send));
  const earlier = (files ?? []).filter((file) => paper && file.status === "earlier" && file.document_type === paper.document_type && file.period_key === paper.period_key && file.registration_id === paper.registration_id);
  const noticeFile = (files ?? []).find((file) => file.id === (renamed ?? saved ?? removed));
  const sharedFile = documents.find((file) => file.id === shared);
  const receivers = contacts.filter((contact) => contact.can_receive_documents);
  // Who a filed paper can go to. Sending is its own step that names the paper and the address.
  const recipients = [...(email ? [{ value: "client", name: client.name, email }] : []), ...receivers.map((contact) => ({ value: contact.contact_id, name: contact.name, email: contact.email }))];
  const sendable = paper?.status === "filed" && paper.share_policy !== "internal";
  const confirmSend = !!paper && paper.id === send && sendable && !viewOnly && !ask && canSend(paper.id) && !!recipients.length;
  const order = ((drive?.settings as { folder_order?: FolderOrder } | undefined)?.folder_order ?? "year_client_work") as FolderOrder;
  const rule = new Map(rules?.map((r) => [r.code, r]));
  // The portal file each open monthly GSTR-3B is read from (PLAN.md 5.3.1): the month's GSTR-2B.
  const months = sub === "returns" ? (tasks ?? []).flatMap((task) => (task.code === "GSTR3B_M" && task.status !== "filed" && task.period_key ? [task.period_key] : [])) : [];
  const { data: statements } = months.length ? await supabase.from("documents").select("period_key").eq("client_id", id).eq("document_type", "GSTR-2B").neq("status", "deleted").in("period_key", months) : { data: [] };
  const needs2b = new Set(months.filter((month) => !statements?.some((row) => row.period_key === month)));
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
    ...(people ?? []).filter((person) => person.status === "active").map((person) => ({ value: `person:${person.user_id}`, label: personName(person.email), email: person.email })),
  ];
  const assigned = client.client_assignments.map((a) => ({ ...a, value: a.team_id ? `team:${a.team_id}` : `person:${a.user_id}` }));
  const labelOf = new Map(choices.map((choice) => [choice.value, choice.label]));
  const unassigned = choices.filter((choice) => !assigned.some((a) => a.value === choice.value));
  const lead = [...client.client_assignments].sort((a, b) => lookAfter.indexOf(a.role) - lookAfter.indexOf(b.role))[0];
  const leadName = lead ? (lead.team_id ? teams?.find((team) => team.id === lead.team_id)?.name : personName(people?.find((person) => person.user_id === lead.user_id)?.email)) : "";
  const gstin = numbers.find((registration) => registration.kind === "gstin")?.number;
  // With more than one GSTIN, a GST paper and a request for papers name theirs.
  const gstins = numbers.filter((registration) => registration.kind === "gstin");
  const gstinChoice = gstins.length > 1 && (
    <div>
      <label htmlFor="gstin-for">GSTIN, for GST papers</label>
      <select id="gstin-for" name="registration" defaultValue="" className="num">
        <option value="">Choose</option>
        {gstins.map((registration) => <option key={registration.id} value={registration.id}>{registration.number}</option>)}
      </select>
    </div>
  );
  // The firm's usual list for this kind of client, then the lists by work, each paper once.
  const kindList = kindChecklist(membership.settings, client.kind);
  const askItems = new Map(kindList.map((type) => [type, `kind:${type}`]));
  for (const [work, list] of Object.entries(checklists)) for (const type of list) if (!askItems.has(type)) askItems.set(type, `${work}:${type}`);
  // Papers for the work this client's services need start ticked; More papers opens when one of its own is.
  const usual = ([type, value]: [string, string]) => usualWork.has(value.startsWith("kind:") ? workOfType(type) : (value.split(":")[0] as WorkType));
  const askBox = (item: [string, string]) => (
    <label key={item[0]} className="check">
      <input type="checkbox" name="item" value={item[1]} defaultChecked={usual(item)} />
      {item[0]}
    </label>
  );
  // Asking is for the month of the next return due for this client, else last month.
  const { data: due } = ask ? await supabase.from("tasks").select("period_key").eq("firm_id", membership.firmId).eq("kind", "compliance").eq("client_id", id).neq("status", "filed").gte("due_on", today).order("due_on").limit(12) : { data: [] };
  const askPeriod = due?.map((task) => task.period_key).find((key) => periodChoices(today).includes(key ?? "")) ?? periodChoices(today)[1];
  const openNotices = (notices ?? []).filter((notice) => ["upcoming", "in_progress"].includes(notice.status));
  const showExtraction = !!drafts || documents.some((file)=>file.work_type==="gst" && file.status==="filed" && /\.(xlsx?|csv|json)$/i.test(file.name));
  const showOutputs = !!draftForms?.some(row=>["GSTR1","GSTR3B"].includes(row.form_code)) || !!outputs;
  const counts: Record<Main, number | undefined> = { overview: undefined, emails: mailCount ?? 0, documents: documents.length, returns: show === "filed" ? undefined : taskCount ?? 0, notices: noticeCount ?? 0 };
  const base = `/app/clients/${client.id}`;
  const here = `${base}${tab === "overview" ? "" : `?tab=${tab}`}`;
  // The Returns tab as it is, for the filing panel and each filing form to come back to.
  const returnsHref = `${base}?tab=returns${show === "filed" ? "&show=filed" : ""}${page > 1 ? `&page=${page}` : ""}`;
  const returnsState = (
    <>
      <input type="hidden" name="client" value={client.id} />
      {show === "filed" && <input type="hidden" name="show" value="filed" />}
      {page > 1 && <input type="hidden" name="page" value={page} />}
    </>
  );
  const pager = (total: number, rows: number, label: string, key: string) => (
    <nav className="pager" aria-label={`${label} pages`}>
      <p>Showing {rows ? (start + 1).toLocaleString("en-IN") : 0} to {rows ? (start + rows).toLocaleString("en-IN") : 0} of {total.toLocaleString("en-IN")} {label.toLowerCase()}</p>
      <span>
        {page > 1 && <Link className="b b-secondary" href={`?tab=${key}&page=${page - 1}${show === "filed" ? "&show=filed" : ""}`}>Previous</Link>}
        {start + rows < total && <Link className="b b-secondary" href={`?tab=${key}&page=${page + 1}${show === "filed" ? "&show=filed" : ""}`}>Next</Link>}
      </span>
    </nav>
  );
  const activityNames: Record<string, string> = {
    "dataset.edit_saved":"Unfinished correction kept", "form.started":"Form preparation started", "form.prepared":"Form prepared", "form.edited_outside":"Corrected form added", "form.downloaded":"Form downloaded for filing", "form.filed":"Form marked filed", "form.approved":"Form approved", "form.rejected":"Form needs a correction",
    "dataset.created": "Figures ready to check", "dataset.checked": "Figure checked", "dataset.changed": "Figure corrected",
    "client.added": "Client added", "client.changed": "Client details changed",
    "registration.added": "Number added", "registration.changed": "Services changed", "registration.removed": "Number removed",
    "assignment.added": "Person or team assigned", "assignment.removed": "Assignment removed",
    "contact_link.added": "Contact linked", "contact_link.changed": "Contact permissions changed", "contact_link.removed": "Contact removed",
    "task.changed": "Return or notice updated", "document.viewed": "Document viewed",
    "document.uploaded": "Document uploaded", "document.filed": "Document filed", "document.renamed": "Document renamed",
    "document.deleted": "Document removed", "document.shared": "Document shared", "document.downloaded": "Document downloaded", "share.code_sent": "Code emailed for a private document",
    "reminder.sent": "Reminder sent", "email.changed": "Email label corrected",
    "email.acknowledged": "Files received reply sent", "request.changed": "Request updated",
    "email.replied": "Reply sent", "email.written": "Email written to the client",
  };
  // Each save returns to the panel it came from.
  const hidden = (back: string) => (
    <>
      <input type="hidden" name="client" value={client.id} />
      <input type="hidden" name="tab" value={back} />
    </>
  );
  const docPanel = !!(paper || (upload && canUpload) || ask);
  const alert = error && errors[error] && (
    <p className="alert" role="alert">
      {errors[error]}
    </p>
  );
  const mailState = (mail: NonNullable<typeof mails>[number]) =>
    waitingReply.has(mail.id) ? <Badge tone="warn">Needs a reply</Badge> : (mail.delivery as { ack?: string }).ack === "sent" ? <Badge tone="done">Replied</Badge> : null;
  const mailRow = (mail: NonNullable<typeof mails>[number]) => (
    <li key={mail.id}>
      <span className="dir">In</span>
      <Link className="grow" href={`/app/inbox?mail=${mail.id}`}>
        <span className="name">{subjects.get(mail.provider_message_id) || (labels[mail.label as Label] ?? "Email")}</span>
        <span className="sub">From {senders.get(mail.id)}, {mailTime(mail.received_at)}</span>
      </Link>
      {mailState(mail)}
    </li>
  );

  return (
    <div className="fill clients-page">
      <PageHead
        crumb={
          <Link className="b b-secondary client-back" href="/app/clients">
            All clients
          </Link>
        }
        title={
          <>
            {client.name} {client.archived_at && <Badge>Archived</Badge>}
          </>
        }
        sub={
          <span className="client-meta">
            {[gstin && <span key="gstin" className="num">{gstin}</span>, leadName && `looked after by ${leadName}`, (contacts[0]?.name || email) && `contact ${contacts[0]?.name || email}`]
              .filter(Boolean)
              .flatMap((part, at) => (at ? [", ", part] : [part]))}
            {!gstin && !leadName && !contacts.length && !email && clientKinds[client.kind as ClientKind]}
          </span>
        }
        actions={
          <>
            {!viewOnly && (
              <Link className="b b-secondary" href={`${here}${here.includes("?") ? "&" : "?"}ask=1`} scroll={false}>
                Ask for papers
              </Link>
            )}
            {(email || contacts.length > 0) && !client.archived_at && (
              <Link className="b b-primary" href={`/app/inbox?compose=${client.id}`}>
                Write to client
              </Link>
            )}
          </>
        }
      />
      <LinkTabs label="Client" items={(Object.keys(mains) as Main[]).map((key) => ({ href: `${base}${key === "overview" ? "" : `?tab=${key}`}`, label: mains[key], count: counts[key], current: tab === key }))} />

      <div key={sub} className="pane pane-in client-pane">
        {!panel && !docPanel && alert}

        {tab === "overview" && (
          <div className="client-grid">
            <div className="client-col">
            <section className="client-card" aria-labelledby="attention">
              <div className="client-card-head"><h2 id="attention">Needs attention</h2></div>
              <ul className="client-rows">
                {late?.map((task) => (
                  <li key={task.id}>
                    <span className="grow"><span className="name">{rule.get(task.code ?? "")?.name ?? task.code} is late</span><span className="sub">Was due {dueLabel(task.due_on)}</span></span>
                    <Badge tone="late">Late</Badge>
                  </li>
                ))}
                {(lateCount ?? 0) > 3 && <li><Link className="grow" href={`${base}?tab=returns`}><span className="name">{(lateCount ?? 0) - 3} more late returns</span></Link></li>}
                {asking.map((request) => {
                  const details = request.details as unknown as DocumentRequest;
                  return (
                    <li key={request.id}>
                      <span className="grow"><span className="name">{details.items.map((item) => item.type).join(", ")}</span><span className="sub">{details.items.filter((item) => item.received.length).length} of {details.items.length} received</span></span>
                      <Badge tone="warn">Asked</Badge>
                    </li>
                  );
                })}
                {openNotices.filter((notice) => !(notice.details as unknown as NoticeDetails).action_date).map((notice) => (
                  <li key={notice.id}>
                    <span className="grow"><span className="name">{(notice.details as unknown as NoticeDetails).notice_type}</span><span className="sub">Check the action date by {dueLabel(notice.due_on)}</span></span>
                    <Badge tone="warn">Notice</Badge>
                  </li>
                ))}
              </ul>
              {!late?.length && !asking.length && !openNotices.some((notice) => !(notice.details as unknown as NoticeDetails).action_date) && <p className="hint">Nothing needs you for this client today.</p>}
            </section>
            <section className="client-card" aria-labelledby="latest-mail">
              <div className="client-card-head"><h2 id="latest-mail">Latest emails</h2>{!!mails?.length && <Link className="b b-ghost" href={`${base}?tab=emails`}>All emails</Link>}</div>
              <ul className="client-rows">{mails?.map((mail) => mailRow(mail))}</ul>
              {!mails?.length && <p className="hint">No email from this client yet. Emails from the client&apos;s address and its contacts show here.</p>}
            </section>
            {numbers.some((registration) => servicesFor(registration.kind).length) && (
              <section className="client-card" aria-labelledby="services-card">
                <div className="client-card-head"><h2 id="services-card">Services</h2>{manage && <Link className="b b-ghost" href={`${base}?tab=services`} scroll={false}>Change services</Link>}</div>
                <ul className="client-rows">
                  {numbers.filter((registration) => servicesFor(registration.kind).length).map((registration) => (
                    <li key={registration.id}>
                      <span className="grow"><span className="name">{numberKinds[registration.kind as NumberKind].name}</span><span className="sub">{registration.services.map((code) => rule.get(code)?.name ?? code).join(", ") || "None chosen yet"}</span></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            </div>
            <div className="client-col">
            <section className="client-card" aria-labelledby="numbers">
              <div className="client-card-head"><h2 id="numbers">Registrations</h2>{manage && <Link className="b b-ghost" href={`${base}?tab=numbers`} scroll={false}>Change numbers</Link>}</div>
              <ul className="client-rows">
                {numbers.map((registration) => (
                  <li key={registration.id}>
                    <span className="grow name">{numberKinds[registration.kind as NumberKind].name}</span>
                    <span className="num">{registration.number}</span>
                  </li>
                ))}
              </ul>
              {!numbers.length && <p className="hint">No numbers yet. A PAN or GSTIN helps InboxCA recognise the client&apos;s papers.</p>}
            </section>
            <section className="client-card" aria-labelledby="contacts-card">
              <div className="client-card-head"><h2 id="contacts-card">Contacts</h2>{manage && <Link className="b b-ghost" href={`${base}?tab=contacts`} scroll={false}>Change contacts</Link>}</div>
              <ul className="client-rows">
                {contacts.map((contact) => (
                  <li key={contact.contact_id}>
                    <span className="grow"><span className="name">{contact.name}</span><span className="sub">{[contact.email, contact.relation].filter(Boolean).join(", ")}</span></span>
                  </li>
                ))}
              </ul>
              {!contacts.length && <p className="hint">No contact people yet.</p>}
            </section>
            <section className="client-card" aria-labelledby="team-card">
              <div className="client-card-head"><h2 id="team-card">Looked after by</h2>{manage && <Link className="b b-ghost" href={`${base}?tab=team`} scroll={false}>Change people</Link>}</div>
              <ul className="client-rows">
                {assigned.map((assignment) => (
                  <li key={assignment.value}>
                    <span className="grow name">{labelOf.get(assignment.value)}</span>
                    <span className="hint">{assignmentRoles[assignment.role as keyof typeof assignmentRoles]}</span>
                  </li>
                ))}
              </ul>
              {!assigned.length && <p className="hint">Nobody is assigned yet.</p>}
            </section>
            <section className="client-card" aria-labelledby="details-card">
              <div className="client-card-head"><h2 id="details-card">Details</h2>{manage && <Link className="b b-ghost" href={`${base}?tab=details`} scroll={false}>Edit details</Link>}</div>
              <ul className="client-rows">
                <li><span className="grow hint">Kind</span>{clientKinds[client.kind as ClientKind]}</li>
                <li><span className="grow hint">Email</span>{email || <span className="hint">None yet</span>}</li>
                <li><span className="grow hint">Group</span>{groupName ? <Link href={`/app/clients?group=${client.group_id}`}>{groupName}</Link> : <span className="hint">None</span>}</li>
                {!!branches.length && <li><span className="grow hint">Branch</span>{branchName ? <Link href={`/app/clients?branch=${client.branch_id}`}>{branchName}</Link> : <span className="hint">None</span>}</li>}
                <li><span className="grow hint">Reminders</span>{client.reminders_paused ? "Paused" : "On"}</li>
                <li><span className="grow hint">Changes</span><Link href={`${base}?tab=activity`} scroll={false}>Activity</Link></li>
              </ul>
            </section>
            </div>
          </div>
        )}

        {tab === "emails" && (
          <section className="client-card" aria-labelledby="client-mail">
            <h2 id="client-mail" className="sr-only">Emails</h2>
            {mails?.length ? <ul className="client-rows client-mails">{mails.map((mail) => mailRow(mail))}</ul> : (
              <Empty Icon={FileText} title="No email from this client yet">
                <span>Emails from the client&apos;s address and its contact people show here once the firm&apos;s email is connected.</span>
              </Empty>
            )}
            {(mailCount ?? 0) > 50 && pager(mailCount ?? 0, mails?.length ?? 0, "Emails", "emails")}
          </section>
        )}

        {tab === "documents" && (
          <>
            <div className="client-tools">
              <form role="search">
                <input type="hidden" name="tab" value="documents" />
                <input name="find" defaultValue={find} placeholder="Find a paper by a word in it or its name" aria-label="Find a file" />
                <button className="b b-secondary" type="submit">Find</button>
                {find && <Link className="b b-ghost" href={`${base}?tab=documents`}>Show all</Link>}
              </form>
              <span className="page-actions">
                {canUpload ? (
                  <Link className="b b-secondary" href={`${base}?tab=documents&upload=1`} scroll={false}>Upload papers</Link>
                ) : (
                  askButton("upload", "Ask to upload")
                )}
              </span>
            </div>
            <DroppedNotice value={dropped} />
            {askedRight && (
              <p className="notice" role="status">
                Asked. Your manager or the owner answers in their Inbox; the button appears here once it is allowed, for one use within an hour.
              </p>
            )}
            {sharedFile && <p className="notice" role="status">Sent {sharedFile.name}. The link works for 7 days and 5 downloads.</p>}
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
            {noticeFile && (
              <form action={removed ? removeDocument : manageDocument} className="notice" role="status">
                <input type="hidden" name="document" value={noticeFile.id} />
                <span>{removed ? `Removed ${noticeFile.name}. It waits 30 days in the drive's Deleted and old versions folder.` : `Saved as ${noticeFile.name}.`}</span>
                {(removed ? owner : canRename) && (renamed || removed) && (
                  <button className="b b-ghost" name="intent" value={removed ? "restore" : "undo"}>
                    {removed ? "Put back" : "Undo"}
                  </button>
                )}
              </form>
            )}
            {!!asking.length && (
              <ul className="client-card client-rows asks" aria-label="Files asked for">
                {asking.map((request) => {
                  const details = request.details as unknown as DocumentRequest;
                  const got = details.items.filter((item) => item.received.length).length;
                  return (
                    <li key={request.id}>
                      <span className="grow">
                        <span className="name">
                          Asked for {details.items.map((item) => item.type).join(", ")}
                          {details.period && ` for ${periodName(details.period)}`}
                        </span>
                        <span className="sub">
                          {got} of {details.items.length} received. The link works until {dueLabel(request.expires_at!.slice(0, 10))}.
                        </span>
                      </span>
                      {!viewOnly && (
                        <span className="cell-form">
                          {details.items.map((item, at) =>
                            item.received.length && !item.checked ? (
                              <form key={at} action={checkRequestItem} className="cell-form">
                                <input type="hidden" name="request" value={request.id} />
                                <input type="hidden" name="item" value={at} />
                                <span className="hint">{item.type}</span>
                                <button className="b b-secondary" name="intent" value="checked" aria-label={`${item.type} is right`}>
                                  Checked
                                </button>
                                <button className="b b-ghost" name="intent" value="again" aria-label={`Ask again for ${item.type}`}>
                                  Ask again
                                </button>
                              </form>
                            ) : null,
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <section className="client-docs" aria-labelledby="files">
              <h2 id="files" className="sr-only">Papers</h2>
              {documents.length ? (
                <div className="clients-table">
                  <table className="t">
                    <thead>
                      <tr>
                        <th scope="col">Paper</th>
                        <th scope="col">Kind</th>
                        <th scope="col">Period</th>
                        <th scope="col">Came from</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="shrink"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((document) => (
                        <tr key={document.id}>
                          <td>
                            <Link className="row-link" href={`/app/files/${document.id}/view`}>
                              {document.name}
                            </Link>
                            <span className="sub num">
                              {document.status === "to_check" && sameAs(document) ? sameAs(document) : folderFor(order, client.name, { work: document.work_type as WorkType, period: document.period_key, receivedAt: document.received_at, toCheck: document.status === "to_check" }).join(" / ")}
                            </span>
                          </td>
                          <td>{document.document_type}</td>
                          <td>{periodName(document.period_key) || <span className="hint">None</span>}</td>
                          <td className="hint">{document.prepared ? "Prepared here" : document.email_event_id ? "Email" : "Added"}, {receivedLabel(document.received_at)}</td>
                          <td>
                            <Badge tone={document.status === "to_check" ? "warn" : document.status === "missing" ? "late" : "done"}>
                              {document.status === "to_check" ? "To check" : document.status === "missing" ? "Missing in the drive" : "Filed"}
                            </Badge>
                          </td>
                          <td className="shrink">
                            {!viewOnly && (
                              <Link className="b b-secondary" href={`${base}?tab=documents&edit=${document.id}`} scroll={false} aria-label={`${document.status === "to_check" ? "Check" : "Open"} ${document.name}`}>
                                {document.status === "to_check" ? "Check" : "Open"}
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty Icon={FileText} title="No papers yet">
                  <span>Attachments this client emails are saved here, in your firm&apos;s drive. You can also ask the client for them.</span>
                  {!viewOnly && <Link className="b b-primary" href={`${base}?tab=documents&ask=1`} scroll={false}>Ask for papers</Link>}
                </Empty>
              )}
            </section>
            {owner && !!removedFiles.length && (
              <section className="client-card removed-files" aria-labelledby="removed">
                <div className="client-card-head"><h2 id="removed">Removed in the last 30 days</h2></div>
                <ul className="client-rows">
                  {removedFiles.map((document) => (
                    <li key={document.id}>
                      <span className="grow name">{document.name}</span>
                      <form action={removeDocument}>
                        <input type="hidden" name="document" value={document.id} />
                        <button className="b b-secondary" name="intent" value="restore">Put back</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {tab === "returns" && (showExtraction || showOutputs) && (
          <LinkTabs kind="pills" label="Returns work" items={[["returns", "Returns"], ...(showExtraction ? [["extraction", "Figures"]] : []), ...(showOutputs ? [["outputs", "Prepared forms"]] : [])].map(([key, label]) => ({ href: `${base}?tab=${key}`, label, current: sub === key }))} />
        )}
        {sub === "returns" && (
          <>
            <DroppedNotice value={dropped} />
            <p className="client-tools hint">
              <span>{tasks?.some((task) => !rule.get(task.code ?? "")?.verified_on) ? "Dates marked * are not yet confirmed by a CA against the official notification." : ""}</span>
              <Link href={`?tab=returns${show==="filed" ? "" : "&show=filed"}`}>{show==="filed" ? "Show returns still to file" : "Show filed returns"}</Link>
            </p>
            <section className="client-card" aria-labelledby="due">
              <h2 id="due" className="sr-only">Returns</h2>
              {tasks?.length ? (
                <ul className="client-rows">
                  {tasks.map((task) => {
                    const r = rule.get(task.code ?? "");
                    const overdue = task.status !== "filed" && task.due_on < today;
                    const note = reminderNote(task.details as { reminded?: string[]; skipped?: { reason: string } });
                    const filed = task.details as { filed_on?: string; by?: string; ack?: string };
                    const title = `${r?.name} ${periodLabel(r?.frequency ?? null, task.period_key)}`;
                    return (
                      <li key={task.id}>
                        <span className="grow">
                          <span className="name">{title}</span>
                          <span className="sub">
                            {task.status === "filed"
                              ? <>Filed{filed.filed_on && ` ${dueLabel(filed.filed_on)}`}{filed.by && ` by ${personName(people?.find((person) => person.user_id === filed.by)?.email)}`}{filed.ack && <>, ARN <span className="num">{filed.ack}</span></>}</>
                              : <>Due {dueLabel(task.due_on)}{!r?.verified_on && "*"}{note && `. ${note}`}{task.code === "GSTR3B_M" && task.period_key && months.includes(task.period_key) && `. GSTR-2B for ${periodName(task.period_key)}: ${needs2b.has(task.period_key) ? "not added yet" : "added"}`}</>}
                          </span>
                        </span>
                        <Badge tone={task.status === "filed" ? "done" : overdue ? "late" : task.status === "in_progress" ? "blue" : ""}>
                          {overdue ? "Late" : taskStatuses[task.status as keyof typeof taskStatuses]}
                        </Badge>
                        {canFile && task.status !== "filed" && task.due_on <= addDays(today, 30) && (
                          <Link className="b b-secondary" href={`${returnsHref}&task=${task.id}`} scroll={false} aria-label={`Mark ${title} filed`}>Mark filed</Link>
                        )}
                        {canFile && task.status === "filed" && (
                          <form action={manageTasks}>
                            {returnsState}
                            <input type="hidden" name="task" value={task.id} />
                            <button className="b b-secondary" name="intent" value="reopen" aria-label={`${title} was not filed after all`}>Not filed after all</button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="hint client-empty">{show==="filed" ? "No filed returns on this page." : "No returns due. Add a number and choose its services on Overview."}</p>
              )}
            </section>
            {!!needs2b.size && membership.may("portal_files", client.id) && <PortalDrop clientId={client.id} back="returns" />}
            {pager(taskCount ?? 0,tasks?.length ?? 0,"Returns","returns")}
          </>
        )}
        {sub === "extraction" && <><PortalInput clientId={id} message={portal}/><DatasetReview clientId={id} draftId={draft} lineId={line} check={check}/><SalesInput clientId={id} source={source} section={section} header={header} read={read}/></>}
        {sub === "outputs" && <PreparedForms client={id} message={formMessage}/>}

        {tab === "notices" && (
          <>
            <div className="client-tools">
              <p className="hint">Check a suggested date against the notice before confirming it. <Link href="/app/notices">All notices</Link></p>
              {!viewOnly && <Link className="b b-secondary" href={`${base}?tab=notice`} scroll={false}>Add a notice</Link>}
            </div>
            <section aria-labelledby="client-notices">
              <h2 id="client-notices" className="sr-only">Notices</h2>
              {notices?.length ? (
                <div className="clients-table">
                  <table className="t">
                    <thead><tr><th scope="col">Notice</th><th scope="col">Received</th><th scope="col">Action date</th><th scope="col">Status</th></tr></thead>
                    <tbody>{notices.map((notice) => {
                      const details = notice.details as unknown as NoticeDetails;
                      return (
                        <tr key={notice.id}>
                          <td>{details.notice_type}<span className="sub">{[authorities[details.authority], details.reference].filter(Boolean).join(", ")}</span></td>
                          <td>{dueLabel(details.received_on)}</td>
                          <td>
                            {details.action_date ? dueLabel(details.action_date) : (
                              <form action={manageNotice} className="cell-form">
                                <input type="hidden" name="notice" value={notice.id} />
                                <input type="hidden" name="back" value="client" />
                                <Badge tone="warn">Review by {dueLabel(notice.due_on)}</Badge>
                                {!viewOnly && <>
                                  <input type="date" name="date" defaultValue={details.suggested_date} aria-label={`Action date for ${details.notice_type}`} className="cell-input" />
                                  <button className="b b-secondary" name="intent" value="confirm">Confirm date</button>
                                </>}
                              </form>
                            )}
                          </td>
                          <td>
                            {viewOnly ? noticeStatuses[notice.status as keyof typeof noticeStatuses] : (
                              <form action={manageNotice}>
                                <input type="hidden" name="notice" value={notice.id} />
                                <input type="hidden" name="back" value="client" />
                                <AutoSelect save="status" name="intent" defaultValue={notice.status} aria-label={`Status of ${details.notice_type}`}>
                                  {Object.entries(noticeStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </AutoSelect>
                                <button hidden value="status" />
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              ) : (
                <Empty Icon={FileText} title="No notices">
                  <span>A notice that comes by email is filed here and shown on Today. Add one by hand if it came another way.</span>
                </Empty>
              )}
            </section>
            {(noticeCount ?? 0) > 50 && pager(noticeCount ?? 0, notices?.length ?? 0, "Notices", "notices")}
          </>
        )}
      </div>

      {panel === "numbers" && manage && (
        <SidePanel id="numbers-panel" title="Registrations" close={base}>
          {alert}
          <ul className="client-rows">
            {numbers.map((registration) => (
              <li key={registration.id}>
                <span className="grow"><span className="name">{numberKinds[registration.kind as NumberKind].name}</span><span className="sub num">{registration.number}</span></span>
                <form action={manageClient}>
                  {hidden("numbers")}
                  <input type="hidden" name="registration" value={registration.id} />
                  <button className="b b-ghost" name="intent" value="remove-number" aria-label={`Remove ${registration.number}`}>Remove</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={manageClient} className="fields">
            {hidden("numbers")}
            <div>
              <label htmlFor="number-kind">Number</label>
              <select id="number-kind" name="kind" defaultValue="gstin">
                {Object.entries(numberKinds).map(([value, { name }]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="number-value">Value</label>
              <input id="number-value" name="number" required autoComplete="off" className="num" />
            </div>
            <button className="b b-primary" name="intent" value="add-number">Add number</button>
          </form>
        </SidePanel>
      )}
      {panel === "services" && manage && (
        <SidePanel id="services" title="Services" close={base}>
          {alert}
          <p className="hint">What your firm files for this client. InboxCA makes the due dates for the next 12 months.</p>
          <ul className="client-rows">
            {numbers.filter((registration) => servicesFor(registration.kind).length).map((registration) => (
              <li key={registration.id}>
                <form key={registration.services.join()} action={manageClient} className="grow service-form">
                  {hidden("services")}
                  <input type="hidden" name="registration" value={registration.id} />
                  <span className="name">{numberKinds[registration.kind as NumberKind].name} <span className="num">{registration.number}</span></span>
                  {servicesFor(registration.kind).map((service) => (
                    <label key={service.code} className="check">
                      <input type="checkbox" name="service" value={service.code} defaultChecked={registration.services.includes(service.code)} /> {service.name}
                    </label>
                  ))}
                  <button className="b b-primary" name="intent" value="services">Save services</button>
                </form>
              </li>
            ))}
          </ul>
        </SidePanel>
      )}
      {panel === "contacts" && (
        <SidePanel id="contacts" title="Contact people" close={base}>
          {alert}
          <p className="hint">People who write for this client. InboxCA recognises their emails, and sends documents only to those allowed.</p>
          <ul className="client-rows">
            {contacts.map((contact) => (
              <li key={contact.contact_id}>
                <span className="grow">
                  <span className="name">{contact.name}</span>
                  <span className="sub">{contact.email}{contact.relation && `, ${contact.relation}`}</span>
                  {manage ? (
                    <form key={`${contact.can_view_status}${contact.can_receive_documents}`} action={manageClient} className="cell-form contact-form">
                      {hidden("contacts")}
                      <input type="hidden" name="contact" value={contact.contact_id} />
                      <label className="check"><input type="checkbox" name="can_view_status" defaultChecked={contact.can_view_status} /> Sees work status</label>
                      <label className="check"><input type="checkbox" name="can_receive_documents" defaultChecked={contact.can_receive_documents} /> Receives documents</label>
                      <button className="b b-secondary" name="intent" value="contact-rights">Save</button>
                      <button className="b b-ghost" name="intent" value="unlink-contact">Remove</button>
                    </form>
                  ) : (
                    <span className="sub">{[contact.can_view_status && "Sees work status", contact.can_receive_documents && "Receives documents"].filter(Boolean).join(", ")}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!contacts.length && <p className="hint">No contact people yet.</p>}
          {manage && (
            <form action={manageClient} className="fields">
              {hidden("contacts")}
              <div><label htmlFor="contact-name">Contact&apos;s name</label><input id="contact-name" name="contact_name" required maxLength={120} /></div>
              <div><label htmlFor="contact-email">Contact&apos;s email</label><input id="contact-email" name="contact_email" type="email" required /></div>
              <div><label htmlFor="contact-relation">Who they are, if known</label><input id="contact-relation" name="relation" maxLength={60} /></div>
              <label className="check"><input type="checkbox" name="can_view_status" /> Sees work status</label>
              <label className="check"><input type="checkbox" name="can_receive_documents" /> Receives documents</label>
              <button className="b b-primary" name="intent" value="add-contact">Add contact</button>
            </form>
          )}
        </SidePanel>
      )}
      {panel === "team" && (
        <SidePanel id="assigned" title="Looked after by" close={base}>
          {alert}
          <ul className="client-rows">
            {assigned.map((assignment) => (
              <li key={assignment.value}>
                <span className="grow"><span className="name">{labelOf.get(assignment.value)}</span><span className="sub">{assignmentRoles[assignment.role as keyof typeof assignmentRoles]}</span></span>
                {manage && (
                  <form action={manageClient}>
                    {hidden("team")}
                    <input type="hidden" name="who" value={assignment.value} />
                    <button className="b b-ghost" name="intent" value="unassign">Unassign</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {!assigned.length && <p className="hint">Nobody is assigned yet.</p>}
          {manage && !!unassigned.length && (
            <form action={manageClient} className="fields">
              {hidden("team")}
              <div>
                <label htmlFor="assign-who">Person or team</label>
                <select id="assign-who" name="who">
                  {unassigned.map((choice) => <option key={choice.value} value={choice.value}>{"email" in choice ? `${choice.label}, ${choice.email}` : choice.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="assign-role">Does</label>
                <select id="assign-role" name="role" defaultValue="staff">
                  {Object.entries(assignmentRoles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <button className="b b-primary" name="intent" value="assign">Assign</button>
            </form>
          )}
        </SidePanel>
      )}
      {panel === "details" && manage && (
        <SidePanel id="details" title="Details" close={base}>
          {alert}
          <form action={manageClient} className="fields">
            {hidden("details")}
            <div><label htmlFor="client-name">Name</label><input id="client-name" name="name" required defaultValue={client.name} /></div>
            <div><label htmlFor="client-email">Email</label><input id="client-email" name="email" type="email" defaultValue={email} /></div>
            <div>
              <label htmlFor="client-kind">Kind</label>
              <select id="client-kind" name="kind" defaultValue={client.kind}>
                {Object.entries(clientKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="client-group">Group</label>
              <select id="client-group" name="group" defaultValue={client.group_id ?? ""}>
                <option value="">No group</option>
                {clientGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </div>
            <div><label htmlFor="client-new-group">Or a new group</label><input id="client-new-group" name="new_group" maxLength={120} /></div>
            {!!branches.length && (
              <div>
                <label htmlFor="client-branch">Branch</label>
                <select id="client-branch" name="branch" defaultValue={client.branch_id ?? ""}>
                  <option value="">No branch</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </div>
            )}
            <button className="b b-primary" name="intent" value="details">Save details</button>
          </form>
          <h3>Reminders</h3>
          <form action={pauseReminders} className="form-row">
            <input type="hidden" name="client" value={client.id} />
            <label className="check"><input type="checkbox" name="paused" defaultChecked={client.reminders_paused} /> Pause reminders for this client</label>
            <button className="b b-secondary" type="submit">Save</button>
          </form>
          <h3>{client.archived_at ? "Archived" : "Archive"}</h3>
          <form action={manageClient} className="form-row">
            {hidden("details")}
            <p className="hint">{client.archived_at ? "Archived clients are hidden from the list. Nothing was deleted." : "Archiving hides the client from the list. Nothing is deleted, and you can restore it."}</p>
            <button className="b b-secondary" name="intent" value={client.archived_at ? "restore" : "archive"}>{client.archived_at ? "Restore client" : "Archive client"}</button>
          </form>
        </SidePanel>
      )}
      {panel === "activity" && (
        <SidePanel id="client-activity" title="Activity" close={base}>
          <p className="hint">The latest 50 changes for this client.</p>
          {activity?.data?.length ? (
            <ul className="client-rows">
              {activity.data.map((entry, index) => (
                <li key={index}>
                  <span className="grow">
                    <span className="name">{activityNames[entry.action] ?? "Client record changed"}</span>
                    {entry.renamed_from && <span className="sub">{entry.renamed_to ? `${entry.renamed_from} to ${entry.renamed_to}` : `Was ${entry.renamed_from}`}</span>}
                    <span className="sub">{entry.actor_id ? people?.find((person) => person.user_id === entry.actor_id)?.email ?? "Former team member" : "InboxCA"}, <span className="num">{mailTime(entry.at)}</span></span>
                  </span>
                  {/* A manager or the owner puts back the latest rename of a file in one click (5.17.2). */}
                  {manage && !viewOnly && activity.data.findIndex((other) => other.document_id === entry.document_id) === index && documents.some((file) => file.id === entry.document_id && !file.prepared) && (
                    <form action={manageDocument}>
                      <input type="hidden" name="document" value={entry.document_id} />
                      <button className="b b-ghost" name="intent" value="undo" aria-label={`Undo rename of ${entry.renamed_to ?? entry.renamed_from}`}>Undo</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="hint">No changes recorded yet.</p>}
        </SidePanel>
      )}
      {panel === "notice" && !viewOnly && (
        <SidePanel id="add-notice" title="Add a notice" close={`${base}?tab=notices`}>
          {alert}
          <form action={manageNotice} className="fields">
            <input type="hidden" name="client" value={client.id} />
            <input type="hidden" name="back" value="client" />
            <div>
              <label htmlFor="notice-authority">Authority</label>
              <select id="notice-authority" name="authority">
                {Object.entries(authorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div><label htmlFor="notice-type">Notice</label><input id="notice-type" name="type" maxLength={80} placeholder="Notice u/s 148" /></div>
            <div><label htmlFor="notice-reference">Reference or DIN</label><input id="notice-reference" name="reference" maxLength={60} className="num" /></div>
            <div><label htmlFor="notice-received">Received on</label><input id="notice-received" name="received" type="date" defaultValue={today} required /></div>
            <div><label htmlFor="notice-date">Action date, as the notice states it</label><input id="notice-date" name="date" type="date" /></div>
            <button className="b b-primary" name="intent" value="add">Add notice</button>
          </form>
        </SidePanel>
      )}

      {ask && !viewOnly && (
        <SidePanel id="ask-files" title={`Ask ${client.name} for papers`} close={here}>
          {alert}
          <p className="hint">The client gets a private link to upload them, no sign in needed. It works for 30 days.</p>
          <form action={askForDocuments}>
            <input type="hidden" name="client" value={client.id} />
            <fieldset className="ask-papers">
              <legend>Papers</legend>
              {[...askItems].slice(0, 5).map(askBox)}
              {askItems.size > 5 && (
                <details className="reveal" open={[...askItems].slice(5).some(usual)}>
                  <summary>More papers</summary>
                  <div className="ask-more">{[...askItems].slice(5).map(askBox)}</div>
                </details>
              )}
            </fieldset>
            <div className="fields">
              <div>
                <label htmlFor="ask-others">Anything else, by name</label>
                <input id="ask-others" name="others" maxLength={400} placeholder="Loan statement, Property tax receipt" />
              </div>
              <div>
                <label htmlFor="ask-period">For</label>
                <select id="ask-period" name="period" defaultValue={askPeriod}>
                  <option value="">No period</option>
                  {periodChoices(today).map((choice) => <option key={choice} value={choice}>{periodName(choice)}</option>)}
                </select>
              </div>
              {gstinChoice}
              <button className="b b-primary" type="submit">Ask for papers</button>
            </div>
          </form>
          {manage && (
            <details className="reveal">
              <summary>Change the usual list for {clientKinds[client.kind as ClientKind]}</summary>
              <form action={saveChecklist} className="fields">
                <input type="hidden" name="client" value={client.id} />
                <div>
                  <label htmlFor="ask-list">One paper on each line. It changes the list for every client of this kind; leave it empty to go back to the starting list.</label>
                  <textarea id="ask-list" className="ask-list" name="items" rows={8} defaultValue={kindList.join("\n")} />
                </div>
                <button className="b b-secondary" type="submit">Save list</button>
              </form>
            </details>
          )}
        </SidePanel>
      )}
      {upload && canUpload && !ask && (
        <SidePanel id="upload-file" title="Upload papers" close={`${base}?tab=documents`}>
          {alert}
          <p className="hint">Each file is saved in the client&apos;s folder in your firm&apos;s drive, named by the type and period you choose.</p>
          <UploadForm
            clientId={client.id}
            types={[...documentTypes.filter((type) => type !== "Document"), ...firmTypes]}
            typeWork={Object.fromEntries(documentTypes.map((type) => [type, workOfType(type)]).filter(([, work]) => work !== "other"))}
            works={Object.entries(workTypes)}
            periods={periodChoices(today).map((choice) => [choice, periodName(choice)])}
            keep={manage}
          >
            {gstinChoice}
          </UploadForm>
          {membership.may("portal_files", client.id) && (
            <p className="hint upload-portal">
              GSTR-2B or GSTR-2A from the GST portal? <Link href="/app?panel=portal">Add portal files</Link>, and InboxCA finds the client and month inside each.
            </p>
          )}
        </SidePanel>
      )}
      {paper && !viewOnly && !ask && !confirmSend && (
        <SidePanel id="edit-file" title={paper.name} close={`${base}?tab=documents`}>
          {alert}
          {paper.status === "to_check" && sameAs(paper) && <p className="hint">{sameAs(paper)}.</p>}
          {canRename && !paper.prepared && (
            <>
              <p className="hint">{paper.status === "to_check" ? "Check its type and period, then save to file it." : "The file moves to the folder and name these give, in your firm's drive."}</p>
              <form action={manageDocument} className="fields">
                <input type="hidden" name="document" value={paper.id} />
                <DocumentFields type={paper.document_type} work={paper.work_type} period={paper.period_key} firmTypes={firmTypes} keep={manage} />
                <button className="b b-primary" name="intent" value="save">Save</button>
              </form>
            </>
          )}
          {!!earlier.length && (
            <>
              <h3>Earlier versions</h3>
              <p className="hint">Kept in the drive under their own names. This paper replaced them.</p>
              <ul className="client-rows" aria-label="Earlier versions">
                {earlier.map((file) => (
                  <li key={file.id}>
                    <Link className="grow row-link" href={`/app/files/${file.id}/view`}>{file.name}</Link>
                    <span className="hint">{receivedLabel(file.received_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {sendable && (
            <>
              <h3>Send to the client</h3>
              {canSend(paper.id) ? (
                recipients.length ? (
                  <Link className="b b-secondary" href={`${base}?tab=documents&send=${paper.id}`} scroll={false}>
                    Send this paper
                  </Link>
                ) : (
                  <p className="hint">Add the client&apos;s email in Details, or a contact who may receive documents, to send files.</p>
                )
              ) : (
                askButton("send", "Ask to send", paper.id)
              )}
            </>
          )}
          <h3>Remove</h3>
          {canRemove(paper.id) ? (
            <form action={removeDocument} className="form-row">
              <input type="hidden" name="document" value={paper.id} />
              <p className="hint">It waits 30 days in the drive&apos;s Deleted and old versions folder and can be put back.</p>
              <button className="b b-secondary" name="intent" value="remove" aria-label={`Remove ${paper.name}`}>Remove</button>
            </form>
          ) : (
            askButton("remove", "Ask to remove", paper.id)
          )}
          {owner && (
            <details className="reveal paper-more">
              <summary>More</summary>
              <form key={paper.share_policy ?? "firm"} action={setPaperSharing} className="form-row">
                <input type="hidden" name="document" value={paper.id} />
                <div><label htmlFor="paper-sharing">Sending this paper</label><select id="paper-sharing" name="policy" defaultValue={paper.share_policy ?? ""}><option value="">Use the firm&apos;s choice</option><option value="auto">Routine paper</option><option value="approval">Ask before sending</option><option value="internal">Keep inside the firm</option></select></div>
                <button className="b b-secondary">Save sending choice</button>
              </form>
            </details>
          )}
        </SidePanel>
      )}
      {paper && confirmSend && (
        <SidePanel id="send-file" title="Send to the client" close={`${base}?tab=documents&edit=${paper.id}`}>
          {alert}
          <form action={sendDocument} className="send-to">
            <input type="hidden" name="document" value={paper.id} />
            {recipients.length === 1 ? (
              <>
                <input type="hidden" name="to" value={recipients[0].value} />
                <p className="send-ask">Send {paper.document_type} to {recipients[0].email}?</p>
              </>
            ) : (
              <fieldset>
                <legend className="send-ask">Send {paper.document_type} to</legend>
                {recipients.map((recipient, at) => (
                  <label key={recipient.value} className="check">
                    <input type="radio" name="to" value={recipient.value} defaultChecked={!at} />
                    {recipient.name}, {recipient.email}
                  </label>
                ))}
              </fieldset>
            )}
            <p className="hint">{paper.name} goes from your firm&apos;s address as a secure link that works for 7 days and 5 downloads.</p>
            <span className="form-row">
              <button className="b b-primary" type="submit">Send</button>
              <Link className="b b-secondary" href={`${base}?tab=documents&edit=${paper.id}`} scroll={false}>Back</Link>
            </span>
          </form>
        </SidePanel>
      )}
      {filing && (
        <SidePanel id="mark-filed" title="Mark filed" close={returnsHref}>
          <MarkFiled state={returnsState} rows={[{ id: filing.id, name: `${rule.get(filing.code ?? "")?.name ?? filing.code} ${periodLabel(rule.get(filing.code ?? "")?.frequency ?? null, filing.period_key)}`, sub: `Due ${dueLabel(filing.due_on)}` }]} />
        </SidePanel>
      )}
      {!!done?.length && (
        <Toast
          undo={
            marked !== "reopen" && (
              <form action={manageTasks}>
                {returnsState}
                {done.map((task) => <input key={task.id} type="hidden" name="task" value={task.id} />)}
                <button className="b" name="intent" value="reopen">Undo</button>
              </form>
            )
          }
        >
          {done.length === 1 ? `${rule.get(done[0].code ?? "")?.name ?? done[0].code} ${periodLabel(rule.get(done[0].code ?? "")?.frequency ?? null, done[0].period_key)}` : `${done.length} returns`} {taskChanges[marked!]}.
        </Toast>
      )}
    </div>
  );
}

// Type, work and period for a file, filled in when correcting one.
function DocumentFields({ type = "", work = "other", period = "", firmTypes = [], keep = false }: { type?: string; work?: string; period?: string; firmTypes?: string[]; keep?: boolean }) {
  const known = !type || documentTypes.includes(type) || firmTypes.includes(type);
  return (
    <>
      <div>
        <label htmlFor="file-type">Type</label>
        <select id="file-type" name="type" defaultValue={known ? type || "Document" : "Other"}>
          {[...documentTypes, ...firmTypes].map((choice) => (
            <option key={choice}>{choice}</option>
          ))}
          <option value="Other">Other, named below</option>
        </select>
      </div>
      {/* Shown only while Type is Other (clients.css). */}
      <div className="other-name">
        <label htmlFor="file-custom">Name</label>
        <input id="file-custom" name="custom" maxLength={80} defaultValue={known ? "" : type} placeholder="HDFC loan sanction letter" />
        {keep && (
          <label className="check">
            <input type="checkbox" name="keep" value="0" />
            Add to our list of paper types
          </label>
        )}
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
