import {PreparedForms} from "../../prepared-forms";
import { PortalInput } from "./portal-input";
import { SalesInput } from "./sales-input";
import { PurchaseMatch } from "./purchase-match";
import { DatasetReview } from "./dataset-review";
import { AlarmClock, BellRing, CalendarCheck, CalendarClock, CalendarDays, Contact, FileArchive, FileClock, FileCode2, FileImage, FilePlus2, FileSpreadsheet, FileText, FileUp, Hash, Info, ListChecks, Mail, Scale, Search, Trash2, TriangleAlert, UserPlus, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import { setPaperSharing, askForDocuments, askPermission, checkRequestItem, manageClient, manageNotice, manageTasks, pauseReminders, manageDocument, removeDocument, saveChecklist, sendDocument } from "@/app/(app)/actions";
import { addDays, dueLabel, periodLabel, taskStatuses, todayInIndia } from "@/src/lib/calendar";
import { assignmentRoles, canManageClients, clientKinds, type ClientKind } from "@/src/lib/clients";
import { checklists, kindChecklist, workOfService, type DocumentRequest } from "@/src/lib/checklists";
import { skipReasons, type Skip } from "@/src/lib/reminders";
import { activityNames } from "@/src/lib/activity";
import { type Right } from "@/src/lib/rights";
import { serverCrypto } from "@/src/lib/crypto";
import { documentTypes, folderFor, periodChoices, periodName, receivedLabel, workOfType } from "@/src/lib/documents";
import { paperType } from "@/src/lib/paper-type";
import { workTypes, type FolderOrder, type WorkType } from "@/src/lib/drive";
import { authorities, confirmAction, confirmers, noticeStatuses, type NoticeDetails } from "@/src/lib/notices";
import { numberKinds, type NumberKind } from "@/src/lib/identifiers";
import { mailLive } from "@/src/lib/mail-live";
import { currentMember } from "@/src/lib/member";
import { paperOrigins } from "@/src/lib/paper-origin";
import { personName } from "@/src/lib/roles";
import { scanType, searchTokens, words } from "@/src/lib/search";
import { supabaseAdmin } from "@/src/lib/supabase";
import { labels, type Label } from "@/src/lib/triage";
import { workspaceStore } from "@/src/lib/workspace";
import { AutoSelect } from "../../auto-select";
import { LinkTabs } from "../../link-tabs";
import { DroppedNotice, PortalDrop } from "../../portal-drop";
import { MarkFiled } from "../../mark-filed";
import { Fill } from "../../fill";
import { returnStages, StageLine } from "../../return-work";
import { fillable, fills } from "@/src/lib/return-work";
import { Presence } from "../../motion";
import { Pending } from "../../pending";
import { Avatar, Badge, Card, Empty, IconTile, PageHead, Row, SidePanel, Toast, type Kind } from "../../ui";
import { CopyButton } from "../../ui-client";
import { CameFrom } from "../../documents/came-from";
import { UploadForm } from "./upload-form";
import { remindClient } from "@/app/(app)/actions";
import { RemindToast } from "../../remind-toast";
import { unsafeText } from "@/src/lib/intake";
import "../clients.css";
import "../../today.css";

const errors: Record<string, string> = {
  details: "Enter a name, choose a client type, and check the email address.",
  number: "That number does not fit the type you chose. Check the type, and check the number for a typing mistake.",
  "one-pan": "This client already has a PAN.",
  "gstin-pan": "That GSTIN holds a different PAN from this client's.",
  taken: "Another client in your firm already has that number.",
  "filed-number": "That number has filed returns, so it stays. To stop its new returns, untick its services and choose Save services.",
  assign: "Choose a person and what they do for this client.",
  assigned: "That person is already assigned to this client.",
  contact: "Enter the contact's name and a valid email address.",
  linked: "That contact is already added to this client.",
  services: "These services cannot go together. Choose one GSTR-1 and one GSTR-3B, monthly or quarterly. Do not choose composition with regular GST returns.",
  role: "Only the owner, a partner or a manager can change clients.",
  document: "Choose the paper type, type of work and period. If you chose Other, type a name for the paper.",
  drive: "The firm's drive is not connected or could not be reached. Try again in a minute.",
  upload: "Choose up to 20 files, 50 MB in all, and each file's paper type, type of work and period.",
  ...unsafeText,
  scan: "The file could not be checked for viruses just now. Try again in a minute.",
  twin: "This client already has this paper, so InboxCA did not save it again.",
  gstin: "Choose the GSTIN this GST paper is for.",
  list: "Put one paper on each line, up to 30, each up to 80 letters and without a colon.",
  owner: "Only the owner can remove a paper. Choose Ask to remove to ask for permission.",
  copy: "InboxCA could not make its safety copy, so the paper was not removed. Try again in a minute.",
  needs: "You need permission for this first. Choose the Ask button. Once your manager or the owner allows it, the button appears here.",
  asked: "You already have 10 permission requests waiting. Wait for an answer before you ask again.",
  ask: "Tick at least one paper, or name one, to ask for.",
  recipient: "Choose who gets the paper: the client's email, or a contact with Receives papers ticked.",
  mailbox: "InboxCA could not email the paper. Try again in a minute. If it fails again, ask the owner to connect the firm email in Settings.",
  notice: "Choose the authority and the day the notice was received.",
};

// What reminders did for a return: when it was last reminded, or why it was not.
const reminderNote = (details: { reminded?: string[]; skipped?: { reason: string } }) =>
  details.reminded?.length ? `Reminded ${dueLabel(details.reminded.at(-1)!)}` : details.skipped ? skipReasons[details.skipped.reason as Skip] : "";
// "24 Oct, 10:05" in India time, for an email.
const mailTime = (at: string) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
// A paper's icon, by what kind of file it is.
const fileIcon = (name: string) =>
  /\.(xlsx?|ods|csv)$/i.test(name) ? FileSpreadsheet : /\.(jpe?g|png|webp|heic|gif)$/i.test(name) ? FileImage : /\.(json|xml)$/i.test(name) ? FileCode2 : /\.zip$/i.test(name) ? FileArchive : FileText;
// Each kind of change in the Activity timeline has its own icon and tint.
const activityIcons: Record<string, [LucideIcon, Kind]> = {
  client: [UserRound, "approve"], registration: [Hash, "approve"], contact_link: [Contact, "approve"], assignment: [UserPlus, "papers"],
  document: [FileText, "docs"], share: [FileText, "docs"], form: [CalendarCheck, "done"], dataset: [ListChecks, "week"], task: [CalendarCheck, "week"],
  request: [FilePlus2, "papers"], reminder: [BellRing, "notice"], email: [Mail, "reply"], notice: [Scale, "notice"],
};
const DAY = 86_400_000;

// The five tabs. Older addresses (and each save) still arrive with the tab they had before:
// files, due dates, figures and forms open their tab; the rest open Overview with their panel.
const mains = { overview: "Overview", emails: "Emails", documents: "Documents", returns: "Returns", notices: "Notices" } as const;
type Main = keyof typeof mains;
const tabOf: Record<string, Main> = { files: "documents", due: "returns", extraction: "returns", outputs: "returns", notice: "notices", numbers: "overview", services: "overview", contacts: "overview", team: "overview", details: "overview", activity: "overview" };
const panels = ["notice", "numbers", "services", "contacts", "team", "details", "activity"];
const lookAfter = ["partner_in_charge", "manager", "staff"];
const uuid = /^[0-9a-f-]{36}$/;
const taskChanges: Record<string, string> = { filed: "marked filed", in_progress: "marked in progress", reopen: "marked not filed" };
// What a save on this page says once it is done (?changed=).
const changes: Record<string, string> = {
  details: "Details saved.", services: "Services saved.", "contact-rights": "Contact saved.", "add-contact": "Contact added.", "unlink-contact": "Contact removed.",
  "add-number": "Tax number added.", "remove-number": "Tax number removed.", assign: "Assigned.", unassign: "Unassigned.", archive: "Client archived.", restore: "Client restored.",
  reminders: "Reminders saved.", list: "List saved.", sharing: "Sending choice saved.",
};

// One client. Its numbers are opened with the firm's key on the server, for this page only.
export default async function Client({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; tab?: string; form?:string; page?: string; show?: string; draft?: string; line?: string; check?: string; view?: string; source?: string; section?: string; header?: string; read?: string; portal?: string; edit?: string; renamed?: string; saved?: string; removed?: string; restored?: string; changed?: string; upload?: string; dropped?: string; ask?: string; asked?: string; send?: string; shared?: string; find?: string; asked_right?: string; task?: string; marked?: string; t?: string }> }) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ id }, { error, form:formMessage, tab: asked, page: askedPage, show, draft, line, check, view, source, section, header, read, portal, edit, renamed, saved, removed, restored, changed, upload, dropped, ask, asked: askedFor, send, shared, find, asked_right: askedRight, task: marking, marked, t: markedIds }] = await Promise.all([params, searchParams]);
  const tab: Main = asked && asked in mains ? (asked as Main) : tabOf[asked ?? ""] ?? "overview";
  const sub = asked === "extraction" || asked === "outputs" ? asked : tab;
  const panel = panels.includes(asked ?? "") ? asked! : "";
  const page = /^\d{1,6}$/.test(askedPage ?? "") ? Math.max(1,Number(askedPage)) : 1;
  const start = (page-1)*50;
  const today = todayInIndia();
  const firm = membership.firmId;
  // A personal device allowed away from the office only views.
  const viewOnly = !!membership.viewOnlyUntil;
  const canFile = !viewOnly && membership.may("mark_filed", id);
  const doneIds = markedIds?.split(".").filter((taskId) => uuid.test(taskId)).slice(0, 100) ?? [];
  // Everything the page reads goes at once. Lists that only one tab shows are read a page at a
  // time on that tab and only counted on the others; the live email subjects and the activity
  // stream in below (Suspense), so the page shows without waiting for them.
  const files = tab === "documents";
  const listsMail = tab === "overview" || tab === "emails";
  const mailRange = tab === "emails" ? start : 0;
  // Papers 50 at a time with their true count; a search keeps only the files whose words
  // include every word typed. The paper open in a panel, or just sent or changed, and the
  // owner's removed papers are read by themselves.
  const fileColumns = "id, name, document_type, work_type, period_key, status, share_policy, sha256, received_at, prepared, email_event_id, registration_id";
  const fileQuery = supabase.from("documents").select(fileColumns, { count: "exact", head: !files }).eq("firm_id", firm).eq("client_id", id).not("status", "in", "(deleted,earlier)");
  const typed = files && find?.trim() ? words(find.slice(0, 200), 8) : [];
  const tokens = typed.length ? await searchTokens(firm, typed) : null;
  const owner = membership.role === "owner";
  const namedIds = [edit ?? send, shared, renamed ?? saved ?? removed ?? restored].filter((file): file is string => uuid.test(file ?? ""));
  const [{ data: client }, { data: people }, { data: groups }, { data: rules }, { data: tasks, count: taskCount }, { data: pageFiles, count: fileCount }, { data: asks }, { data: notices, count: noticeCount }, { data: late, count: lateCount }, { data: mails, count: mailCount }, { data: drive }, { data: nextDue }, { count: outputs }, { data: draftForms, count: drafts }, { data: mine }, { data: filing }, { data: done }, { data: due }, { data: namedFiles }, { data: sheets }] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, kind, archived_at, email_enc, group_id, branch_id, reminders_paused, client_registrations(id, kind, number_enc, services), client_assignments(user_id, team_id, role), contact_clients(contact_id, relation, can_receive_documents, contacts(name_enc, email_enc))",
      )
      .eq("id", id)
      .eq("firm_id", firm)
      .maybeSingle(),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "client_group", "branch"]).order("name"),
    supabase.from("compliance_types").select("code, name, frequency, due_rule, verified_on, client_kinds").eq("period_key", "").order("code"),
    supabase.from("tasks").select("id, code, period_key, due_on, status, details",{count:"exact", head: sub !== "returns"}).eq("firm_id",firm).eq("kind", "compliance").eq("client_id", id).filter("status",show==="filed" ? "eq" : "neq","filed").order("due_on",{ascending:show!=="filed"}).order("id").range(start,start+49),
    files ? (tokens ? fileQuery.contains("search_tokens", tokens) : fileQuery).order("received_at", { ascending: false }).order("id", { ascending: false }).range(start, start + 49) : fileQuery,
    supabase.from("requests").select("id, status, expires_at, details").eq("kind", "documents").eq("client_id", id).in("status", ["pending", "done"]).gt("expires_at", new Date().toISOString()),
    supabase.from("tasks").select("id,due_on,status,details",{count:"exact", head: tab !== "overview" && tab !== "notices"}).eq("firm_id",firm).eq("client_id",id).eq("kind","notice").order("due_on").order("id").range(start,start+49),
    supabase.from("tasks").select("id, code, due_on",{count:"exact"}).eq("firm_id",firm).eq("kind","compliance").eq("client_id",id).neq("status","filed").lt("due_on",today).order("due_on").limit(3),
    supabase.from("email_events").select("id, contact_id, received_at, label, delivery, provider_message_id, contacts(name_enc)",{count:"exact", head: !listsMail}).eq("firm_id",firm).eq("client_id",id).order("received_at",{ascending:false}).order("id").range(mailRange, mailRange + (tab === "emails" ? 49 : 2)),
    tab === "documents" ? supabaseAdmin().from("connected_accounts").select("settings").eq("firm_id",firm).eq("kind","drive").maybeSingle() : Promise.resolve({ data: null }),
    // The next return still to file from today on, for the header's countdown.
    supabase.from("tasks").select("code, period_key, due_on").eq("firm_id", firm).eq("kind", "compliance").eq("client_id", id).neq("status", "filed").gte("due_on", today).order("due_on").limit(1).maybeSingle(),
    // Whether Returns offers Figures and Prepared forms.
    tab === "returns" ? supabase.from("documents").select("id",{count:"exact",head:true}).eq("firm_id",firm).eq("client_id",id).not("prepared","is",null).neq("status","deleted") : Promise.resolve({ count: 0 }),
    tab === "returns" ? supabase.from("datasets").select("form_code",{count:"exact"}).eq("firm_id",firm).eq("client_id",id) : Promise.resolve({ data: [], count: 0 }),
    // What this person may do here, with any grant or request of theirs still open (5.17.2).
    supabase.from("requests").select("reason_code, status, details").eq("kind", "permission").eq("client_id", id).eq("details->>by", userId).in("status", ["pending", "approved"]).gt("expires_at", new Date().toISOString()),
    // Returns tab: the return being marked filed in the side panel, and the ones just changed.
    tab === "returns" && canFile && uuid.test(marking ?? "") ? supabase.from("tasks").select("id, code, period_key, due_on").eq("firm_id", firm).eq("kind", "compliance").eq("client_id", id).eq("id", marking!).neq("status", "filed").maybeSingle() : Promise.resolve({ data: null }),
    tab === "returns" && taskChanges[marked ?? ""] && doneIds.length ? supabase.from("tasks").select("id, code, period_key").eq("firm_id", firm).eq("client_id", id).in("id", doneIds) : Promise.resolve({ data: null }),
    // Asking is for the month of the next return due for this client, else last month.
    ask ? supabase.from("tasks").select("period_key").eq("firm_id", firm).eq("kind", "compliance").eq("client_id", id).neq("status", "filed").gte("due_on", today).order("due_on").limit(12) : Promise.resolve({ data: [] }),
    files && (namedIds.length || owner) ? supabase.from("documents").select(fileColumns).eq("firm_id", firm).eq("client_id", id).or([...(namedIds.length ? [`id.in.(${namedIds})`] : []), ...(owner ? ["status.eq.deleted"] : [])].join(",")).order("received_at", { ascending: false }) : Promise.resolve({ data: [] }),
    // Whether Returns offers Figures: a GST spreadsheet or JSON file filed for this client.
    tab === "returns" ? supabase.from("documents").select("id").eq("firm_id", firm).eq("client_id", id).eq("work_type", "gst").eq("status", "filed").filter("name", "imatch", "\\.(xlsx?|ods|csv|json)$").limit(1) : Promise.resolve({ data: [] }),
  ]);
  if (!client) notFound();
  const crypto = serverCrypto();
  // Where each open return stands, and who may fill it by hand.
  const stages = await returnStages(supabase, firm, sub === "returns" ? (tasks ?? []).filter((task) => task.status !== "filed").map((task) => task.id) : []);
  const canPrepare = !viewOnly && membership.may("edit_figures", id);
  // Who confirmed each dated notice, from the firm's activity.
  const dated = tab === "notices" ? (notices ?? []).filter((notice) => (notice.details as unknown as NoticeDetails).action_date).map((notice) => notice.id) : [];
  // The portal file each open monthly GSTR-3B is read from (PLAN.md 5.3.1): the month's GSTR-2B.
  const months = sub === "returns" ? (tasks ?? []).flatMap((task) => (task.code === "GSTR3B_M" && task.status !== "filed" && task.period_key ? [task.period_key] : [])) : [];
  // And each open ITR's, for its year: Form 16, Form 26AS and AIS.
  const itrYears = sub === "returns" ? (tasks ?? []).flatMap((task) => (task.code?.startsWith("ITR") && task.status !== "filed" && task.period_key ? [task.period_key.slice(0, 4)] : [])) : [];
  // The latest open request's upload link, opened with the firm's key for those who may ask,
  // to copy and send by hand.
  const openAsk = viewOnly ? undefined : (asks ?? []).filter((request) => request.status === "pending" && (request.details as unknown as DocumentRequest).link_enc).sort((a, b) => (b.expires_at ?? "").localeCompare(a.expires_at ?? ""))[0];
  // The second and last round: the client's own numbers and contacts opened with the firm's key,
  // and what the shown lists need from them.
  const [numbers, email, contacts, { data: confirms }, { data: statements }, uploadLink, { data: taxPapers }] = await Promise.all([
    Promise.all(client.client_registrations.map(async (registration) => ({ ...registration, number: await crypto.decrypt(firm, `clients/${client.id}/${registration.kind}`, registration.number_enc) }))),
    client.email_enc ? crypto.decrypt(firm, `clients/${client.id}/email`, client.email_enc) : "",
    Promise.all(
      client.contact_clients.map(async (link) => ({
        ...link,
        name: link.contacts ? await crypto.decrypt(firm, `contacts/${link.contact_id}/name`, link.contacts.name_enc) : "",
        email: link.contacts ? await crypto.decrypt(firm, `contacts/${link.contact_id}/email`, link.contacts.email_enc) : "",
      })),
    ),
    dated.length ? supabaseAdmin().from("activity_log").select("entity_id, action, actor_id").eq("firm_id", firm).in("entity_id", dated).in("action", confirmAction) : Promise.resolve({ data: [] }),
    months.length ? supabase.from("documents").select("period_key").eq("client_id", id).eq("document_type", "GSTR-2B").neq("status", "deleted").in("period_key", months) : Promise.resolve({ data: [] }),
    openAsk && (async () => `${process.env.APP_BASE_URL ?? `${(await headers()).get("x-forwarded-proto") ?? "http"}://${(await headers()).get("host")}`}/u/${await crypto.decrypt(firm, `requests/${openAsk.id}/link`, (openAsk.details as unknown as DocumentRequest).link_enc!)}`)(),
    itrYears.length ? supabase.from("documents").select("document_type, period_key").eq("client_id", id).in("document_type", ["Form 16", "Form 130", "Form 26AS", "Form 168", "AIS"]).neq("status", "deleted") : Promise.resolve({ data: [] }),
  ]);
  const manage = canManageClients(membership.role);
  // Send reminder now on the Returns tab: those who manage clients and those who look after this one.
  const reminds = sub === "returns" && !viewOnly && !!client.email_enc && !client.reminders_paused && (manage || !!(await supabase.rpc("looks_after", { target_firm: firm, client: client.id })).data);
  const confirmedBy = new Map([...confirmers(confirms ?? [])].map(([notice, by]) => [notice, personName(people?.find((person) => person.user_id === by)?.email)]));
  // The lists for the work this client's services need are ticked when asking for files.
  const usualWork = new Set(client.client_registrations.flatMap((registration) => (registration.services ?? []).map(workOfService)));
  const documents = pageFiles ?? [];
  const removedFiles = (namedFiles ?? []).filter((file) => file.status === "deleted");
  const live = (fileId?: string) => (namedFiles ?? []).find((file) => file.id === fileId && file.status !== "deleted" && file.status !== "earlier");
  // Requests stay listed until every file the client sent has been checked.
  const asking = (asks ?? []).filter((request) => ((request.details as unknown as DocumentRequest).items ?? []).some((item) => !item.checked));
  const firmTypes = (membership.settings.document_types ?? []) as string[];
  const open = (right: Right, status: string, documentId?: string) =>
    (mine ?? []).some((request) => request.reason_code === right && request.status === status && (!documentId || (request.details as { document_id?: string }).document_id === documentId));
  const canRename = !viewOnly && membership.may("rename", id);
  const canUpload = !viewOnly && (membership.may("upload", id) || open("upload", "approved"));
  const canSend = (documentId: string) => !viewOnly && (membership.may("send", id) || open("send", "approved", documentId));
  const canRemove = (documentId: string) => !viewOnly && (owner || open("remove", "approved", documentId));
  const askButton = (right: Right, label: string, documentId?: string) =>
    viewOnly ? null : open(right, "pending", documentId) ? (
      <span className="hint">Asked</span>
    ) : (
      <form action={askPermission}>
        <input type="hidden" name="client" value={client.id} />
        <input type="hidden" name="right" value={right} />
        {documentId && <input type="hidden" name="document" value={documentId} />}
        <Pending className="b b-secondary" aria-label={documentId ? `${label}: ${live(documentId)?.name}` : label}>
          {label}
        </Pending>
      </form>
    );
  // A file waiting to be checked because the client already has it, or one like it, on any page.
  const sameAs = (file: (typeof documents)[number]) => {
    const twin = twins?.find((other) => other.id !== file.id && other.sha256 === file.sha256);
    if (twin) return `Same file as ${twin.name}`;
    const like = file.period_key && twins?.find((other) => other.id !== file.id && other.document_type === file.document_type && other.period_key === file.period_key);
    return like ? `Same type and period as ${like.name}` : "";
  };
  // One paper's panel: correct it, send it, remove it. A send that failed comes back to it.
  const paper = live(edit ?? send);
  // Where each listed paper and the open one came from, and when (src/lib/paper-origin.ts);
  // the papers like those waiting to be checked, and the open paper's earlier versions.
  const listed = tab === "documents" ? [...documents, ...(paper ? [paper] : [])] : [];
  const checking = documents.filter((file) => file.status === "to_check");
  const periods = checking.flatMap((file) => (file.period_key ? [`"${file.period_key}"`] : []));
  const versions = supabase.from("documents").select(fileColumns).eq("firm_id", firm).eq("client_id", id).eq("status", "earlier");
  const [origins, { data: twins }, { data: earlierFiles }, suggested] = await Promise.all([
    paperOrigins(supabase, firm, listed.map((file) => ({ ...file, client_id: id, clients: client })), paper?.id),
    checking.length ? supabase.from("documents").select("id, name, sha256, document_type, period_key").eq("firm_id", firm).eq("client_id", id).not("status", "in", "(deleted,earlier)").or([`sha256.in.(${checking.map((file) => file.sha256)})`, ...(periods.length ? [`period_key.in.(${periods})`] : [])].join(",")) : Promise.resolve({ data: [] }),
    paper ? (paper.registration_id ? versions.eq("registration_id", paper.registration_id) : versions.is("registration_id", null)).eq("document_type", paper.document_type).eq("period_key", paper.period_key).order("received_at", { ascending: false }) : Promise.resolve({ data: [] }),
    // A scan to check, which this person sees: its OCR text may suggest its type and period
    // (src/lib/search.ts). Its details are never given to a person's own reads.
    paper?.status === "to_check" ? supabaseAdmin().from("documents").select("details").eq("firm_id", firm).eq("id", paper.id).single().then(({ data }) => scanType(firm, paper.id, data?.details)) : null,
  ]);
  const earlier = earlierFiles ?? [];
  const noticeFile = (namedFiles ?? []).find((file) => file.id === (renamed ?? saved ?? removed ?? restored));
  const sharedFile = live(shared);
  const receivers = contacts.filter((contact) => contact.can_receive_documents);
  // Who a filed paper can go to. Sending is its own step that names the paper and the address.
  const recipients = [...(email ? [{ value: "client", name: client.name, email }] : []), ...receivers.map((contact) => ({ value: contact.contact_id, name: contact.name, email: contact.email }))];
  const sendable = paper?.status === "filed" && paper.share_policy !== "internal";
  const confirmSend = !!paper && paper.id === send && sendable && !viewOnly && !ask && canSend(paper.id) && !!recipients.length;
  const order = ((drive?.settings as { folder_order?: FolderOrder } | undefined)?.folder_order ?? "year_client_work") as FolderOrder;
  const rule = new Map(rules?.map((r) => [r.code, r]));
  const needs2b = new Set(months.filter((month) => !statements?.some((row) => row.period_key === month)));
  // Form No. 130 and Form No. 168 replace Form 16 and Form 26AS from tax year 2026-27, and either
  // name answers either. Only a salary has a Form 16, so it is listed for an individual on the
  // non-business return (ITR_NA) or a client with one on file.
  const newer: Record<string, string> = { "Form 16": "Form 130", "Form 26AS": "Form 168" };
  const held = new Set((taxPapers ?? []).map((paper) => `${paper.period_key}:${Object.keys(newer).find((type) => newer[type] === paper.document_type) ?? paper.document_type}`));
  const salaried = (client.kind === "individual" && !!tasks?.some((task) => task.code === "ITR_NA")) || [...held].some((paper) => paper.endsWith(":Form 16"));
  const itrNeeds = new Map(itrYears.map((year) => {
    const papers = (salaried ? ["Form 16", "Form 26AS", "AIS"] : ["Form 26AS", "AIS"]).map((type) => ({ name: paperType(year >= "2027" ? newer[type] ?? type : type), added: held.has(`${year}:${type}`) }));
    const missing = papers.filter((paper) => !paper.added), names = (missing.length ? missing : papers).map((paper) => paper.name).join(", ").replace(/, ([^,]*)$/, " and $1");
    return [year, { missing: !!missing.length, line: `. ${names} for ${periodName(year)}: ${missing.length ? "not added yet" : "added"}` }];
  }));
  // Services sit on a number: GST returns on a GSTIN, TDS on a TAN, income tax on the PAN.
  // Only those for this kind of client, and any already chosen, are offered.
  const servicesFor = ({ kind, services }: { kind: string; services: string[] }) =>
    rules?.filter((r) => (r.due_rule as { for?: string }).for === kind && (!r.client_kinds || r.client_kinds.includes(client.kind) || services.includes(r.code))) ?? [];
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
  // A team or a person looking after the client, by name.
  const who = (assignment: { team_id: string | null; user_id: string | null }) =>
    (assignment.team_id ? teams?.find((team) => team.id === assignment.team_id)?.name : personName(people?.find((person) => person.user_id === assignment.user_id)?.email)) ?? "";
  const lookers = [...assigned].sort((a, b) => lookAfter.indexOf(a.role) - lookAfter.indexOf(b.role));
  const gstin = numbers.find((registration) => registration.kind === "gstin")?.number;
  const pan = numbers.find((registration) => registration.kind === "pan")?.number;
  // "Due in 5 days" for the next return, today counted as 0.
  const dueIn = nextDue ? Math.round((Date.parse(nextDue.due_on) - Date.parse(today)) / DAY) : 0;
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
  const askPeriod = due?.map((task) => task.period_key).find((key) => periodChoices(today).includes(key ?? "")) ?? periodChoices(today)[1];
  const openNotices = (notices ?? []).filter((notice) => ["upcoming", "in_progress"].includes(notice.status));
  const showExtraction = !!drafts || !!pan || !!sheets?.length;
  const showOutputs = !!draftForms?.some(row=>["GSTR1","GSTR3B","ITR"].includes(row.form_code)) || !!outputs;
  const counts: Record<Main, number | undefined> = { overview: undefined, emails: mailCount ?? 0, documents: fileCount ?? 0, returns: show === "filed" ? undefined : taskCount ?? 0, notices: noticeCount ?? 0 };
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
  // A page of 50 at a time keeps a busy client's page quick; paging keeps the view's filter.
  const keep = `${show === "filed" ? "&show=filed" : ""}${find ? `&find=${encodeURIComponent(find)}` : ""}`;
  const pager = (total: number, rows: number, label: string, key: string) => (
    <nav className="pager" aria-label={`${label} pages`}>
      <p>Showing {rows ? (start + 1).toLocaleString("en-IN") : 0} to {rows ? (start + rows).toLocaleString("en-IN") : 0} of {total.toLocaleString("en-IN")} {label.toLowerCase()}</p>
      <span>
        {page > 1 && <Link className="b b-secondary" href={`?tab=${key}&page=${page - 1}${keep}`}>Previous</Link>}
        {start + rows < total && <Link className="b b-secondary" href={`?tab=${key}&page=${page + 1}${keep}`}>Next</Link>}
      </span>
    </nav>
  );
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
  // The emails stream in once the mailbox has given their subjects; their outline shows first.
  const mailList = (className: string) =>
    mails?.length ? (
      <Suspense fallback={<SkeletonRows rows={mails.length} />}>
        <MailRows firm={firm} clientName={client.name} mails={mails} className={className} />
      </Suspense>
    ) : null;
  // A number with its own Copy button, as the header and the Registrations card show it.
  const idNumber = (kind: string, number: string) => (
    <span className="client-id">
      <span className="num">{number}</span>
      <CopyButton text={number} label={kind} />
    </span>
  );
  const lateTotal = lateCount ?? 0;
  const undated = openNotices.filter((notice) => !(notice.details as unknown as NoticeDetails).action_date);
  const attention = Math.min(lateTotal, 3) + (lateTotal > 3 ? 1 : 0) + asking.length + undated.length;

  return (
    <div className="fill clients-page client-record">
      {/* The header: Clients / the client's name, and the quick actions. Under it the record:
          big avatar, name, numbers, who looks after it and what is due next. */}
      <PageHead
        crumbs={[["/app/clients", "Clients"]]}
        title={client.name}
        sub={
        <div className="client-head">
          <div className="client-who">
            <Avatar name={client.name} square big />
            <div>
              <p className="client-name">{client.name}</p>
              <div className="client-meta">
                <Badge plain>{clientKinds[client.kind as ClientKind]}</Badge>
                {client.archived_at && <Badge>Archived</Badge>}
                {gstin && (
                  <span className="client-id">
                    <span className="client-id-kind">GSTIN</span>
                    {idNumber("GSTIN", gstin)}
                    {gstins.length > 1 && <span className="hint">and {gstins.length - 1} more</span>}
                  </span>
                )}
                {pan && (
                  <span className="client-id">
                    <span className="client-id-kind">PAN</span>
                    {idNumber("PAN", pan)}
                  </span>
                )}
                <span className="client-team">
                  {lookers.length ? (
                    <>
                      <span className="avatar-stack">
                        {lookers.slice(0, 3).map((assignment) => <Avatar key={assignment.value} name={who(assignment)} square={!!assignment.team_id} />)}
                      </span>
                      Looked after by {who(lookers[0])}
                      {lookers.length > 1 && ` and ${lookers.length - 1} more`}
                    </>
                  ) : (
                    "Nobody looks after this client yet"
                  )}
                </span>
              </div>
              {(!!lateTotal || nextDue) && !client.archived_at && (
                <div className="client-due">
                  {!!lateTotal && (
                    <Link className="badge late" href={`${base}?tab=returns`}>
                      {lateTotal} {lateTotal === 1 ? "return" : "returns"} late
                    </Link>
                  )}
                  {nextDue && (
                    <Link className={`badge plain ${dueIn <= 3 ? "warn" : "blue"}`} href={`${base}?tab=returns`}>
                      <CalendarClock size={13} aria-hidden />
                      Next due: {rule.get(nextDue.code ?? "")?.name ?? nextDue.code} {periodLabel(rule.get(nextDue.code ?? "")?.frequency ?? null, nextDue.period_key)}, {dueIn === 0 ? "today" : dueIn === 1 ? "tomorrow" : `in ${dueIn} days`}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        }
        actions={
        <>
          {!viewOnly && (
            <Link className="b b-secondary" href={`${here}${here.includes("?") ? "&" : "?"}ask=1`} scroll={false}>
              <FilePlus2 size={15} aria-hidden />
              Ask for papers
            </Link>
          )}
          {canUpload && (
            <Link className="b b-secondary" href={`${base}?tab=documents&upload=1`} scroll={false}>
              <FileUp size={15} aria-hidden />
              Upload papers
            </Link>
          )}
          {/* The shared Copy button, given its words by clients.css. */}
          {uploadLink && (
            <span className="copy-words">
              <CopyButton text={uploadLink} label="Upload link" />
            </span>
          )}
          {!viewOnly && (
            <Link className="b b-secondary" href={`${base}?tab=notice`} scroll={false}>
              <Scale size={15} aria-hidden />
              Add a notice
            </Link>
          )}
          {(email || contacts.length > 0) && !client.archived_at && (
            <Link className="b b-primary" href={`/app/inbox?compose=${client.id}`}>
              <Mail size={15} aria-hidden />
              Write to client
            </Link>
          )}
        </>
        }
      />
      <LinkTabs label="Client" items={(Object.keys(mains) as Main[]).map((key) => ({ href: `${base}${key === "overview" ? "" : `?tab=${key}`}`, label: mains[key], count: counts[key], current: tab === key }))} />

      <ViewTransition key={sub} enter="tab-in" exit="tab-out" default="none">
      <div className="pane client-pane">
        {!panel && !docPanel && alert}

        {tab === "overview" && (
          <div className="client-grid">
            <div className="client-col">
              <Card id="attention" title="Needs attention" Icon={TriangleAlert} kind="notice" count={attention} countTone="late">
                {attention ? (
                  <ul className="app-rows stagger">
                    {late?.map((task) => (
                      <Row
                        key={task.id}
                        lead={<IconTile Icon={AlarmClock} kind="late" />}
                        title={`${rule.get(task.code ?? "")?.name ?? task.code} is late`}
                        meta={`Was due ${dueLabel(task.due_on)}`}
                        status={<Badge tone="late">Late</Badge>}
                        action={
                          canFile && (
                            <Link className="b b-secondary" href={`${base}?tab=returns&task=${task.id}`} scroll={false}>
                              Mark filed
                            </Link>
                          )
                        }
                      />
                    ))}
                    {lateTotal > 3 && (
                      <Row
                        lead={<IconTile Icon={AlarmClock} kind="late" />}
                        title={`${lateTotal - 3} more late returns`}
                        action={
                          <Link className="b b-ghost" href={`${base}?tab=returns`}>
                            See returns
                          </Link>
                        }
                      />
                    )}
                    {asking.map((request) => {
                      const details = request.details as unknown as DocumentRequest;
                      return (
                        <Row
                          key={request.id}
                          lead={<IconTile Icon={FileClock} kind="papers" />}
                          title={details.items.map((item) => item.type).join(", ")}
                          meta={`${details.items.filter((item) => item.received.length).length} of ${details.items.length} received`}
                          status={<Badge tone="warn">Asked</Badge>}
                        />
                      );
                    })}
                    {undated.map((notice) => (
                      <Row
                        key={notice.id}
                        lead={<IconTile Icon={Scale} kind="notice" />}
                        title={(notice.details as unknown as NoticeDetails).notice_type}
                        meta={`Check by ${dueLabel(notice.due_on)}`}
                        status={<Badge tone="warn">Notice</Badge>}
                        action={
                          <Link className="b b-ghost" href={`${base}?tab=notices`}>
                            Open
                          </Link>
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="app-card-none">Nothing needs you for this client today.</p>
                )}
              </Card>
              <Card id="latest-mail" title="Latest emails" Icon={Mail} kind="reply" end={!!mails?.length && <Link className="b b-ghost" href={`${base}?tab=emails`}>All emails</Link>}>
                {mailList("app-rows client-mails") ?? <p className="app-card-none">No email from this client yet. Emails from the client&apos;s address and its contacts show here.</p>}
              </Card>
              {numbers.some((registration) => servicesFor(registration).length) && (
                <Card id="services-card" title="Services" Icon={ListChecks} kind="week" end={manage && <Link className="b b-ghost" href={`${base}?tab=services`} scroll={false}>Change services</Link>}>
                  <ul className="app-rows">
                    {numbers.filter((registration) => servicesFor(registration).length).map((registration) => (
                      <Row key={registration.id} title={numberKinds[registration.kind as NumberKind].name} meta={registration.services.map((code) => rule.get(code)?.name ?? code).join(", ") || "None chosen yet"} />
                    ))}
                  </ul>
                </Card>
              )}
            </div>
            <div className="client-col">
              <Card id="details-card" title="Details" Icon={Info} end={manage && <Link className="b b-ghost" href={`${base}?tab=details`} scroll={false}>Edit details</Link>}>
                <dl className="props client-props">
                  <div><dt>Client type</dt><dd>{clientKinds[client.kind as ClientKind]}</dd></div>
                  <div><dt>Email</dt><dd>{email || <span className="hint">None yet</span>}</dd></div>
                  <div><dt>Group</dt><dd>{groupName ? <Link href={`/app/clients?group=${client.group_id}`}>{groupName}</Link> : <span className="hint">None</span>}</dd></div>
                  {!!branches.length && <div><dt>Branch</dt><dd>{branchName ? <Link href={`/app/clients?branch=${client.branch_id}`}>{branchName}</Link> : <span className="hint">None</span>}</dd></div>}
                  <div><dt>Reminders</dt><dd>{client.reminders_paused ? <Badge tone="warn">Paused</Badge> : <Badge tone="done">On</Badge>}</dd></div>
                  <div><dt>Changes</dt><dd><Link href={`${base}?tab=activity`} scroll={false}>Activity</Link></dd></div>
                </dl>
              </Card>
              <Card id="numbers" title="Tax numbers" Icon={Hash} kind="docs" end={manage && <Link className="b b-ghost" href={`${base}?tab=numbers`} scroll={false}>Change numbers</Link>}>
                {numbers.length ? (
                  <ul className="app-rows">
                    {numbers.map((registration) => {
                      const name = numberKinds[registration.kind as NumberKind].name;
                      return <Row key={registration.id} title={name} status={idNumber(name, registration.number)} />;
                    })}
                  </ul>
                ) : (
                  <p className="app-card-none">No numbers yet. A PAN or GSTIN helps InboxCA recognise the client&apos;s papers.</p>
                )}
              </Card>
              <Card id="contacts-card" title="Contacts" Icon={Contact} kind="approve" end={manage && <Link className="b b-ghost" href={`${base}?tab=contacts`} scroll={false}>Change contacts</Link>}>
                {contacts.length ? (
                  <ul className="app-rows">
                    {contacts.map((contact) => (
                      <Row key={contact.contact_id} lead={<Avatar name={contact.name} />} title={contact.name} meta={[contact.email, contact.relation].filter(Boolean).join(", ")} />
                    ))}
                  </ul>
                ) : (
                  <p className="app-card-none">No contacts yet.</p>
                )}
              </Card>
              <Card id="team-card" title="Looked after by" Icon={UsersRound} kind="papers" end={manage && <Link className="b b-ghost" href={`${base}?tab=team`} scroll={false}>Change people</Link>}>
                {lookers.length ? (
                  <ul className="app-rows">
                    {lookers.map((assignment) => (
                      <Row key={assignment.value} lead={<Avatar name={who(assignment)} square={!!assignment.team_id} />} title={who(assignment)} meta={assignmentRoles[assignment.role as keyof typeof assignmentRoles]} />
                    ))}
                  </ul>
                ) : (
                  <p className="app-card-none">Nobody is assigned yet.</p>
                )}
              </Card>
            </div>
          </div>
        )}

        {tab === "emails" && (
          <Card id="client-mail" title="Emails" Icon={Mail} kind="reply" count={mailCount ?? 0}>
            {mailList("app-rows client-mails stagger") ?? (
              <Empty Icon={Mail} kind="reply" title="No email from this client yet">
                <span>Emails from the client&apos;s address and its contacts show here once the firm email is connected.</span>
              </Empty>
            )}
            {(mailCount ?? 0) > 50 && <div className="app-card-foot">{pager(mailCount ?? 0, mails?.length ?? 0, "Emails", "emails")}</div>}
          </Card>
        )}

        {tab === "documents" && (
          <>
            <div className="client-tools">
              <Form action={base} role="search" className="clients-find">
                <input type="hidden" name="tab" value="documents" />
                <span className="search">
                  <Search size={16} aria-hidden />
                  <input name="find" type="search" defaultValue={find} placeholder="Find a paper by a word in it or its name" aria-label="Find a paper" />
                </span>
                <button className="b b-secondary" type="submit">Find</button>
                {find && <Link className="b b-ghost" href={`${base}?tab=documents`}>Show all</Link>}
              </Form>
              {!canUpload && <span className="page-actions">{askButton("upload", "Ask to upload")}</span>}
            </div>
            <DroppedNotice value={dropped} />
            {askedRight && <Toast>Permission asked. Your manager or the owner answers in their Inbox. Once they allow it, the button appears here and works once, within one hour.</Toast>}
            {sharedFile && <Toast>Sent {sharedFile.name}. The link works for 7 days and 5 downloads.</Toast>}
            {askedFor === "sent" && <Toast>The client was emailed a private upload link. What they upload is saved here.</Toast>}
            {askedFor && askedFor !== "sent" && (
              <p className="notice" role="status">
                <span>
                  InboxCA could not email the client, so send this private upload link yourself. It works for 30 days: <span className="num link-once">{askedFor}</span>
                </span>
              </p>
            )}
            {noticeFile && (
              <Toast
                undo={
                  (removed ? owner : canRename) &&
                  (renamed || removed) && (
                    <form action={removed ? removeDocument : manageDocument}>
                      <input type="hidden" name="document" value={noticeFile.id} />
                      <Pending className="b" name="intent" value={removed ? "restore" : "undo"}>
                        {removed ? "Restore" : "Undo"}
                      </Pending>
                    </form>
                  )
                }
              >
                {removed ? `Removed ${noticeFile.name}. It stays in the Removed papers folder of your firm's drive for 30 days.` : restored ? `Restored ${noticeFile.name}.` : `Saved as ${noticeFile.name}.`}
              </Toast>
            )}
            {!!asking.length && (
              <Card id="asks" title="Papers asked for" Icon={FileClock} kind="papers" count={asking.length} countTone="warn">
                <ul className="app-rows" aria-label="Papers asked for">
                  {asking.map((request) => {
                    const details = request.details as unknown as DocumentRequest;
                    const got = details.items.filter((item) => item.received.length).length;
                    return (
                      <Row
                        key={request.id}
                        title={`Asked for ${details.items.map((item) => item.type).join(", ")}${details.period ? ` for ${periodName(details.period)}` : ""}`}
                        meta={`${got} of ${details.items.length} received. The link works until ${dueLabel(request.expires_at!.slice(0, 10))}.`}
                        status={<Badge tone={got === details.items.length ? "done" : "warn"}>{got} of {details.items.length}</Badge>}
                        action={
                          !viewOnly && (
                            <span className="cell-form">
                              {details.items.map((item, at) =>
                                item.received.length && !item.checked ? (
                                  <form key={at} action={checkRequestItem} className="cell-form">
                                    <input type="hidden" name="request" value={request.id} />
                                    <input type="hidden" name="item" value={at} />
                                    <span className="hint">{item.type}</span>
                                    <Pending className="b b-secondary" name="intent" value="checked" aria-label={`${item.type} is right`}>
                                      Mark checked
                                    </Pending>
                                    <Pending className="b b-ghost" name="intent" value="again" aria-label={`Ask again for ${item.type}`}>
                                      Ask again
                                    </Pending>
                                  </form>
                                ) : null,
                              )}
                            </span>
                          )
                        }
                      />
                    );
                  })}
                </ul>
              </Card>
            )}
            <section className="client-docs" aria-labelledby="files">
              <h2 id="files" className="sr-only">Papers</h2>
              {documents.length ? (
                <div className="clients-table">
                  <table className="t">
                    <thead>
                      <tr>
                        <th scope="col">Paper</th>
                        <th scope="col">Paper type</th>
                        <th scope="col">Period</th>
                        <th scope="col">Came from</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="shrink"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="stagger">
                      {documents.map((document) => {
                        const twin = document.status === "to_check" && sameAs(document);
                        const path = folderFor(order, client.name, { work: document.work_type as WorkType, period: document.period_key, receivedAt: document.received_at, toCheck: document.status === "to_check" }).join(" / ");
                        return (
                          <tr key={document.id}>
                            <td>
                              <span className="who">
                                <IconTile Icon={fileIcon(document.name)} kind="docs" />
                                <span className="client-paper">
                                  <Link className="row-link" href={`/app/files/${document.id}/view`}>
                                    {document.name}
                                  </Link>
                                  <span className="sub num">
                                    {twin || (
                                      <>
                                        {path}
                                        <CopyButton text={path} label="Drive folder" />
                                      </>
                                    )}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td>{paperType(document.document_type)}</td>
                            <td>{periodName(document.period_key) || <span className="hint">None</span>}</td>
                            <td className="hint">
                              <CameFrom origin={origins.get(document.id)!} why={!twin} />
                            </td>
                            <td>
                              <Badge tone={document.status === "to_check" ? "warn" : document.status === "missing" ? "late" : "done"}>
                                {document.status === "to_check" ? "To check" : document.status === "missing" ? "Missing in the drive" : "Saved"}
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty Icon={FileText} kind="docs" title={find ? "No paper matches" : "No papers yet"}>
                  <span>{find ? "Try another word, or show all papers." : "Attachments this client emails are saved here, in your firm's drive. You can also ask the client for them."}</span>
                  {!find && !viewOnly && <Link className="b b-primary" href={`${base}?tab=documents&ask=1`} scroll={false}>Ask for papers</Link>}
                </Empty>
              )}
            </section>
            {(fileCount ?? 0) > 50 && pager(fileCount ?? 0, documents.length, "Papers", "documents")}
            {owner && !!removedFiles.length && (
              <Card id="removed" title="Removed in the last 30 days" Icon={Trash2} count={removedFiles.length}>
                <ul className="app-rows">
                  {removedFiles.map((document) => (
                    <Row
                      key={document.id}
                      lead={<IconTile Icon={fileIcon(document.name)} />}
                      title={document.name}
                      action={
                        <form action={removeDocument}>
                          <input type="hidden" name="document" value={document.id} />
                          <Pending className="b b-secondary" name="intent" value="restore">Restore</Pending>
                        </form>
                      }
                    />
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {tab === "returns" && (showExtraction || showOutputs) && (
          <LinkTabs kind="pills" label="Parts of the Returns tab" items={[["returns", "Returns"], ...(showExtraction ? [["extraction", "Figures"]] : []), ...(showOutputs ? [["outputs", "Return files"]] : [])].map(([key, label]) => ({ href: `${base}?tab=${key}`, label, current: sub === key }))} />
        )}
        {sub === "returns" && (
          <>
            <DroppedNotice value={dropped} />
            <Suspense fallback={null}>
              <RemindToast />
            </Suspense>
            <Card
              id="due"
              title={show === "filed" ? "Filed returns" : "Returns to file"}
              Icon={CalendarDays}
              kind="week"
              count={taskCount ?? 0}
              end={<Link className="b b-ghost" href={`?tab=returns${show==="filed" ? "" : "&show=filed"}`}>{show==="filed" ? "Show returns still to file" : "Show filed returns"}</Link>}
            >
              {tasks?.length ? (
                <ul className="app-rows stagger">
                  {tasks.map((task) => {
                    const r = rule.get(task.code ?? "");
                    const overdue = task.status !== "filed" && task.due_on < today;
                    const note = reminderNote(task.details as { reminded?: string[]; skipped?: { reason: string } });
                    const filed = task.details as { filed_on?: string; by?: string; ack?: string };
                    const title = `${r?.name} ${periodLabel(r?.frequency ?? null, task.period_key)}`;
                    const [day, month] = dueLabel(task.due_on).split(" ");
                    return (
                      <Row
                        key={task.id}
                        lead={
                          <span className={`today-date${overdue ? " is-late" : ""}`} aria-hidden>
                            <span>{month}</span>
                            <strong>{day}</strong>
                          </span>
                        }
                        title={title}
                        meta={
                          task.status === "filed"
                            ? <>Filed{filed.filed_on && ` ${dueLabel(filed.filed_on)}`}{filed.by && ` by ${personName(people?.find((person) => person.user_id === filed.by)?.email)}`}{filed.ack && <>, ARN <span className="num">{filed.ack}</span><CopyButton text={filed.ack} label="ARN" /></>}</>
                            : <>Due {dueLabel(task.due_on)}{!r?.verified_on && "*"}{note && `. ${note}`}{task.code === "GSTR3B_M" && task.period_key && months.includes(task.period_key) && `. GSTR-2B for ${periodName(task.period_key)}: ${needs2b.has(task.period_key) ? "not added yet" : "added"}`}{task.code?.startsWith("ITR") && itrNeeds.get(task.period_key?.slice(0, 4) ?? "")?.line}<StageLine code={task.code} work={stages.get(task.id)} /></>
                        }
                        status={
                          <Badge tone={task.status === "filed" ? "done" : overdue ? "late" : task.status === "in_progress" ? "blue" : ""}>
                            {overdue ? "Late" : taskStatuses[task.status as keyof typeof taskStatuses]}
                          </Badge>
                        }
                        more={
                          reminds && task.status !== "filed" && task.due_on <= addDays(today, 7) && (
                            <form action={remindClient}>
                              {returnsState}
                              <input type="hidden" name="from" value="client" />
                              <Pending className="b b-ghost" busy="Sending" aria-label={`Send ${client.name} a reminder now`}>Send reminder now</Pending>
                            </form>
                          )
                        }
                        action={<>
                          {canPrepare && fills(task.code) && fillable(stages.get(task.id)) && <Fill task={task.id} label={title} />}
                          {stages.get(task.id)?.stage === "filled" && <Link className="b b-secondary" href={`/app/files/${stages.get(task.id)!.form}/view`} aria-label={`Check figures of ${title}`}>Check figures</Link>}
                          {canFile && task.status !== "filed" ? (
                            task.due_on <= addDays(today, 30) && <Link className={`b ${(canPrepare && fills(task.code) && fillable(stages.get(task.id))) || stages.get(task.id)?.stage === "filled" ? "b-ghost" : "b-secondary"}`} href={`${returnsHref}&task=${task.id}`} scroll={false} aria-label={`Mark ${title} filed`}>Mark filed</Link>
                          ) : (
                            canFile && (
                              <form action={manageTasks}>
                                {returnsState}
                                <input type="hidden" name="task" value={task.id} />
                                <Pending className="b b-secondary" name="intent" value="reopen" aria-label={`${title} was not filed after all`}>Not filed after all</Pending>
                              </form>
                            )
                          )}
                        </>}
                      />
                    );
                  })}
                </ul>
              ) : (
                <p className="app-card-none">{show==="filed" ? "No filed returns on this page." : "No returns due. Add a number and choose its services on Overview."}</p>
              )}
              {tasks?.some((task) => !rule.get(task.code ?? "")?.verified_on) && <p className="app-card-foot hint">InboxCA has not yet checked dates marked * against the government notification.</p>}
            </Card>
            {(!!needs2b.size || [...itrNeeds.values()].some((needs) => needs.missing)) && membership.may("portal_files", client.id) && <PortalDrop clientId={client.id} back="returns" />}
            {pager(taskCount ?? 0,tasks?.length ?? 0,"Returns","returns")}
          </>
        )}
        {sub === "extraction" && <><DatasetReview clientId={id} draftId={draft} lineId={line} check={check} view={view}/><div className="fig-tools">{pan && <Card id="itr-return" className="tool" title="Income tax return" Icon={FileText} kind="docs" end={<Link className="b b-secondary" href={`${base}/itr`}>Open the return</Link>}><p className="app-card-none">ITR-1 to ITR-4, filled with the client&apos;s PAN and the figures InboxCA already holds for the year. The rest is listed for you to fill.</p></Card>}<PortalInput clientId={id} message={portal}/><SalesInput clientId={id} source={source} section={section} header={header} read={read}/><PurchaseMatch clientId={id} searchParams={searchParams}/></div></>}
        {sub === "outputs" && <PreparedForms client={id} message={formMessage}/>}

        {tab === "notices" && (
          <>
            <p className="client-tools hint">
              <span>Check each suggested date against the notice, then choose Mark date checked.</span>
              <Link href="/app/notices">All notices</Link>
            </p>
            <section aria-labelledby="client-notices">
              <h2 id="client-notices" className="sr-only">Notices</h2>
              {notices?.length ? (
                <div className="clients-table">
                  <table className="t">
                    <thead><tr><th scope="col">Notice</th><th scope="col">Received</th><th scope="col">Action date</th><th scope="col">Status</th></tr></thead>
                    <tbody className="stagger">{notices.map((notice) => {
                      const details = notice.details as unknown as NoticeDetails;
                      const tone = ({ upcoming: "warn", in_progress: "blue", replied: "done", closed: "" } as const)[notice.status as keyof typeof noticeStatuses] ?? "";
                      return (
                        <tr key={notice.id}>
                          <td>
                            <span className="who">
                              <IconTile Icon={Scale} kind="notice" />
                              <span>{details.notice_type}<span className="sub">{[authorities[details.authority], details.reference].filter(Boolean).join(", ")}</span></span>
                            </span>
                          </td>
                          <td>{dueLabel(details.received_on)}</td>
                          <td>
                            {details.action_date ? <>{dueLabel(details.action_date)}{confirmedBy.get(notice.id) && <span className="sub">Checked by {confirmedBy.get(notice.id)}</span>}</> : (
                              <form action={manageNotice} className="cell-form">
                                <input type="hidden" name="notice" value={notice.id} />
                                <input type="hidden" name="back" value="client" />
                                <Badge tone="warn">Check by {dueLabel(notice.due_on)}</Badge>
                                {!viewOnly && manage && <>
                                  <input type="date" name="date" defaultValue={details.suggested_date} aria-label={`Action date for ${details.notice_type}`} className="cell-input" required />
                                  <span className="hint need-date">Pick the date from the notice first</span>
                                  <Pending className="b b-secondary" name="intent" value="confirm">Mark date checked</Pending>
                                </>}
                              </form>
                            )}
                          </td>
                          <td>
                            {viewOnly || !manage ? <Badge tone={tone}>{noticeStatuses[notice.status as keyof typeof noticeStatuses]}</Badge> : (
                              <form action={manageNotice} className={`pill-select badge ${tone}`}>
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
                <Empty Icon={Scale} kind="notice" title="No notices">
                  <span>A notice that comes by email is saved here and shown on Today. If it came another way, add it here.</span>
                  {!viewOnly && <Link className="b b-primary" href={`${base}?tab=notice`} scroll={false}>Add a notice</Link>}
                </Empty>
              )}
            </section>
            {(noticeCount ?? 0) > 50 && pager(noticeCount ?? 0, notices?.length ?? 0, "Notices", "notices")}
          </>
        )}
      </div>
      </ViewTransition>

      <Presence>
      {panel === "numbers" && manage && (
        <SidePanel key="numbers-panel" id="numbers-panel" title="Tax numbers" close={base}>
          {alert}
          <ul className="client-rows">
            {numbers.map((registration) => (
              <li key={registration.id}>
                <span className="grow"><span className="name">{numberKinds[registration.kind as NumberKind].name}</span><span className="sub num">{registration.number}</span></span>
                <form action={manageClient}>
                  {hidden("numbers")}
                  <input type="hidden" name="registration" value={registration.id} />
                  <Pending className="b b-ghost" name="intent" value="remove-number" aria-label={`Remove ${registration.number}`}>Remove</Pending>
                </form>
              </li>
            ))}
          </ul>
          <form action={manageClient} className="fields">
            {hidden("numbers")}
            <div>
              <label htmlFor="number-kind">Type</label>
              <select id="number-kind" name="kind" defaultValue="gstin">
                {Object.entries(numberKinds).map(([value, { name }]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="number-value">Number</label>
              <input id="number-value" name="number" required autoComplete="off" className="num" />
            </div>
            <Pending className="b b-primary" name="intent" value="add-number">Add number</Pending>
          </form>
        </SidePanel>
      )}
      {panel === "services" && manage && (
        <SidePanel key="services" id="services" title="Services" close={base}>
          {alert}
          <p className="hint">What your firm files for this client. InboxCA makes the due dates for the next 12 months.</p>
          <form key={numbers.map((registration) => registration.services.join()).join()} action={manageClient}>
            {hidden("services")}
            <ul className="client-rows">
              {numbers.filter((registration) => servicesFor(registration).length).map((registration) => (
                <li key={registration.id}>
                  <div className="grow service-form">
                    <input type="hidden" name="registration" value={registration.id} />
                    <span className="name">{numberKinds[registration.kind as NumberKind].name} <span className="num">{registration.number}</span></span>
                    {servicesFor(registration).map((service) => (
                      <label key={service.code} className="check">
                        <input type="checkbox" name={`service-${registration.id}`} value={service.code} defaultChecked={registration.services.includes(service.code)} /> {service.name}
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <Pending className="b b-primary service-save" name="intent" value="services">Save services</Pending>
          </form>
        </SidePanel>
      )}
      {panel === "contacts" && (
        <SidePanel key="contacts" id="contacts" title="Contacts" close={base}>
          {alert}
          <p className="hint">People who write for this client. InboxCA knows their emails belong to this client. It sends papers only to contacts with Receives papers ticked.</p>
          <ul className="client-rows">
            {contacts.map((contact) => (
              <li key={contact.contact_id}>
                <span className="grow">
                  <span className="name">{contact.name}</span>
                  <span className="sub">{contact.email}{contact.relation && `, ${contact.relation}`}</span>
                  {manage ? (
                    <form key={`${contact.can_receive_documents}`} action={manageClient} className="cell-form contact-form">
                      {hidden("contacts")}
                      <input type="hidden" name="contact" value={contact.contact_id} />
                      <label className="check"><input type="checkbox" name="can_receive_documents" defaultChecked={contact.can_receive_documents} /> Receives papers</label>
                      <Pending className="b b-secondary" name="intent" value="contact-rights">Save</Pending>
                      <Pending className="b b-ghost" name="intent" value="unlink-contact">Remove</Pending>
                    </form>
                  ) : (
                    <span className="sub">{contact.can_receive_documents && "Receives papers"}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!contacts.length && <p className="hint">No contacts yet.</p>}
          {manage && (
            <form action={manageClient} className="fields">
              {hidden("contacts")}
              <div><label htmlFor="contact-name">Contact&apos;s name</label><input id="contact-name" name="contact_name" required maxLength={120} /></div>
              <div><label htmlFor="contact-email">Contact&apos;s email</label><input id="contact-email" name="contact_email" type="email" required /></div>
              <div><label htmlFor="contact-relation">Who they are, if known</label><input id="contact-relation" name="relation" maxLength={60} /></div>
              <label className="check"><input type="checkbox" name="can_receive_documents" /> Receives papers</label>
              <Pending className="b b-primary" name="intent" value="add-contact">Add contact</Pending>
            </form>
          )}
        </SidePanel>
      )}
      {panel === "team" && (
        <SidePanel key="assigned" id="assigned" title="Looked after by" close={base}>
          {alert}
          <ul className="client-rows">
            {assigned.map((assignment) => (
              <li key={assignment.value}>
                <span className="grow"><span className="name">{labelOf.get(assignment.value)}</span><span className="sub">{assignmentRoles[assignment.role as keyof typeof assignmentRoles]}</span></span>
                {manage && (
                  <form action={manageClient}>
                    {hidden("team")}
                    <input type="hidden" name="who" value={assignment.value} />
                    <Pending className="b b-ghost" name="intent" value="unassign">Unassign</Pending>
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
              <Pending className="b b-primary" name="intent" value="assign">Assign</Pending>
            </form>
          )}
        </SidePanel>
      )}
      {panel === "details" && manage && (
        <SidePanel key="details" id="details" title="Details" close={base}>
          {alert}
          <form action={manageClient} className="fields">
            {hidden("details")}
            <div><label htmlFor="client-name">Name</label><input id="client-name" name="name" required defaultValue={client.name} /></div>
            <div><label htmlFor="client-email">Email</label><input id="client-email" name="email" type="email" defaultValue={email} /></div>
            <div>
              <label htmlFor="client-kind">Client type</label>
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
            <Pending className="b b-primary" name="intent" value="details">Save details</Pending>
          </form>
          <h3>Reminders</h3>
          <form action={pauseReminders} className="form-row">
            <input type="hidden" name="client" value={client.id} />
            <label className="check"><input type="checkbox" name="paused" defaultChecked={client.reminders_paused} /> Pause reminders for this client</label>
            <Pending className="b b-secondary" type="submit">Save</Pending>
          </form>
          <h3>{client.archived_at ? "Archived" : "Archive"}</h3>
          <form action={manageClient} className="form-row">
            {hidden("details")}
            <p className="hint">{client.archived_at ? "Archived clients are hidden from the list. Nothing was deleted." : "Archiving hides the client from the list. Nothing is deleted, and you can restore it."}</p>
            <Pending className="b b-secondary" name="intent" value={client.archived_at ? "restore" : "archive"}>{client.archived_at ? "Restore client" : "Archive client"}</Pending>
          </form>
        </SidePanel>
      )}
      {panel === "activity" && (
        <SidePanel key="client-activity" id="client-activity" title="Activity" close={base}>
          <p className="hint">The latest 50 changes for this client.</p>
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <Activity client={id} people={people ?? []} undo={manage && !viewOnly} />
          </Suspense>
        </SidePanel>
      )}
      {panel === "notice" && !viewOnly && (
        <SidePanel key="add-notice" id="add-notice" title="Add a notice" close={`${base}?tab=notices`}>
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
            <Pending className="b b-primary" name="intent" value="add">Add notice</Pending>
          </form>
        </SidePanel>
      )}

      {ask && !viewOnly && (
        <SidePanel key="ask-files" id="ask-files" title={`Ask ${client.name} for papers`} close={here}>
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
              <Pending className="b b-primary" type="submit">Ask for papers</Pending>
            </div>
          </form>
          {manage && (
            <details className="reveal">
              <summary>Change the usual list for {clientKinds[client.kind as ClientKind]}</summary>
              <form action={saveChecklist} className="fields">
                <input type="hidden" name="client" value={client.id} />
                <div>
                  <label htmlFor="ask-list">One paper on each line. This changes the list for every client of this type. Leave it empty to use the starting list again.</label>
                  <textarea id="ask-list" className="ask-list" name="items" rows={8} defaultValue={kindList.join("\n")} />
                </div>
                <Pending className="b b-secondary" type="submit">Save list</Pending>
              </form>
            </details>
          )}
        </SidePanel>
      )}
      {upload && canUpload && !ask && (
        <SidePanel key="upload-file" id="upload-file" title="Upload papers" close={`${base}?tab=documents`}>
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
              A file from the GST or income tax portal? <Link href="/app?panel=portal">Add portal files</Link>, and InboxCA finds the client and period inside each.
            </p>
          )}
        </SidePanel>
      )}
      {paper && !viewOnly && !ask && !confirmSend && (
        <SidePanel key="edit-file" id="edit-file" title={paper.name} close={`${base}?tab=documents`}>
          {alert}
          {paper.status === "to_check" && <p className="hint">{sameAs(paper) || `Waiting to be checked: ${origins.get(paper.id)?.why}`}.</p>}
          {canRename && !paper.prepared && (
            <>
              <p className="hint">{paper.status === "to_check" ? `${suggested ? "InboxCA read this scan and filled in what it looks like. " : ""}Check its paper type and period, then choose Save.` : "When you save, InboxCA moves and renames the file in your firm's drive to match."}</p>
              <form action={manageDocument} className="fields">
                <input type="hidden" name="document" value={paper.id} />
                <DocumentFields type={suggested?.type ?? paper.document_type} work={suggested ? "income_tax" : paper.work_type} period={suggested?.period ?? paper.period_key} firmTypes={firmTypes} keep={manage} />
                <Pending className="b b-primary" name="intent" value="save">Save</Pending>
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
                  <p className="hint">To send this paper, add the client&apos;s email in Details, or add a contact with Receives papers ticked.</p>
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
              <p className="hint">It stays 30 days in the Removed papers folder of your firm&apos;s drive, and the owner can restore it. {workspaceStore() ? "InboxCA also keeps its own locked copy for 30 days." : "InboxCA's own safety copy is not set up yet."}</p>
              <Pending className="b b-secondary" name="intent" value="remove" aria-label={`Remove ${paper.name}`}>Remove</Pending>
            </form>
          ) : (
            askButton("remove", "Ask to remove", paper.id)
          )}
          {owner && (
            <details className="reveal paper-more">
              <summary>More</summary>
              <form key={paper.share_policy ?? "firm"} action={setPaperSharing} className="form-row">
                <input type="hidden" name="document" value={paper.id} />
                <div><label htmlFor="paper-sharing">Sending this paper</label><select id="paper-sharing" name="policy" defaultValue={paper.share_policy ?? ""}><option value="">Use the firm&apos;s choice</option><option value="auto">Send without asking</option><option value="approval">Ask before sending</option><option value="internal">Keep inside the firm</option></select></div>
                <p className="hint">With Ask before sending, a person who sends it from this page approves it by sending. When InboxCA sends it on its own or to many clients at once, it waits in the Inbox for approval.</p>
                <Pending className="b b-secondary">Save sending choice</Pending>
              </form>
            </details>
          )}
        </SidePanel>
      )}
      {paper && confirmSend && (
        <SidePanel key="send-file" id="send-file" title="Send to the client" close={`${base}?tab=documents&edit=${paper.id}`}>
          {alert}
          <form action={sendDocument} className="send-to">
            <input type="hidden" name="document" value={paper.id} />
            {recipients.length === 1 ? (
              <>
                <input type="hidden" name="to" value={recipients[0].value} />
                <p className="send-ask">Send {paperType(paper.document_type)} to {recipients[0].email}?</p>
              </>
            ) : (
              <fieldset>
                <legend className="send-ask">Send {paperType(paper.document_type)} to</legend>
                {recipients.map((recipient, at) => (
                  <label key={recipient.value} className="check">
                    <input type="radio" name="to" value={recipient.value} defaultChecked={!at} />
                    {recipient.name}, {recipient.email}
                  </label>
                ))}
              </fieldset>
            )}
            <p className="hint">InboxCA emails {paper.name} from your firm email as a secure link. The link works for 7 days and up to 5 downloads.</p>
            <span className="form-row">
              <Pending className="b b-primary" type="submit">Send</Pending>
              <Link className="b b-secondary" href={`${base}?tab=documents&edit=${paper.id}`} scroll={false}>Back</Link>
            </span>
          </form>
        </SidePanel>
      )}
      {filing && (
        <SidePanel key="mark-filed" id="mark-filed" title="Mark filed" close={returnsHref}>
          <MarkFiled state={returnsState} rows={[{ id: filing.id, name: `${rule.get(filing.code ?? "")?.name ?? filing.code} ${periodLabel(rule.get(filing.code ?? "")?.frequency ?? null, filing.period_key)}`, sub: `Due ${dueLabel(filing.due_on)}` }]} />
        </SidePanel>
      )}
      </Presence>
      {!!done?.length && (
        <Toast
          undo={
            marked !== "reopen" && (
              <form action={manageTasks}>
                {returnsState}
                {done.map((task) => <input key={task.id} type="hidden" name="task" value={task.id} />)}
                <Pending className="b" name="intent" value="reopen">Undo</Pending>
              </form>
            )
          }
        >
          {done.length === 1 ? `${rule.get(done[0].code ?? "")?.name ?? done[0].code} ${periodLabel(rule.get(done[0].code ?? "")?.frequency ?? null, done[0].period_key)}` : `${done.length} returns`} {taskChanges[marked!]}.
        </Toast>
      )}
      {changed && changes[changed] && <Toast>{changes[changed]}</Toast>}
    </div>
  );
}

// Type, work and period for a file, filled in when correcting one.
function DocumentFields({ type = "", work = "other", period = "", firmTypes = [], keep = false }: { type?: string; work?: string; period?: string; firmTypes?: string[]; keep?: boolean }) {
  const known = !type || documentTypes.includes(type) || firmTypes.includes(type);
  return (
    <>
      <div>
        <label htmlFor="file-type">Paper type</label>
        <select id="file-type" name="type" defaultValue={known ? type || "Document" : "Other"}>
          {[...documentTypes, ...firmTypes].map((choice) => (
            <option key={choice} value={choice}>{paperType(choice)}</option>
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
        <label htmlFor="file-work">Type of work</label>
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

// The outline of rows still loading, in the rows' own shape.
function SkeletonRows({ rows }: { rows: number }) {
  return (
    <ul className="app-rows client-skel" aria-busy="true" aria-label="Loading">
      {Array.from({ length: Math.min(rows, 8) }, (_, row) => (
        <li key={row} className="app-row">
          <span className="skel" />
        </li>
      ))}
    </ul>
  );
}

type Mail = { id: string; contact_id: string | null; received_at: string; label: string | null; delivery: unknown; provider_message_id: string; contacts: { name_enc: string } | null };
// A client's emails: who sent each, its subject read live in one call as the Inbox does (the
// label stands in when the mailbox cannot be read), and whether it waits for a reply. The whole
// row opens it. It streams in after the page, as the mailbox can be slow.
async function MailRows({ firm, clientName, mails, className }: { firm: string; clientName: string; mails: Mail[]; className: string }) {
  const { supabase } = await currentMember();
  const crypto = serverCrypto();
  const [{ data: replies }, live, senders] = await Promise.all([
    supabase.from("requests").select("entity_id").eq("kind", "team_reply").eq("status", "pending").in("entity_id", mails.map((mail) => mail.id)),
    mailLive(firm, "list", { inbox: mails.map((mail) => mail.provider_message_id), sent: null }),
    Promise.all(mails.map((mail) => (mail.contacts ? crypto.decrypt(firm, `contacts/${mail.contact_id}/name`, mail.contacts.name_enc) : clientName))),
  ]);
  const waiting = new Set(replies?.map((request) => request.entity_id));
  const subjects = new Map(!("error" in live) ? live.inbox.map((item) => [item.messageId, item.subject]) : []);
  return (
    <ul className={className}>
      {mails.map((mail, at) => (
        <Row
          key={mail.id}
          lead={<Avatar name={senders[at]} />}
          title={
            <Link className="row-link" href={`/app/inbox?mail=${mail.id}`}>
              {subjects.get(mail.provider_message_id) || (labels[mail.label as Label] ?? "Email")}
            </Link>
          }
          meta={`From ${senders[at]}, ${mailTime(mail.received_at)}`}
          status={waiting.has(mail.id) ? <Badge tone="warn">Needs reply</Badge> : (mail.delivery as { ack?: string }).ack === "sent" ? <Badge tone="done">Replied</Badge> : null}
        />
      ))}
    </ul>
  );
}

// A client's latest 50 changes as a timeline, each kind with its own icon. It streams in after
// the panel opens.
async function Activity({ client, people, undo }: { client: string; people: { user_id: string; email: string }[]; undo: boolean }) {
  const { supabase } = await currentMember();
  const activity = await supabase.rpc("client_activity", { target_client: client });
  if (activity.error) throw new Error("Client activity could not be read");
  if (!activity.data.length) return <p className="hint">No changes recorded yet.</p>;
  // A rename can be put back while its paper is still in use and was not made by InboxCA.
  const renamed = [...new Set(activity.data.flatMap((entry) => (entry.document_id ? [entry.document_id] : [])))];
  const { data: files } = undo && renamed.length ? await supabase.from("documents").select("id").eq("client_id", client).in("id", renamed).is("prepared", null).not("status", "in", "(deleted,earlier)") : { data: [] };
  const undoable = files?.map((file) => file.id) ?? [];
  return (
    <ol className="timeline stagger">
      {activity.data.map((entry, index) => {
        const [Icon, kind] = activityIcons[entry.action.split(".")[0]] ?? [UserRound, ""];
        return (
          <li key={index}>
            <IconTile Icon={Icon} kind={kind} />
            <span className="grow">
              <span className="name">{activityNames[entry.action] ?? "Client changed"}</span>
              {entry.renamed_from && <span className="sub">{entry.renamed_to ? `${entry.renamed_from} to ${entry.renamed_to}` : `Was ${entry.renamed_from}`}</span>}
              <span className="sub">{entry.actor_id ? people.find((person) => person.user_id === entry.actor_id)?.email ?? "Former team member" : "InboxCA"}, <time dateTime={entry.at}>{mailTime(entry.at)}</time></span>
            </span>
            {/* A manager or the owner puts back the latest rename of a file in one click (5.17.2). */}
            {activity.data.findIndex((other) => other.document_id === entry.document_id) === index && undoable.includes(entry.document_id) && (
              <form action={manageDocument}>
                <input type="hidden" name="document" value={entry.document_id} />
                <Pending className="b b-ghost" name="intent" value="undo" aria-label={`Undo rename of ${entry.renamed_to ?? entry.renamed_from}`}>Undo</Pending>
              </form>
            )}
          </li>
        );
      })}
    </ol>
  );
}
