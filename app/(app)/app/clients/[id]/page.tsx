import {PreparedForms} from "../../prepared-forms";
import { PortalInput } from "./portal-input";
import { SalesInput } from "./sales-input";
import { PurchaseMatch } from "./purchase-match";
import { DatasetReview } from "./dataset-review";
import { TdsDetails } from "./tds-details";
import { BellRing, CalendarCheck, CalendarClock, CalendarDays, ChevronDown, Contact, FileArchive, FileClock, FileCode2, FileImage, FilePlus2, FileSpreadsheet, FileText, FileUp, Hash, ListChecks, Mail, Plus, Scale, Search, Trash2, UserPlus, UserRound, type LucideIcon } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fragment, Suspense, ViewTransition } from "react";
import { setPaperSharing, askForDocuments, askPermission, checkRequestItem, stopAsking, manageClient, manageNotice, manageTasks, pauseReminders, manageDocument, removeDocument, saveChecklist, sendDocument } from "@/app/(app)/actions";
import { addDays, dueLabel, isItr, periodLabel, todayInIndia, verifyBy } from "@/src/lib/calendar";
import { firmChecked } from "@/src/lib/due-dates";
import { assignmentLabel, assignmentRoles, assignmentWork, canManageClients, clientKinds, seesClient, usualServices, whatsappLink, type ClientKind } from "@/src/lib/clients";
import { emailTemplates } from "@/src/lib/email-templates";
import { checklists, kindChecklist, workOfService, type DocumentRequest } from "@/src/lib/checklists";
import { skipReasons, type Skip } from "@/src/lib/reminders";
import { activityNames } from "@/src/lib/activity";
import { type Right } from "@/src/lib/rights";
import { serverCrypto } from "@/src/lib/crypto";
import { documentTypes, folderFor, listedType, listedTypes, periodChoices, periodName, quarterEnd, receivedLabel, workOfType } from "@/src/lib/documents";
import { paperType } from "@/src/lib/paper-type";
import { workTypes, type FolderOrder, type WorkType } from "@/src/lib/drive";
import { authorities, confirmAction, confirmers, noticeStatuses, type NoticeDetails } from "@/src/lib/notices";
import { numberKinds, type NumberKind } from "@/src/lib/identifiers";
import { currentMember } from "@/src/lib/member";
import { paperOrigins } from "@/src/lib/paper-origin";
import { personName } from "@/src/lib/roles";
import { scanType, searchTokens, words } from "@/src/lib/search";
import { supabaseAdmin } from "@/src/lib/supabase";
import { awake } from "@/src/lib/triage";
import { workspaceStore } from "@/src/lib/workspace";
import { AutoSelect } from "../../auto-select";
import { LiveSearch } from "../../live-search";
import { MenuClose } from "../../returns-client";
import { LinkTabs } from "../../link-tabs";
import { DroppedNotice, PortalDrop } from "../../portal-drop";
import { MarkFiled } from "../../mark-filed";
import { returnStages } from "../../return-work";
import { fills, returnPeriod } from "@/src/lib/return-work";
import { currentStep, nextAction, stepsFor } from "@/src/lib/return-steps";
import { Presence } from "../../motion";
import { Pending } from "../../pending";
import { Avatar, Badge, Card, Empty, IconTile, PageHead, Row, SidePanel, Toast, type Kind } from "../../ui";
import { CopyButton, MoreMenu } from "../../ui-client";
import { CameFrom } from "../../documents/came-from";
import { UploadForm } from "./upload-form";
import { WorkFold, WorkRows, type WorkRow } from "./work-list";
import { recordAgm, recordKyc, remindClient } from "@/app/(app)/actions";
import { RemindToast } from "../../remind-toast";
import { unsafeText } from "@/src/lib/intake";
import { DeskChip } from "../../desk-chip";
import { deskNames, deskViewer, desksOf } from "@/src/lib/desks";
import { InboxView } from "../../inbox/inbox-view";
import "../clients.css";
import "../../today.css";

const errors: Record<string, string> = {
  details: "Enter a name, choose a client type, and check the email address and phone number.",
  number: "That number does not fit the type you chose. Check the type, and check the number for a typing mistake.",
  "one-pan": "This client already has a PAN.",
  "gstin-pan": "That GSTIN holds a different PAN from this client's.",
  taken: "Another client in your firm already has that number.",
  "filed-number": "That number has filed returns, so it stays. To stop its new returns, untick its services and choose Save services.",
  assign: "Choose a person and what they do for this client.",
  licence: "Name the licence or registration and give the date it is valid until.",
  todo: "Write what is to be done and give a date. That to-do may have changed meanwhile.",
  agm: "The AGM date was not saved. Choose the year and a date after it, for a company whose services follow the AGM.",
  kyc: "The KYC year was not saved. Choose the financial year of the last DIR-3 KYC, for a PAN with the DIR-3 KYC Web service.",
  assigned: "That person is already assigned to this client.",
  contact: "Enter the contact's name and a valid email address.",
  linked: "That contact is already added to this client.",
  services: "These services cannot go together. Choose one GSTR-1 and one GSTR-3B, monthly or quarterly. Do not choose composition with regular GST returns.",
  role: "Only the owner, a partner or a manager can change clients.",
  document: "Choose the paper type, type of work and period. If you chose Other, type a name for the paper.",
  drive: "The firm's drive is not connected or could not be reached. Try again in a minute.",
  upload: "Choose up to 20 files, 50 MB in all, and each file's paper type, type of work and period.",
  ...unsafeText,
  check: "The file could not be checked just now. Try again in a minute.",
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
// the overview, returns, due dates, figures and forms open Work; files open Papers; the rest
// open Details with their panel.
const mains = { work: "Work", documents: "Papers", emails: "Emails", notices: "Notices", about: "Details" } as const;
type Main = keyof typeof mains;
const tabOf: Record<string, Main> = { overview: "work", returns: "work", due: "work", extraction: "work", outputs: "work", files: "documents", notice: "notices", numbers: "about", services: "about", contacts: "about", team: "about", details: "about", activity: "about", tds: "about" };
const panels = ["notice", "numbers", "services", "contacts", "team", "details", "activity", "tds"];
const lookAfter = ["partner_in_charge", "manager", "staff"];
const uuid = /^[0-9a-f-]{36}$/;
const taskChanges: Record<string, string> = { filed: "marked filed", in_progress: "marked in progress", reopen: "marked not filed", verified: "marked e-verified" };
// What a save on this page says once it is done (?changed=).
const changes: Record<string, string> = {
  details: "Details saved.", services: "Services saved.", "contact-rights": "Contact saved.", "add-contact": "Contact added.", "unlink-contact": "Contact removed.",
  "add-number": "Tax number added.", "remove-number": "Tax number removed.", assign: "Assigned.", unassign: "Unassigned.", archive: "Client archived.", restore: "Client restored.",
  reminders: "Reminders saved.", list: "List saved.", sharing: "Sending choice saved.", "add-licence": "Expiry date added. It is on the Calendar.", "remove-licence": "Expiry date removed.",
  "add-todo": "To-do added. It is on Today for the person.", "todo-done": "To-do done.", "todo-undo": "To-do open again.",
  agm: "AGM date saved. The returns that follow it are on the Calendar.",
  kyc: "KYC year saved. The next DIR-3 KYC Web is on the Calendar.",
  tds: "TDS statement details saved.",
};

// One client. Its numbers are opened with the firm's key on the server, for this page only.
export default async function Client({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; closed?: string; reopened?: string; tab?: string; form?:string; page?: string; show?: string; draft?: string; line?: string; check?: string; view?: string; source?: string; section?: string; header?: string; read?: string; portal?: string; edit?: string; renamed?: string; saved?: string; removed?: string; restored?: string; changed?: string; upload?: string; dropped?: string; ask?: string; asked?: string; send?: string; shared?: string; find?: string; asked_right?: string; request?: string; task?: string; marked?: string; t?: string; tan?: string }> }) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ id }, { error, closed, reopened, form:formMessage, tab: asked, page: askedPage, show, draft, line, check, view, source, section, header, read, portal, edit, renamed, saved, removed, restored, changed, upload, dropped, ask, asked: askedFor, send, shared, find, asked_right: askedRight, task: marking, marked, t: markedIds, tan }] = await Promise.all([params, searchParams]);
  const tab: Main = asked && asked in mains ? (asked as Main) : tabOf[asked ?? ""] ?? "work";
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
  // Papers 50 at a time with their true count; a search keeps only the files whose words
  // include every word typed. The paper open in a panel, or just sent or changed, and the
  // owner's removed papers are read by themselves.
  const fileColumns = "id, name, document_type, work_type, period_key, status, share_policy, sha256, received_at, prepared, email_event_id, registration_id";
  const fileQuery = supabase.from("documents").select(fileColumns, { count: "exact", head: !files }).eq("firm_id", firm).eq("client_id", id).not("status", "in", "(deleted,earlier)");
  const typed = files && find?.trim() ? words(find.slice(0, 200), 8) : [];
  const tokens = typed.length ? await searchTokens(firm, typed) : null;
  const owner = membership.role === "owner";
  const namedIds = [edit ?? send, shared, renamed ?? saved ?? removed ?? restored].filter((file): file is string => uuid.test(file ?? ""));
  // Work: every return still to file and those filed this financial year; the other tabs count
  // those late or due in the next 30 days.
  const fyStart = `${Number(today.slice(0, 4)) - (today.slice(5, 7) < "04" ? 1 : 0)}-04-01`;
  const taskQuery = supabase.from("tasks").select("id, code, period_key, due_on, status, details, registration_id",{count:"exact", head: sub !== "work"}).eq("firm_id",firm).eq("kind", "compliance").eq("client_id", id);
  const [{ data: client }, { data: people }, { data: groups }, { data: rules }, { data: tasks, count: taskCount }, { data: pageFiles, count: fileCount }, { data: asks }, { data: notices, count: noticeCount }, { count: mailCount }, { data: drive }, { data: nextDue }, { data: madeFiles }, { data: figureSets }, { data: mine }, { data: filing }, { data: done }, { data: due }, { data: namedFiles }, { data: allTasks }, { data: licences }, { count: kycPlanned }, { data: todos }, { count: firmConfirmed }] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, kind, archived_at, email_enc, phone_enc, group_id, branch_id, reminders_paused, tags, engagement_enc, client_registrations(id, kind, number_enc, services), client_assignments(user_id, team_id, role, work), contact_clients(contact_id, relation, can_receive_documents, contacts(name_enc, email_enc))",
      )
      .eq("id", id)
      .eq("firm_id", firm)
      .maybeSingle(),
    supabase.rpc("firm_people", { target_firm: firm }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "client_group", "branch"]).order("name"),
    Promise.resolve(supabase.from("compliance_types").select("code, name, frequency, due_rule, verified_on, client_kinds").eq("period_key", "").order("code")).then(async ({ data }) => ({ data: await firmChecked(supabase, firm, data) })),
    sub === "work" ? taskQuery.or(`status.neq.filed,due_on.gte.${fyStart},details->>filed_on.gte.${fyStart}`).order("due_on").order("id").limit(300) : taskQuery.neq("status", "filed").lte("due_on", addDays(today, 30)),
    files ? (tokens ? fileQuery.contains("search_tokens", tokens) : fileQuery).order("received_at", { ascending: false }).order("id", { ascending: false }).range(start, start + 49) : fileQuery,
    supabase.from("requests").select("id, status, expires_at, details").eq("kind", "documents").eq("client_id", id).in("status", ["pending", "done"]).gt("expires_at", new Date().toISOString()),
    supabase.from("tasks").select("id,due_on,status,details",{count:"exact", head: tab !== "notices"}).eq("firm_id",firm).eq("client_id",id).eq("kind","notice").order("due_on").order("id").range(start,start+49),
    // Emails: the tab counts those waiting for a reply, as the Inbox's Needs reply does.
    supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending").eq("client_id", id).or(awake(today)),
    tab === "documents" ? supabaseAdmin().from("connected_accounts").select("settings").eq("firm_id",firm).eq("kind","drive").maybeSingle() : Promise.resolve({ data: null }),
    // The next return still to file from today on, for the header's countdown.
    supabase.from("tasks").select("code, period_key, due_on").eq("firm_id", firm).eq("kind", "compliance").eq("client_id", id).neq("status", "filed").gte("due_on", today).order("due_on").limit(1).maybeSingle(),
    // Whether Papers links Other figures and Other return files: those not for any one return.
    sub === "work" || files ? supabase.from("documents").select("period_key, prepared").eq("firm_id",firm).eq("client_id",id).not("prepared","is",null).neq("status","deleted") : Promise.resolve({ data: [] }),
    sub === "work" || files ? supabase.from("datasets").select("form_code, period_key").eq("firm_id",firm).eq("client_id",id) : Promise.resolve({ data: [] }),
    // What this person may do here, with any grant or request of theirs still open (5.17.2).
    supabase.from("requests").select("reason_code, status, details").eq("kind", "permission").eq("client_id", id).eq("details->>by", userId).in("status", ["pending", "approved"]).gt("expires_at", new Date().toISOString()),
    // Work: the return being marked filed in the side panel, and the ones just changed.
    tab === "work" && canFile && uuid.test(marking ?? "") ? supabase.from("tasks").select("id, code, period_key, due_on").eq("firm_id", firm).eq("kind", "compliance").eq("client_id", id).eq("id", marking!).neq("status", "filed").maybeSingle() : Promise.resolve({ data: null }),
    tab === "work" && taskChanges[marked ?? ""] && doneIds.length ? supabase.from("tasks").select("id, code, period_key").eq("firm_id", firm).eq("client_id", id).in("id", doneIds) : Promise.resolve({ data: null }),
    // Asking is for the return in hand: the client's oldest return not filed (a late one first),
    // its period and its papers; else last month.
    ask ? supabase.from("tasks").select("code, period_key").eq("firm_id", firm).eq("kind", "compliance").eq("client_id", id).neq("status", "filed").order("due_on").limit(12) : Promise.resolve({ data: [] }),
    files && (namedIds.length || owner) ? supabase.from("documents").select(fileColumns).eq("firm_id", firm).eq("client_id", id).or([...(namedIds.length ? [`id.in.(${namedIds})`] : []), ...(owner ? ["status.eq.deleted"] : [])].join(",")).order("received_at", { ascending: false }) : Promise.resolve({ data: [] }),
    // Every return of the client, which those figures and files are matched to.
    sub === "work" || files ? supabase.from("tasks").select("code, period_key, registration_id").eq("firm_id", firm).eq("client_id", id).eq("kind", "compliance") : Promise.resolve({ data: [] }),
    // The client's licence and registration expiry dates, as the firm entered them (Details).
    supabase.from("tasks").select("id, due_on, status, details").eq("firm_id", firm).eq("client_id", id).eq("kind", "licence").order("due_on").limit(20),
    // A DIR-3 KYC still to file, which may be years ahead.
    sub === "work" ? supabase.from("tasks").select("id", { count: "exact", head: true }).eq("firm_id", firm).eq("client_id", id).eq("code", "DIR3KYC").neq("status", "filed") : Promise.resolve({ count: 0 }),
    // The client's to-dos: every open one, and those done whose date was in the last 30 days.
    sub === "work" ? supabase.from("tasks").select("id, due_on, status, details").eq("firm_id", firm).eq("client_id", id).eq("kind", "todo").or(`status.eq.upcoming,due_on.gte.${addDays(today, -30)}`).order("due_on").limit(30) : Promise.resolve({ data: [] }),
    // Whether the firm has confirmed any due date yet (src/lib/due-dates.ts): until it has, Work
    // says so once instead of tagging every row.
    sub === "work" ? supabase.from("firm_due_dates").select("code", { count: "exact", head: true }).eq("firm_id", firm) : Promise.resolve({ count: 0 }),
  ]);
  if (!client) notFound();
  const crypto = serverCrypto();
  // Where each open return stands, and who may fill it by hand.
  const stages = await returnStages(supabase, firm, sub === "work" ? (tasks ?? []).filter((task) => task.status !== "filed").map((task) => task.id) : []);
  // And what Fill would read for a return whose figures are in, so its next step says why it waits.
  const drafts = new Map(await Promise.all((tasks ?? []).filter((task) => task.status !== "filed" && fills(task.code) && ["figures", "checked"].includes(stages.get(task.id)?.stage ?? "")).map(async (task) => [task.id, (await supabase.rpc("return_drafts", { task_id: task.id })).data ?? []] as const)));
  // Who confirmed each dated notice, from the firm's activity.
  const dated = tab === "notices" ? (notices ?? []).filter((notice) => (notice.details as unknown as NoticeDetails).action_date).map((notice) => notice.id) : [];
  // The portal file each open monthly GSTR-3B is read from (PLAN.md 5.3.1): the month's GSTR-2B.
  const months = sub === "work" ? (tasks ?? []).flatMap((task) => (task.code === "GSTR3B_M" && task.status !== "filed" && task.period_key ? [task.period_key] : [])) : [];
  // And each open ITR's, for its year: Form 16, Form 26AS and AIS.
  const itrYears = sub === "work" ? (tasks ?? []).flatMap((task) => (task.code?.startsWith("ITR") && task.status !== "filed" && task.period_key ? [task.period_key.slice(0, 4)] : [])) : [];
  // The latest open request for papers, for the WhatsApp text below.
  const openAsk = viewOnly ? undefined : (asks ?? []).filter((request) => request.status === "pending").sort((a, b) => (b.expires_at ?? "").localeCompare(a.expires_at ?? ""))[0];
  // The second and last round: the client's own numbers and contacts opened with the firm's key,
  // and what the shown lists need from them.
  const [numbers, email, contacts, { data: confirms }, { data: statements }, { data: taxPapers }, phone, engagement] = await Promise.all([
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
    itrYears.length ? supabase.from("documents").select("document_type, period_key").eq("client_id", id).in("document_type", ["Form 16", "Form 130", "Form 26AS", "Form 168", "AIS"]).neq("status", "deleted") : Promise.resolve({ data: [] }),
    client.phone_enc ? crypto.decrypt(firm, `clients/${client.id}/phone`, client.phone_enc) : "",
    client.engagement_enc ? crypto.decrypt(firm, `clients/${client.id}/engagement`, client.engagement_enc) : "",
  ]);
  const licenceLabel = (licence: { details: unknown }) => (licence.details as { label?: string }).label ?? "Licence";
  // WhatsApp click to chat from the person's own phone, with the papers still missing filled in
  // while papers are asked for (product gaps S6), pointing to the email. InboxCA sends nothing.
  const missingAsk = openAsk && (openAsk.details as unknown as DocumentRequest);
  const whatsapp = phone && whatsappLink(phone, missingAsk ? emailTemplates.whatsapp(client.name, membership.firmName, missingAsk.period, missingAsk.items.filter((item) => !item.received.length)) : "");
  const manage = canManageClients(membership.role);
  // Send reminder now on Work, and Ask again or Stop asking for papers: those who manage clients
  // and those who look after this one.
  const looksAfter = (sub === "work" || files) && !viewOnly && (manage || !!(await supabase.rpc("looks_after", { target_firm: firm, client: client.id })).data);
  const mailable = !!client.email_enc && !client.reminders_paused;
  const reminds = sub === "work" && mailable && looksAfter;
  const confirmedBy = new Map([...confirmers(confirms ?? [])].map(([notice, by]) => [notice, personName(people?.find((person) => person.user_id === by)?.email)]));
  // The lists for the work this client's services need are ticked when asking for files.
  // A client with a TAN has TDS work, whatever services it has.
  const usualWork = new Set(client.client_registrations.flatMap((registration) => [...(registration.services ?? []).map(workOfService), ...(registration.kind === "tan" ? ["tds" as const] : [])]));
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
  // The TDS papers asked for a quarter, on its TDS return: those still missing, or all in.
  const tdsPapers = (period: string) => {
    const items = (asks ?? []).flatMap((request) => { const details = request.details as unknown as DocumentRequest; return details.period && quarterEnd(details.period) === period ? details.items.filter((item) => item.work === "tds") : []; });
    const missing = items.filter((item) => !item.received.length).map((item) => item.type);
    return !items.length ? "" : missing.length ? `. TDS papers still missing: ${missing.join(", ")}` : ". TDS papers are in";
  };
  // Form No. 130 and Form No. 168 replace Form 16 and Form 26AS from tax year 2026-27, and either
  // name answers either. Only a salary has a Form 16, so it is listed for an individual on the
  // non-business return (ITR_NA) or a client with one on file.
  const newer: Record<string, string> = { "Form 16": "Form 130", "Form 26AS": "Form 168" };
  const held = new Set((taxPapers ?? []).map((paper) => `${paper.period_key}:${Object.keys(newer).find((type) => newer[type] === paper.document_type) ?? paper.document_type}`));
  const salaried = (client.kind === "individual" && !!tasks?.some((task) => task.code === "ITR_NA")) || [...held].some((paper) => paper.endsWith(":Form 16"));
  const itrNeeds = new Map(itrYears.map((year) => {
    const papers = (salaried ? ["Form 16", "Form 26AS", "AIS"] : ["Form 26AS", "AIS"]).map((type) => ({ name: paperType(year >= "2027" ? newer[type] ?? type : type), added: held.has(`${year}:${type}`) }));
    const missing = papers.filter((paper) => !paper.added), names = (missing.length ? missing : papers).map((paper) => paper.name).join(", ").replace(/, ([^,]*)$/, " and $1");
    return [year, { missing: !!missing.length, line: `. ${names} for ${periodName(year, "income_tax")}: ${missing.length ? "not added yet" : "added"}` }];
  }));
  // Services sit on a number: GST returns on a GSTIN, TDS on a TAN, income tax on the PAN.
  // Only those for this kind of client, and any already chosen, are offered.
  const servicesFor = ({ kind, services }: { kind: string; services: string[] }) =>
    rules?.filter((r) => (r.due_rule as { for?: string }).for === kind && (!r.client_kinds || r.client_kinds.includes(client.kind) || services.includes(r.code))) ?? [];
  // A client with no services yet: the usual ones for its kind on each number, by number,
  // shown on the Services card and saved only with Use these.
  const usualFor = new Map(numbers.some((registration) => registration.services.length) ? [] : numbers
    .map((registration) => [registration.id, usualServices(client.kind, registration.kind).filter((code) => servicesFor(registration).some((service) => service.code === code))] as const)
    .filter(([, codes]) => codes.length));
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
  // Who does its GST and income tax work, beside its numbers in the header (src/lib/desks.ts).
  // A removed person no longer holds a desk (their assignments stay, for Restore).
  const desks = desksOf(client.client_assignments.filter((a) => people?.find((person) => person.user_id === a.user_id)?.status !== "deactivated"), client.client_registrations.flatMap((registration) => registration.services), who);
  const viewer = deskViewer(membership, userId);
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
  for (const [work, list] of Object.entries(checklists)) for (const type of list) if (!askItems.has(type) && (work !== "tds" || usualWork.has("tds"))) askItems.set(type, `${work}:${type}`);
  // Papers for the return in hand start ticked (an ITR client gets the ITR papers only), else
  // for every work the client's services need; More papers opens when one of its own is.
  const inHand = due?.[0]?.code ? workOfService(due[0].code) : null;
  const askWork = inHand ? new Set([inHand]) : usualWork;
  // A yearly return's period is its year ("2026-03" is the year ending March 2026, "2026").
  const askPeriod = due?.map((task) => (isItr(task.code) || task.code === "TAX_AUDIT" ? task.period_key?.slice(0, 4) : task.period_key)).find((key) => periodChoices(today).includes(key ?? "")) ?? periodChoices(today)[1];
  // Papers already in for that period start unticked, so the client is not asked for them again.
  const { data: inAlready } = ask ? await supabase.from("documents").select("document_type").eq("firm_id", firm).eq("client_id", id).eq("period_key", askPeriod).not("status", "in", "(deleted,earlier)") : { data: null };
  const usual = ([type, value]: [string, string]) => !inAlready?.some((paper) => paper.document_type === type) && askWork.has(value.startsWith("kind:") ? workOfType(type) : (value.split(":")[0] as WorkType));
  const askBox = (item: [string, string]) => (
    <label key={item[0]} className="check">
      <input type="checkbox" name="item" value={item[1]} defaultChecked={usual(item)} />
      {item[0]}
    </label>
  );
  // A figure or a return file is for a return when one of the client's returns has its form,
  // period and number, as a return's own page finds it (return-back.ts); Work links the others.
  const forReturn = (form: string, period: string | null, registration?: string) =>
    (allTasks ?? []).some((task) => (!registration || task.registration_id === registration) && (/^ITR/.test(form) ? /^ITR_/.test(task.code ?? "") && task.period_key === `${period}-03` : task.period_key === period && (/^GSTR(1|3B)$/.test(form) ? !!task.code?.startsWith(`${form}_`) : task.code === (form === "TDS143" ? "TCS_RET" : /^TDS1(38|40|44)$/.test(form) ? "TDS_RET" : ""))));
  const otherFigures = (figureSets ?? []).some((set) => !forReturn(set.form_code, set.period_key));
  const otherFiles = (madeFiles ?? []).some((file) => { const made = file.prepared as { form?: string; registration?: string }; return !forReturn(made.form ?? "", file.period_key, made.registration); });
  const base = `/app/clients/${client.id}`;
  const here = `${base}${tab === "work" ? "" : `?tab=${tab}`}`;
  const about = `${base}?tab=about`;
  // Work: each return as a row with its steps and its next step in words (src/lib/return-steps.ts)
  // and the person who does that work for the client (staff before a manager or a partner).
  const approver = !viewOnly && ["owner", "partner", "manager"].includes(membership.role);
  const doer = (code: string | null) => [...lookers].reverse().find((assignment) => !assignment.work || assignment.work === workOfService(code ?? ""));
  // A return's name and period in short for its row ("ITR AY 2026-27", "GSTR-3B Jul to Sep 2026").
  const short = (words: string) => words.replace(/\s*\([^)]*\)/g, "");
  const workRows = (sub === "work" ? tasks ?? [] : []).map((task): WorkRow => {
    const r = rule.get(task.code ?? ""), filed = task.status === "filed", steps = stepsFor(task.code), person = doer(task.code), period = periodLabel(r?.frequency ?? null, task.period_key, task.code);
    const work = { ...(stages.get(task.id) ?? { stage: filed ? "filed" : "none", open: null, missing: null }), form: null };
    const sets = (drafts.get(task.id) ?? []).map((set) => ({ wrong: set.wrong, name: set.form_code === "GSTR3B" ? "the GSTR-2B" : set.target ? "your team's entries" : isItr(task.code) ? "a paper" : "the sales register" }));
    const next = filed ? null : nextAction(work, task.code, { period: returnPeriod(task.code ?? "", task.period_key ?? ""), drafts: sets, approver });
    const done = task.details as { filed_on?: string; by?: string; ack?: string; udin?: string; verified_on?: string; reminded?: string[]; skipped?: { reason: string } };
    // The next step in a few words; why it waits, in notReady's order, when there is no button.
    const waits = next?.step === "approve" ? "Waits for approval" : !sets.length || work.missing === "sales" ? "Add the sales register" : work.missing === "credit" ? "Add the GSTR-2B" : "Correct the figures";
    // The papers a return reads from the portal or the client, as a quiet tag while some are missing.
    const twoB = task.code === "GSTR3B_M" && task.period_key && months.includes(task.period_key) ? `GSTR-2B for ${periodName(task.period_key)}: ${needs2b.has(task.period_key) ? "not added yet" : "added"}` : "";
    const tdsLine = task.code === "TDS_RET" ? tdsPapers(task.period_key ?? "").slice(2) : "";
    const itr = task.code?.startsWith("ITR") ? itrNeeds.get(task.period_key?.slice(0, 4) ?? "") : undefined;
    const tag = filed ? "" : twoB && needs2b.has(task.period_key ?? "") ? "GSTR-2B missing" : tdsLine.includes("missing") ? "Papers missing" : itr?.missing ? "Portal files missing" : "";
    return {
      id: task.id, href: `${base}/returns/${task.id}`, title: short(`${r?.name ?? task.code} ${period}`), unchecked: !r?.verified_on && !!firmConfirmed,
      full: [`${r?.name ?? task.code} ${period}`, next?.why?.replace(/\.$/, ""), reminderNote(done), twoB, tdsLine, itr?.line.slice(2)].filter(Boolean).join(". "),
      due: task.due_on, late: !filed && task.due_on < today, filed, steps: steps.length, done: filed ? steps.length : steps.indexOf(currentStep(work, task.code)), person: person && who(person),
      next: filed
        ? `Filed${done.filed_on ? ` ${dueLabel(done.filed_on)}` : ""}${done.by ? ` by ${personName(people?.find((one) => one.user_id === done.by)?.email)}` : ""}${done.ack ? `, ARN ${done.ack}` : ""}${done.udin ? `, UDIN ${done.udin}` : ""}${isItr(task.code) ? (done.verified_on ? `. E-verified ${dueLabel(done.verified_on)}` : `. Verify by ${dueLabel(verifyBy(done.filed_on ?? task.due_on))}`) : ""}`
        : next?.label ?? waits,
      tag, tip: tag ? [twoB, tdsLine, itr?.line.slice(2)].filter(Boolean).join(". ") : undefined,
    };
  });
  // Due soon: late or due in the next 30 days; then later; then filed this year, latest first.
  const soon = workRows.filter((row) => !row.filed && row.due <= addDays(today, 30));
  const later = workRows.filter((row) => !row.filed && row.due > addDays(today, 30));
  const filedRows = workRows.filter((row) => row.filed).reverse();
  // A date InboxCA needs, asked on Work only while none of its returns is listed: a company's
  // AGM (AOC-4, MGT-7 and ADT-1 follow it), a director's last DIR-3 KYC.
  const fyEnd = Number(today.slice(0, 4)) + (today.slice(5, 7) >= "04" ? 1 : 0);
  const fromOf = (code: string | null) => (rule.get(code ?? "")?.due_rule as { from?: string } | undefined)?.from;
  const agmNeeded = sub === "work" && manage ? numbers.filter((registration) => registration.kind === "cin" && registration.services.some((code) => fromOf(code) === "agm") && !tasks?.some((task) => task.registration_id === registration.id && fromOf(task.code) === "agm")) : [];
  const kycNeeded = sub === "work" && manage && !kycPlanned ? numbers.filter((registration) => registration.kind === "pan" && registration.services.some((code) => fromOf(code) === "kyc")) : [];
  const datesNeeded = !!(agmNeeded.length || kycNeeded.length);
  const remindsNow = reminds && soon.some((row) => row.due <= addDays(today, 7));
  // None of the firm's due dates confirmed yet: one line for the owner, who confirms them in Settings.
  const confirmDates = owner && !viewOnly && !firmConfirmed && (tasks ?? []).some((task) => task.status !== "filed" && !rule.get(task.code ?? "")?.verified_on);
  const counts: Record<Main, number | undefined> = { work: sub === "work" ? soon.length : taskCount ?? 0, documents: fileCount ?? 0, emails: mailCount ?? 0, notices: noticeCount ?? 0, about: undefined };
  // The Returns tab as it is, for the filing panel and each filing form to come back to.
  const shows = show === "filed" || show === "later" ? show : "";
  const returnsHref = `${base}?tab=returns${shows && `&show=${shows}`}${page > 1 ? `&page=${page}` : ""}`;
  const returnsState = (
    <>
      <input type="hidden" name="client" value={client.id} />
      {shows && <input type="hidden" name="show" value={shows} />}
      {page > 1 && <input type="hidden" name="page" value={page} />}
    </>
  );
  // A page of 50 at a time keeps a busy client's page quick; paging keeps the view's filter.
  const keep = `${shows && `&show=${shows}`}${find ? `&find=${encodeURIComponent(find)}` : ""}`;
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
  // A number with its own Copy button, as the header and the Registrations card show it.
  const idNumber = (kind: string, number: string) => (
    <span className="client-id">
      <span className="num">{number}</span>
      <CopyButton text={number} label={kind} />
    </span>
  );
  const canWrite = (!!email || contacts.length > 0) && !client.archived_at;
  // Details: About's rows, each with its value or nothing, and the names of those empty.
  const aboutRows: [string, React.ReactNode][] = [
    ["Client type", clientKinds[client.kind as ClientKind]],
    ["Email", email],
    ["Phone", phone && <>{phone}{whatsapp && !client.archived_at && <>{" "}<a href={whatsapp} target="_blank" rel="noreferrer">Message on WhatsApp</a></>}</>],
    ["Group", groupName && <Link href={`/app/clients?group=${client.group_id}`}>{groupName}</Link>],
    ...(branches.length ? [["Branch", branchName && <Link href={`/app/clients?branch=${client.branch_id}`}>{branchName}</Link>] as [string, React.ReactNode]] : []),
    ["Reminders", client.reminders_paused ? <Badge tone="warn">Paused</Badge> : <Badge>On</Badge>],
    ["Tags", !!client.tags.length && client.tags.map((word) => <Badge key={word}>{word}</Badge>)],
    ["What we do", engagement],
    // Expiry dates the firm entered: red once past, green once marked renewed on the Calendar.
    ["Licences", !!licences?.length && licences.map((licence) => <span key={licence.id} className="sub">{licenceLabel(licence)}: {licence.status === "filed" ? <Badge tone="done">Renewed</Badge> : <>{licence.due_on < today ? "expired" : "until"} {dueLabel(licence.due_on)}</>}</span>)],
    ["Changes", <Link key="activity" href={`${base}?tab=activity`} scroll={false}>Activity</Link>],
  ];
  const aboutMissing = aboutRows.filter(([, value]) => !value).map(([label]) => label);

  return (
    <div className="clients-page client-record">
      {/* The header, on one line: Clients / the client's avatar and name, its type and numbers,
          then the quick actions (one blue button, the rarer ones under More). Who looks after
          it and what is due next are on Work. */}
      <PageHead
        crumbs={[["/app/clients", "Clients"]]}
        title={
          <span className="who">
            <Avatar name={client.name} square />
            {client.name}
          </span>
        }
        meta={
          <span className="client-meta">
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
            {/* Desks that one person or team does are one chip, its desks named on hover and in its menu. */}
            {(desks.length > 1 && desks.every((desk) => !!desk.holder && desk.holder.id === desks[0].holder?.id) ? [undefined] : desks.map((desk) => desk.work)).map((work) => (
              <span key={work === undefined ? "same" : (work ?? "all")} className="client-id">
                <span className="client-id-kind">{work ? deskNames[work] : "Staff"}</span>
                <DeskChip client={{ id: client.id, name: client.name }} desks={desks} work={work} viewer={client.archived_at ? { ...viewer, assign: false, take: false } : viewer} named />
              </span>
            ))}
          </span>
        }
        actions={
        <>
          {/* Blue when the client has no email to write to, so the header keeps one blue button. */}
          {!viewOnly && (
            <Link className={`b ${canWrite || client.archived_at ? "b-secondary" : "b-primary"}`} href={`${here}${here.includes("?") ? "&" : "?"}ask=1`} scroll={false}>
              <FilePlus2 size={15} aria-hidden />
              Ask for papers
            </Link>
          )}
          {canWrite && (
            <Link className="b b-primary" href={`/app/inbox?compose=${client.id}`}>
              <Mail size={15} aria-hidden />
              Write to client
            </Link>
          )}
          <MoreMenu
            items={[
              ...(canUpload ? [{ label: "Upload papers", icon: <FileUp size={16} aria-hidden />, href: `${base}?tab=documents&upload=1` }] : []),
              ...(remindsNow ? [{ label: "Send reminder now", icon: <BellRing size={16} aria-hidden />, form: "remind-now" }] : []),
              ...(viewOnly ? [] : [{ label: "Add a notice", icon: <Scale size={16} aria-hidden />, href: `${base}?tab=notice` }]),
            ]}
          />
        </>
        }
      />
      <LinkTabs label="Client" items={(Object.keys(mains) as Main[]).map((key) => ({ href: `${base}${key === "work" ? "" : `?tab=${key}`}`, label: mains[key], count: counts[key] || undefined, current: tab === key }))} />

      <ViewTransition key={sub} enter="tab-in" exit="tab-out" default="none">
      <div className="pane client-pane">
        {!panel && !docPanel && tab !== "emails" && alert}

        {/* Details: one sheet of label and value rows in five groups, each with one Edit (shown
            on the group's hover or focus). Empty details are named once, at the end of About. */}
        {tab === "about" && (
          <div className="app-card client-sheet">
            <section className="sheet-group" aria-labelledby="details-card">
              <header>
                <h2 id="details-card">About</h2>
                {manage && <Link className="b b-ghost b-small sheet-edit" href={`${base}?tab=details`} scroll={false} aria-label="Edit details">Edit</Link>}
              </header>
              <ul className="sheet-rows">
                {aboutRows.filter(([, value]) => value).map(([label, value]) => (
                  <li key={label}><span>{label}</span><span>{value}</span></li>
                ))}
              </ul>
              {!!aboutMissing.length && (
                <p className="sheet-missing">
                  Not added yet: {aboutMissing.join(", ")}.
                  {manage && <> <Link href={`${base}?tab=details`} scroll={false}>Add missing details</Link></>}
                </p>
              )}
            </section>
            <section className="sheet-group" aria-labelledby="numbers">
              <header>
                <h2 id="numbers">Tax numbers</h2>
                {manage && <Link className="b b-ghost b-small sheet-edit" href={`${base}?tab=numbers`} scroll={false} aria-label="Edit tax numbers">Edit</Link>}
              </header>
              {numbers.length ? (
                <ul className="sheet-rows">
                  {numbers.map((registration) => {
                    const name = numberKinds[registration.kind as NumberKind].name;
                    return (
                      <li key={registration.id}>
                        <span>{name}</span>
                        <span>
                          {idNumber(name, registration.number)}
                          {registration.kind === "tan" && manage && <Link href={`${base}?tab=tds&tan=${registration.id}`} scroll={false}>TDS statement details</Link>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="sheet-missing">No numbers yet. A PAN or GSTIN helps InboxCA recognise the client&apos;s papers.</p>
              )}
            </section>
            {numbers.some((registration) => servicesFor(registration).length) && (
              <section className="sheet-group" aria-labelledby="services-card">
                <header>
                  <h2 id="services-card">Services</h2>
                  {manage && <Link className="b b-ghost b-small sheet-edit" href={`${base}?tab=services`} scroll={false} aria-label="Edit services">Edit</Link>}
                </header>
                <ul className="sheet-rows">
                  {numbers.filter((registration) => servicesFor(registration).length).map((registration) => (
                    <li key={registration.id}>
                      <span>{numberKinds[registration.kind as NumberKind].name}</span>
                      <span>{usualFor.has(registration.id) ? `Suggested: ${usualFor.get(registration.id)!.map((code) => rule.get(code)?.name ?? code).join(", ")}` : registration.services.map((code) => rule.get(code)?.name ?? code).join(", ") || <span className="hint">None chosen yet</span>}</span>
                    </li>
                  ))}
                </ul>
                {manage && !!usualFor.size && (
                  <form action={manageClient} className="services-usual">
                    {hidden("about")}
                    {[...usualFor].map(([registration, codes]) => (
                      <Fragment key={registration}>
                        <input type="hidden" name="registration" value={registration} />
                        {codes.map((code) => <input key={code} type="hidden" name={`service-${registration}`} value={code} />)}
                      </Fragment>
                    ))}
                    <span className="hint">Usual for this client type. Nothing is saved until you choose Use these.</span>
                    <Pending className="b b-secondary b-small" name="intent" value="services">Use these</Pending>
                  </form>
                )}
              </section>
            )}
            <section className="sheet-group" aria-labelledby="contacts-card">
              <header>
                <h2 id="contacts-card">Contacts</h2>
                {manage && <Link className="b b-ghost b-small sheet-edit" href={`${base}?tab=contacts`} scroll={false} aria-label="Edit contacts">Edit</Link>}
              </header>
              {contacts.length ? (
                <ul className="sheet-rows">
                  {contacts.map((contact) => (
                    <li key={contact.contact_id}><span>{contact.name}</span><span>{[contact.email, contact.relation].filter(Boolean).join(", ")}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="sheet-missing">No contacts yet.</p>
              )}
            </section>
            <section className="sheet-group" aria-labelledby="team-card">
              <header>
                <h2 id="team-card">People</h2>
                {manage && <Link className="b b-ghost b-small sheet-edit" href={`${base}?tab=team`} scroll={false} aria-label="Edit people">Edit</Link>}
              </header>
              {lookers.length ? (
                <ul className="sheet-rows">
                  {lookers.map((assignment) => (
                    <li key={assignment.value}><span className="who"><Avatar name={who(assignment)} square={!!assignment.team_id} />{who(assignment)}</span><span>{assignmentLabel(assignment)}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="sheet-missing">Nobody is assigned yet.</p>
              )}
            </section>
          </div>
        )}

        {/* The Inbox for this client alone: its list, reading pane and reply (inbox-view.tsx). */}
        {tab === "emails" && <InboxView searchParams={searchParams} client={{ id: client.id, name: client.name }} />}

        {tab === "documents" && (
          <>
            <div className="client-tools">
              <Form action={base} role="search" className="clients-find">
                <input type="hidden" name="tab" value="documents" />
                <span className="search">
                  <Search size={16} aria-hidden />
                  <LiveSearch name="find" defaultValue={find} placeholder="Find a paper by a word in it or its name" aria-label="Find a paper" />
                </span>
                {find && <Link className="b b-ghost" href={`${base}?tab=documents`}>Show all</Link>}
              </Form>
              <span className="page-actions">
                {canUpload ? (
                  <Link className="b b-secondary" href={`${base}?tab=documents&upload=1`} scroll={false}>
                    <FileUp size={15} aria-hidden />
                    Upload papers
                  </Link>
                ) : (
                  askButton("upload", "Ask to upload")
                )}
              </span>
            </div>
            <DroppedNotice value={dropped} />
            {askedRight && <Toast>Permission asked. Once allowed, it works here once, within an hour.</Toast>}
            {sharedFile && <Toast>Sent {sharedFile.name}. The link works for 7 days and 5 downloads.</Toast>}
            {askedFor === "sent" && <Toast>The client was emailed the list of papers. What they reply with is saved here.</Toast>}
            <Suspense fallback={null}>
              <RemindToast from="files" />
            </Suspense>
            {uuid.test(closed ?? "") && (
              <Toast
                undo={
                  <form action={stopAsking}>
                    <input type="hidden" name="request" value={closed} />
                    <Pending className="b" name="intent" value="undo" busy="Undoing">Undo</Pending>
                  </form>
                }
              >
                Stopped asking. No more reminders go for these papers.
              </Toast>
            )}
            {reopened && <Toast>Asking again. Reminders go as before.</Toast>}
            {askedFor === "nomail" && <p className="note" role="status"><span>The papers are noted, but no email went: connect the firm email in Settings and add the client&apos;s email address, then the reminders go by themselves.</span></p>}
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
            {!!asking.length && <MenuClose />}
            {!!asking.length && (
              <Card id="asks" title="Papers asked for" Icon={FileClock} kind="papers" count={asking.length} countTone="warn">
                <ul className="app-rows" aria-label="Papers asked for">
                  {asking.map((request) => {
                    const details = request.details as unknown as DocumentRequest;
                    const got = details.items.filter((item) => item.received.length).length;
                    // Those in and not yet checked: one button marks them all checked; each one
                    // on its own, and Ask again, are under More. With nothing in, Ask again emails
                    // the client now; Stop asking is under More.
                    const toCheck = details.items.flatMap((item, at) => (item.received.length && !item.checked ? [{ item, at }] : []));
                    const stoppable = looksAfter && request.status === "pending";
                    const papersWord = details.items.map((item) => item.type).join(", ");
                    return (
                      <Row
                        key={request.id}
                        title={`Asked for ${details.items.map((item) => item.type).join(", ")}${details.period ? ` for ${periodName(details.period, ...details.items.map((item) => item.work))}` : ""}`}
                        meta={`${got} of ${details.items.length} received. Reminders go until ${dueLabel(request.expires_at!.slice(0, 10))}.`}
                        action={
                          !viewOnly && (!!toCheck.length || stoppable) && (
                            <span className="cell-form">
                              {!toCheck.length ? !got && mailable && (
                                <form action={remindClient}>
                                  <input type="hidden" name="client" value={client.id} />
                                  <input type="hidden" name="from" value="files" />
                                  <Pending className="b b-secondary" busy="Sending" aria-label={`Ask again for ${papersWord}`}>Ask again</Pending>
                                </form>
                              ) : (
                              <form action={checkRequestItem}>
                                <input type="hidden" name="request" value={request.id} />
                                {toCheck.map(({ at }) => <input key={at} type="hidden" name="item" value={at} />)}
                                <Pending className="b b-secondary" name="intent" value="checked" aria-label={`Mark ${toCheck.map(({ item }) => item.type).join(", ")} checked`}>
                                  Mark checked
                                </Pending>
                              </form>
                              )}
                              <details className="rf-menu">
                                <summary className="b b-ghost" aria-label={`More for ${details.items.map((item) => item.type).join(", ")}`}>
                                  More
                                  <ChevronDown size={15} aria-hidden />
                                </summary>
                                <div className="rf-pop is-end">
                                  {toCheck.map(({ item, at }) => (
                                    <form key={at} action={checkRequestItem} className="ask-item">
                                      <input type="hidden" name="request" value={request.id} />
                                      <input type="hidden" name="item" value={at} />
                                      <span className="grow">{item.type}</span>
                                      <Pending className="b b-ghost b-small" name="intent" value="checked" aria-label={`${item.type} is right`}>
                                        Mark checked
                                      </Pending>
                                      <Pending className="b b-ghost b-small" name="intent" value="again" aria-label={`Ask again for ${item.type}`}>
                                        Ask again
                                      </Pending>
                                    </form>
                                  ))}
                                  {stoppable && (
                                    <form action={stopAsking} className="ask-item">
                                      <input type="hidden" name="request" value={request.id} />
                                      <span className="grow">Reminders</span>
                                      <Pending className="b b-ghost b-small" name="intent" value="stop" busy="Stopping" aria-label={`Stop asking for ${papersWord}`}>
                                        Stop asking
                                      </Pending>
                                    </form>
                                  )}
                                </div>
                              </details>
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
                        <th scope="col">Type and period</th>
                        <th scope="col">Came from</th>
                      </tr>
                    </thead>
                    <tbody className="stagger">
                      {documents.map((document) => {
                        const twin = document.status === "to_check" && sameAs(document);
                        const path = folderFor(order, client.name, { work: document.work_type as WorkType, period: document.period_key, receivedAt: document.received_at, toCheck: document.status === "to_check" }).join(" / ");
                        const origin = origins.get(document.id)!;
                        return (
                          <tr key={document.id}>
                            <td>
                              <span className="who">
                                <IconTile Icon={fileIcon(document.name)} kind="docs" />
                                <span className="client-paper">
                                  <span className="client-paper-name">
                                    <Link className="row-link" href={`/app/files/${document.id}/view`}>
                                      {document.name}
                                    </Link>
                                    {/* Only what needs someone: a saved paper says nothing. */}
                                    {document.status === "to_check" ? <span className="badge warn" title={twin || origin.why}>To check</span> : document.status === "missing" && <Badge tone="late">Missing in the drive</Badge>}
                                  </span>
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
                            <td>
                              {paperType(document.document_type)}
                              <span className="sub">{periodName(document.period_key, document.work_type) || "No period"}</span>
                            </td>
                            <td>
                              {/* Where it came from in short, then Check or Open its panel (shown on the
                                  row's hover or focus, and always for one to check). */}
                              <span className="paper-came">
                                {/* On the client's own page an email of theirs needs no name. */}
                                <CameFrom origin={{ ...origin, how: document.email_event_id ? origin.short.replace(` from ${client.name}`, "") : origin.how, from: undefined, file: undefined }} why={false} />
                                {!viewOnly && (
                                  <Link className={`b b-secondary b-small paper-open${document.status === "to_check" ? " is-due" : ""}`} href={`${base}?tab=documents&edit=${document.id}`} scroll={false} aria-label={`${document.status === "to_check" ? "Check" : "Open"} ${document.name}`}>
                                    {document.status === "to_check" ? "Check" : "Open"}
                                  </Link>
                                )}
                              </span>
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
            {/* Figures and return files not for any one return, and the box for portal files. */}
            {(otherFigures || otherFiles) && (
              <p className="client-tools hint">
                <span className="work-other">
                  {otherFigures && <Link href={`${base}?tab=extraction`}>Other figures</Link>}
                  {otherFiles && <Link href={`${base}?tab=outputs`}>Other return files</Link>}
                </span>
              </p>
            )}
            {membership.may("portal_files", client.id) && !viewOnly && <PortalDrop clientId={client.id} back="files" />}
          </>
        )}

        {tab === "work" && sub !== "work" && (
          <LinkTabs kind="pills" label="Parts of Work" items={[["", "Returns"], ["extraction", "Other figures"], ["outputs", "Other return files"]].map(([key, label]) => ({ href: key ? `${base}?tab=${key}` : base, label, current: sub === key }))} />
        )}
        {sub === "work" && (
          <>
            <DroppedNotice value={dropped} />
            <Suspense fallback={null}>
              <RemindToast />
            </Suspense>
            {remindsNow && (
              <form id="remind-now" action={remindClient} hidden>
                {returnsState}
                <input type="hidden" name="from" value="client" />
              </form>
            )}
            {/* One quiet line: who looks after the client and what is due next. */}
            <p className="work-line">
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
              {nextDue && !client.archived_at && (
                <span className="work-next">
                  <CalendarClock size={14} aria-hidden />
                  Next due: {rule.get(nextDue.code ?? "")?.name ?? nextDue.code} {periodLabel(rule.get(nextDue.code ?? "")?.frequency ?? null, nextDue.period_key, nextDue.code)}, {dueIn === 0 ? "today" : dueIn === 1 ? "tomorrow" : `in ${dueIn} days`}
                </span>
              )}
              {confirmDates && (
                <span className="work-next">
                  Due dates are not confirmed yet.
                  <Link href="/app/settings?group=reminders#due-dates">Confirm them</Link>
                </span>
              )}
            </p>
            {/* What needs attention: returns late or due in the next 30 days, and a date InboxCA
                still needs to put a company's or a director's returns on the Calendar. */}
            {workRows.length || datesNeeded ? (
              <Card id="due" title="Due soon" Icon={CalendarClock} kind="week" count={soon.length} countTone={soon.some((row) => row.late) ? "late" : ""}>
                {!!soon.length && <WorkRows rows={soon} />}
                {datesNeeded && (
                  <ul className="app-rows work-dates" aria-label="Dates InboxCA needs">
                    {/* A company's AOC-4, MGT-7 and ADT-1 fall due after its AGM: the date is asked, never guessed (public.record_agm). */}
                    {agmNeeded.map((registration) => (
                      <Row
                        key={registration.id}
                        lead={<IconTile Icon={CalendarCheck} kind="papers" />}
                        title="AGM date needed"
                        meta="AOC-4, MGT-7 and ADT-1 fall due after the AGM. Give its date and InboxCA puts them on the Calendar."
                        action={
                          <form action={recordAgm} className="agm-form">
                            <input type="hidden" name="client" value={client.id} />
                            <input type="hidden" name="registration" value={registration.id} />
                            <label>Financial year <select name="year_end" defaultValue={`${fyEnd}-03`}>{[fyEnd - 1, fyEnd].map((year) => <option key={year} value={`${year}-03`}>{periodLabel("yearly", `${year}-03`)}</option>)}</select></label>
                            <label>AGM date <input type="date" name="agm" required /></label>
                            <Pending className="b b-secondary b-small" busy="Saving">Save AGM date</Pending>
                          </form>
                        }
                      />
                    ))}
                    {/* DIR-3 KYC Web runs on the director's own three year cycle (rule 12A): the year of the last one is asked, never guessed (public.record_kyc). */}
                    {kycNeeded.map((registration) => (
                      <Row
                        key={registration.id}
                        lead={<IconTile Icon={CalendarCheck} kind="papers" />}
                        title="DIR-3 KYC year needed"
                        meta="DIR-3 KYC Web is due once every three financial years, by 30 June after the third. Give the financial year of the last KYC and InboxCA puts the next on the Calendar. After a change of mobile, email or home address the director files it again within 30 days."
                        action={
                          <form action={recordKyc} className="agm-form">
                            <input type="hidden" name="client" value={client.id} />
                            <input type="hidden" name="registration" value={registration.id} />
                            <label>Last KYC filed for <select name="year_end" defaultValue="" required><option value="" disabled>Choose a year</option>{[1, 2, 3, 4].map((back) => <option key={back} value={`${fyEnd - back}-03`}>{periodLabel("yearly", `${fyEnd - back}-03`)}</option>)}</select></label>
                            <Pending className="b b-secondary b-small" busy="Saving">Save KYC year</Pending>
                          </form>
                        }
                      />
                    ))}
                  </ul>
                )}
                {!soon.length && !datesNeeded && <p className="app-card-none">Nothing late or due in the next 30 days.</p>}
              </Card>
            ) : (
              <Empty Icon={CalendarDays} kind="week" title="No returns yet">
                <span>Choose the services your firm does for this client, and InboxCA lists their returns here with each due date.</span>
                {manage && <Link className="b b-primary" href={`${base}?tab=services`} scroll={false}>Choose services</Link>}
              </Empty>
            )}
            {/* The client's to-dos (20261110800000_client_todos.sql): red once late, green once done.
                The list shows only when there are some; Add a to-do opens the form in place. */}
            {!!todos?.length && (
              <Card id="todos" title="To-dos" Icon={ListChecks} kind="approve" count={todos.filter((todo) => todo.status === "upcoming").length}>
                <ul className="app-rows">
                  {[...todos.filter((todo) => todo.status === "upcoming"), ...todos.filter((todo) => todo.status !== "upcoming")].map((todo) => {
                    const { title, for: person } = todo.details as { title?: string; for?: string };
                    const open = todo.status === "upcoming";
                    const late = open && todo.due_on < today;
                    return (
                      <Row
                        key={todo.id}
                        title={title}
                        meta={`${todo.due_on === today ? "Today" : `${late ? "Was due" : "By"} ${dueLabel(todo.due_on)}`}, for ${person ? personName(people?.find((row) => row.user_id === person)?.email) : "the owner"}`}
                        status={open ? late && <Badge tone="late">Late</Badge> : <Badge tone="done">Done</Badge>}
                        action={(manage || person === userId) && !viewOnly && (
                          <form action={manageClient}>
                            {hidden("overview")}
                            <input type="hidden" name="todo" value={todo.id} />
                            <Pending className="b b-secondary b-small" name="intent" value={open ? "todo-done" : "todo-undo"} aria-label={`${open ? "Done" : "Undo"}: ${title}`}>{open ? "Done" : "Undo"}</Pending>
                          </form>
                        )}
                      />
                    );
                  })}
                </ul>
              </Card>
            )}
            {manage && !viewOnly && (
              <details className="work-more todo-add" open={error === "todo"}>
                <summary className="b b-ghost b-small"><Plus size={15} aria-hidden />Add a to-do</summary>
                <form action={manageClient} className="app-card agm-form">
                  {hidden("overview")}
                  <label className="grow">To-do <input name="todo_title" required maxLength={120} placeholder="Call about the rent receipts" /></label>
                  <label>By <input type="date" name="todo_on" defaultValue={today} required /></label>
                  <label>For <select name="todo_for" defaultValue="">
                    <option value="">The owner</option>
                    {/* Only those who can see this client, so a to-do never goes to someone who cannot. */}
                    {people?.filter((row) => row.status === "active" && seesClient(row, client.client_assignments, membership.settings)).map((row) => <option key={row.user_id} value={row.user_id}>{personName(row.email)}</option>)}
                  </select></label>
                  <Pending className="b b-secondary b-small" name="intent" value="add-todo">Save to-do</Pending>
                </form>
              </details>
            )}
            {/* Later and filed returns open in place from two quiet links, so Work opens on what is due. */}
            {!!later.length && <WorkFold title={`${later.length} later ${later.length === 1 ? "return" : "returns"}`} open={!soon.length || show === "later"} rows={later} />}
            {!!filedRows.length && <WorkFold title={`${filedRows.length} filed this year`} open={show === "filed"} rows={filedRows} />}
          </>
        )}
        {sub === "extraction" && <><DatasetReview clientId={id} draftId={draft} lineId={line} check={check} view={view}/><div className="fig-tools">{pan && <Card id="itr-return" className="tool" title="Income tax return" Icon={FileText} kind="docs" end={<Link className="b b-secondary" href={`${base}/itr`}>Open the return</Link>}><p className="app-card-none">ITR-1 to ITR-4, filled with the client&apos;s PAN and the figures InboxCA already holds for the year. The rest is listed for you to fill.</p></Card>}<PortalInput clientId={id} message={portal}/><SalesInput clientId={id} source={source} section={section} header={header} read={read}/><PurchaseMatch clientId={id} searchParams={searchParams}/></div></>}
        {sub === "outputs" && <PreparedForms client={id} message={formMessage}/>}

        {tab === "notices" && (
          <>
            {/* The how-to only while a date waits to be checked; Add and All notices together. */}
            {!!notices?.length && (
              <p className="client-tools hint">
                <span>{notices.some((notice) => !(notice.details as unknown as NoticeDetails).action_date) && "Check each suggested date against the notice, then choose Mark date checked."}</span>
                <span className="page-actions">
                  {!viewOnly && <Link className="b b-secondary" href={`${base}?tab=notice`} scroll={false}>Add a notice</Link>}
                  <Link href="/app/notices">All notices</Link>
                </span>
              </p>
            )}
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
                                  {Object.entries(noticeStatuses).filter(([value]) => value !== "closed" || details.reply).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
                <p className="client-none">
                  <span>No notices. One that comes by email is saved here by itself.</span>
                  {!viewOnly && <Link className="b b-secondary" href={`${base}?tab=notice`} scroll={false}>Add a notice</Link>}
                  <Link href="/app/notices">All notices</Link>
                </p>
              )}
            </section>
            {(noticeCount ?? 0) > 50 && pager(noticeCount ?? 0, notices?.length ?? 0, "Notices", "notices")}
          </>
        )}
      </div>
      </ViewTransition>

      <Presence>
      {panel === "numbers" && manage && (
        <SidePanel key="numbers-panel" id="numbers-panel" title="Tax numbers" close={about}>
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
        <SidePanel key="services" id="services" title="Services" close={about}>
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
        <SidePanel key="contacts" id="contacts" title="Contacts" close={about}>
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
        <SidePanel key="assigned" id="assigned" title="Looked after by" close={about}>
          {alert}
          <ul className="client-rows">
            {assigned.map((assignment) => (
              <li key={assignment.value}>
                <span className="grow"><span className="name">{labelOf.get(assignment.value)}</span><span className="sub">{assignmentLabel(assignment)}</span></span>
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
              <div>
                <label htmlFor="assign-work">For</label>
                <select id="assign-work" name="work" defaultValue="">
                  {Object.entries(assignmentWork).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <p className="hint">GST only or Income tax only puts just that desk&apos;s returns on this person&apos;s list. Papers, notices and emails for the client stay with everyone assigned.</p>
              <Pending className="b b-primary" name="intent" value="assign">Assign</Pending>
            </form>
          )}
        </SidePanel>
      )}
      {panel === "details" && manage && (
        <SidePanel key="details" id="details" title="Details" close={about}>
          {alert}
          <form action={manageClient} className="fields">
            {hidden("details")}
            <div><label htmlFor="client-name">Name</label><input id="client-name" name="name" required defaultValue={client.name} /></div>
            <div><label htmlFor="client-email">Email</label><input id="client-email" name="email" type="email" defaultValue={email} /></div>
            <div><label htmlFor="client-phone">Phone</label><input id="client-phone" name="phone" type="tel" maxLength={20} className="num" defaultValue={phone} /></div>
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
            <div><label htmlFor="client-tags">Tags, separated by commas</label><input id="client-tags" name="tags" maxLength={200} defaultValue={client.tags.join(", ")} placeholder="Priority, Audit 2027" /></div>
            <div><label htmlFor="client-engagement">What we do for them, and since when</label><textarea id="client-engagement" name="engagement" maxLength={300} rows={2} defaultValue={engagement} placeholder="GST returns and ITR since 2019" /></div>
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
          <h3>Licences and registrations</h3>
          <p className="hint">Expiry dates you enter here, like a DSC, FSSAI, Shop Act, IEC or MSME, show on the Calendar and Today before the date. InboxCA does not remind the client of them.</p>
          {!!licences?.length && (
            <ul className="app-rows">
              {licences.map((licence) => (
                <li key={licence.id} className="app-row">
                  <span className="grow">{licenceLabel(licence)}: {licence.status === "filed" ? "renewed" : licence.due_on < today ? "expired" : "until"} {dueLabel(licence.due_on)}</span>
                  <form action={manageClient}>
                    {hidden("details")}
                    <input type="hidden" name="licence" value={licence.id} />
                    <Pending className="b b-ghost b-small" name="intent" value="remove-licence" aria-label={`Remove ${licenceLabel(licence)}`}>Remove</Pending>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={manageClient} className="fields">
            {hidden("details")}
            <div><label htmlFor="licence-label">Licence or registration</label><input id="licence-label" name="label" required maxLength={60} placeholder="FSSAI licence" list="licence-kinds" /></div>
            <datalist id="licence-kinds">{["DSC", "FSSAI licence", "Shop Act licence", "IEC", "MSME registration"].map((kind) => <option key={kind} value={kind} />)}</datalist>
            <div><label htmlFor="licence-holder">Holder&apos;s name, for a DSC</label><input id="licence-holder" name="holder" maxLength={50} placeholder="Optional" /></div>
            <div><label htmlFor="licence-on">Valid until</label><input id="licence-on" name="on" type="date" required /></div>
            <Pending className="b b-secondary" name="intent" value="add-licence">Add expiry date</Pending>
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
      {panel === "tds" && manage && (
        <SidePanel key="tds" id="tds" title="TDS statement details" close={about}>
          <TdsDetails client={client.id} name={client.name} tans={numbers.filter((registration) => registration.kind === "tan")} tan={tan} error={error} />
        </SidePanel>
      )}
      {panel === "activity" && (
        <SidePanel key="client-activity" id="client-activity" title="Activity" close={about}>
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
          <p className="hint">InboxCA emails the client this list from your firm&apos;s email. They reply with the papers attached.</p>
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
            types={[...listedTypes.filter((type) => type !== "Document"), ...firmTypes]}
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
          {paper.status === "to_check" && <p className="hint">{sameAs(paper) || `Waiting to be checked: ${origins.get(paper.id)?.why}`}. <Link className="paper-view" href={`/app/files/${paper.id}/view`}>View the paper</Link></p>}
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
          <MarkFiled state={returnsState} rows={[{ id: filing.id, name: `${rule.get(filing.code ?? "")?.name ?? filing.code} ${periodLabel(rule.get(filing.code ?? "")?.frequency ?? null, filing.period_key, filing.code)}`, sub: `Due ${dueLabel(filing.due_on)}`, itr: isItr(filing.code), udin: filing.code === "TAX_AUDIT" }]} />
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
          {done.length === 1 ? `${rule.get(done[0].code ?? "")?.name ?? done[0].code} ${periodLabel(rule.get(done[0].code ?? "")?.frequency ?? null, done[0].period_key, done[0].code)}` : `${done.length} returns`} {taskChanges[marked!]}.
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
        <select id="file-type" name="type" defaultValue={known ? listedType(type) || "Document" : "Other"}>
          {[...listedTypes, ...firmTypes].map((choice) => (
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
