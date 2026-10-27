import { BellRing, CalendarClock, CalendarOff, Check, Clock, CreditCard, Database, Download, Eye, FileCheck2, Gauge, HardDrive, Headset, KeyRound, LifeBuoy, LogIn, Mail, MailCheck, Receipt, RotateCcw, ShieldCheck, SlidersHorizontal, TriangleAlert, UserCheck, UserPlus, Users, type LucideIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { answerSupport, changeHoliday, changeSpecialHours, choosePreset, closeFirm, connectDrive, connectMailSignIn, disconnectDrive, reconnectDrive, disconnectMailbox, saveHours, saveAnswers, saveLimits, savePermissions, saveRecords, saveReminders, saveMailLimit, saveVisibility, setFolderOrder, withdrawAlways, allowStanding } from "@/app/(app)/actions";
import { firmAdmin, HOURS_KEYS, memberHours, officeApprover, type Office } from "@/src/lib/office";
import { presetOf, presets } from "@/src/lib/presets";
import { OfficePanel } from "../office-panel";
import { AutoSelect } from "../auto-select";
import { AccessCheck } from "./access-check";
import { documentTypes } from "@/src/lib/documents";
import { paperType } from "@/src/lib/paper-type";
import { switchable, defaults, type Permissions, type Standing } from "@/src/lib/rights";
import { isRoutine, type RecordsSettings } from "@/src/lib/records";
import { answerKinds, answerMode, answerModes, UNDO_MINUTES, type AnswerKind } from "@/src/lib/answers";
import { folderOrderNames, namings } from "@/src/lib/drive";
import { lowSpace } from "@/src/jobs/drive-check";
import { supabaseAdmin } from "@/src/lib/supabase";
import { serverCrypto } from "@/src/lib/crypto";
import { DAYS, longDate, SUGGESTED_HOURS, type Hours, type SpecialHours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { IDLE_CHOICES, SESSION_CHOICES } from "@/src/lib/session";
import { Badge, IconTile, NotForYou, PageHead, storage, Toast, type Kind } from "../ui";
import { Item, List } from "../motion";
import { Pending } from "../pending";
import { STAGES, askChoices, askDays, stageNames, reminderStages } from "@/src/lib/reminders";
import { isMailApi, mailSignInReady, signInNames, signInNotReady } from "@/src/lib/mail-oauth";
import { mailApis, type MailApi } from "@/src/lib/mail-view";
import { MailboxForm } from "./mailbox-form";
import { GroupAnchor } from "./group-anchor";
import { saveReplies } from "@/app/(app)/actions";
import { REPLY_DAYS } from "@/src/lib/team-replies";
import { PushSwitch } from "../push-switch";
import { BillingCards } from "./billing";
import "./settings.css";

const driveNames: Record<string, string> = { onedrive: "OneDrive", dropbox: "Dropbox", local: "Test drive on this computer" };
// Each problem a save can report, shown in the section it belongs to.
const problems: Record<string, [string, string]> = {
  permission_scope: ["permissions", "Check the end date and client names. Use the full names shown in Clients, one per line, with no repeated names."],
  mail_limit: ["mailbox", "Choose a whole number from 1 to 2,000 for the email limit."],
  mail_denied: ["mailbox", "The sign in was not allowed, so nothing was connected."],
  mail_failed: ["mailbox", "The email did not finish connecting. Try again."],
  mail_taken: ["mailbox", "A firm email is already connected. Disconnect it first to use another address."],
  mail_admin: ["mailbox", "Microsoft did not let InboxCA connect. If your firm uses Microsoft 365, the person who manages it may need to allow InboxCA once for the whole firm. Ask them to choose Allow for the whole firm below."],
  drive_terms: ["drive", "Tick the box to agree to the Drive access terms first."],
  drive_provider: ["drive", "Choose a drive."],
  drive_taken: ["drive", "A drive is already connected. Disconnect it first."],
  drive_denied: ["drive", "You did not allow InboxCA on your drive's sign in page, so the drive is not connected. Connect again and choose Allow."],
  drive_failed: ["drive", "The drive did not finish connecting. Try again."],
  drive_other: ["drive", "That is a different Dropbox account. Sign in with the one already connected, or disconnect it first."],
  close_name: ["close", "Type the firm name exactly as it is shown."],
  special: ["special", "The To date must be the same as or after the From date, and Closes must be later than Opens."],
  ...Object.fromEntries(DAYS.map((day) => [day, ["hours", `${day}: the closing time must be after the opening time.`]])),
};
const savedNames: Record<string, string> = { checkout: "Thank you. The payment shows here as soon as your bank confirms it.", autopay_off: "AutoPay is off. Nothing more will be taken.", down: "Your plan moves down at the next renewal.", down_undone: "Your plan stays as it is.", topup: "Auto top-up saved.", money_back: "Your plan is cancelled and your money is on its way back.", preset: "Saved. Your team now works this way.", visibility: "Who sees clients saved.", hours: "Office hours saved.", limits: "Signing in limits saved.", reminders: "Reminders saved.", records: "Paper sending rules saved.", permissions: "Permissions saved.", reset: "Permissions reset to the defaults.", allowed: "Permission given.", withdrawn: "Permission withdrawn.", folders: "Folder order and file names saved.", mail_off: "Firm email disconnected.", deputies: "Deputies and second admin saved.", drive_off: "Drive disconnected. Your papers stay in your drive.", mail_limit: "Email limit saved.", mail: "Firm email connected.", mail_admin: "Your admin allowed InboxCA. Now connect with Microsoft.", drive: "Drive connected again. InboxCA is checking it now.", answers: "Replies saved.", replies: "Reply time saved." };
// The page shows one group at a time, chosen by ?group=. Each section keeps its old anchor.
const groups = [
  ["email", "Email and drive", ["mailbox", "replies", "drive"]],
  ["access", "Office and sign in", ["preset", "office", "limits", "tester", "notices", "recovery"]],
  ["hours", "Hours and holidays", ["hours", "special", "holidays"]],
  ["people", "People's access", ["permissions", "always", "visibility"]],
  ["reminders", "Reminders and papers", ["reminders", "answers", "records"]],
  ["data", "Your data", ["use", "data", "support", "close"]],
  ["billing", "Billing", ["plan", "change", "addons", "receipts", "money_back"]],
] as const;
const groupIcons: Record<string, LucideIcon> = { email: Mail, access: ShieldCheck, hours: Clock, people: Users, reminders: BellRing, data: Database, billing: CreditCard };
// Each card's tile: what it is about, in the colour of its kind.
const cardIcons: Record<string, [LucideIcon, Kind]> = {
  mailbox: [Mail, "approve"], drive: [HardDrive, "docs"], preset: [ShieldCheck, "approve"], limits: [LogIn, "approve"], tester: [UserCheck, "approve"], notices: [BellRing, "approve"], recovery: [LifeBuoy, "approve"],
  hours: [Clock, "week"], special: [CalendarClock, "week"], holidays: [CalendarOff, "week"],
  permissions: [KeyRound, "papers"], always: [UserCheck, "papers"], visibility: [Eye, "papers"],
  reminders: [BellRing, "notice"], answers: [MailCheck, "notice"], records: [FileCheck2, "notice"],
  replies: [Clock, "reply"],
  use: [Gauge, "docs"], data: [Download, "docs"], support: [Headset, "approve"], close: [TriangleAlert, "late"],
  plan: [CreditCard, "approve"], change: [SlidersHorizontal, "approve"], addons: [UserPlus, "papers"], receipts: [Receipt, "docs"], money_back: [RotateCcw, "late"],
};
const ownerOnly = ["mailbox", "replies", "drive", "recovery", "visibility", "reminders", "answers", "records", "use", "data", "support", "close", "plan", "change", "addons", "receipts", "money_back"];
const download = <form action="/app/settings/download" method="post"><button className="b b-secondary" type="submit">Download your data</button></form>;

function Card({ id, title, line, danger, children }: { id: string; title: string; line?: React.ReactNode; danger?: boolean; children: React.ReactNode }) {
  const [Icon, kind] = cardIcons[id] ?? [Database, "docs"];
  return (
    <section id={id} className={`panel set-card${danger ? " set-danger" : ""}`} aria-labelledby={`${id}-title`}>
      <header className="set-head">
        <IconTile Icon={Icon} kind={kind} />
        <span className="grow">
          <h2 id={`${id}-title`}>{title}</h2>
          {line && <p className="hint">{line}</p>}
        </span>
      </header>
      {children}
    </section>
  );
}

// The owner's settings: the firm's email, who sees clients, office hours, holidays and
// signing in limits (PLAN.md 5.13, 5.17).
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; group?: string; branch?: string; check?: string; confirm?: string; change?: string; clients?: string; practice?: string; people?: string; cycle?: string }>;
}) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  if (!officeApprover(membership.role, userId, membership.settings)) return <NotForYou title="Settings" who="the owner" />;
  if (!firmAdmin(membership.role, userId, membership.settings)) return <><PageHead title="Office approvals" sub="Approve your office internet connection and the PCs your staff use." /><OfficePanel branch={(await searchParams).branch} error={(await searchParams).error} /></>;
  const owner = membership.role === "owner";
  const { saved, error, group: asked, branch, check, confirm, ...plan } = await searchParams;
  // The co-admin sees only the groups about keeping client data safe.
  const shown = groups.map(([id, name, sections]) => [id, name, sections.filter((section) => owner || !ownerOnly.includes(section))] as const).filter(([, , sections]) => sections.length);
  const groupOf = Object.fromEntries(shown.flatMap(([id, , sections]) => sections.map((section) => [section, id])));
  const group = shown.find(([id]) => id === asked)?.[0] ?? groupOf[problems[error ?? ""]?.[0]] ?? shown[0][0];
  // Only the open group's data is read, all at once. The usage meters (about 100 ms at 10,000
  // clients) come in after the page, in their own card.
  const admin = supabaseAdmin();
  const usage = group === "data" ? Promise.resolve(supabase.rpc("firm_usage", { target_firm: membership.firmId })).then(({ data }) => data?.[0]) : null;
  const [{ data: closed }, { data: accounts }, { data: people }, { data: standing }, { data: branches }] = await Promise.all([
    // A closed firm keeps only its download until InboxCA deletes it, 30 days on.
    supabase.from("activity_log").select("at").eq("entity_id", membership.firmId).eq("firm_id", membership.firmId).eq("action", "firm.closed").maybeSingle(),
    group === "email" ? supabase.from("connected_accounts").select("id, kind, provider, address_enc, status") : Promise.resolve({ data: null }),
    group === "people" ? supabase.rpc("firm_people", { target_firm: membership.firmId }) : Promise.resolve({ data: null }),
    // People the owner or a deputy always allowed something, from a question in the Inbox.
    group === "people" ? admin.from("firm_members").select("user_id, access").eq("firm_id", membership.firmId).not("access->always", "is", null) : Promise.resolve({ data: null }),
    // Each branch may keep its own hours (5.17.4 #13).
    group === "hours" ? supabase.from("groups").select("id, name, kind, settings").eq("firm_id", membership.firmId).eq("kind", "branch").order("name") : Promise.resolve({ data: null }),
  ]);
  if (closed) return (
    <div className="set-page">
      <PageHead title="Settings" sub="Only you, the owner, see this page." />
      <div className="set-body">
        <Card id="data" title="Your firm is closing" line={<>InboxCA deletes your firm&apos;s data on {longDate(new Date(Date.parse(closed.at) + 30 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }))}. Download your data before then. The activity log is kept one more year, as Indian rules require, then deleted. Papers in your firm&apos;s drive stay where they are.</>}>
          <div className="set-foot">{download}</div>
        </Card>
      </div>
    </div>
  );
  const mailbox = accounts?.find((account) => account.kind === "mail");
  const drive = accounts?.find((account) => account.kind === "drive");
  const crypto = serverCrypto();
  const permissions = (membership.settings.permissions ?? {}) as Permissions;
  const always = (standing ?? []).flatMap((member) => {
    const rights = ((member.access as { always?: Standing[] }).always ?? []).map(grant=>typeof grant==="string" ? {right:grant} : grant).filter(grant=>Object.hasOwn(switchable,grant.right));
    return rights.length ? [{ id: member.user_id, email: people?.find((person) => person.user_id === member.user_id)?.email ?? "", rights }] : [];
  });
  const scopeIds=group === "people" ? [...new Set([...Object.values(permissions).flatMap(column=>column?.scope?.clients ?? []),...always.flatMap(person=>person.rights.flatMap(grant=>"clients" in grant ? grant.clients ?? [] : []))])] : [];
  // Only the server reads a drive's settings; this page is the owner's.
  const [{ data: driveSettings }, { data: driveSetup }, { data: mailServers }, driveAddress, mailAddress, { data: scopeClients }, { data: driveAway }, low] = await Promise.all([
    drive ? admin.from("connected_accounts").select("settings").eq("id", drive.id).single() : Promise.resolve({ data: null }),
    // What InboxCA set up in the drive after Connect (the drive_setup job).
    drive ? supabase.from("activity_log").select("details").eq("firm_id", membership.firmId).eq("action", "drive.setup").eq("entity_id", drive.id).order("at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    mailbox?.status === "needs_reconnect" ? admin.from("connected_accounts").select("settings").eq("firm_id", membership.firmId).eq("id", mailbox.id).single() : Promise.resolve({ data: null }),
    drive && crypto.decrypt(membership.firmId, `accounts/${drive.id}/address`, drive.address_enc),
    mailbox && crypto.decrypt(membership.firmId, `accounts/${mailbox.id}/address`, mailbox.address_enc),
    scopeIds.length ? supabase.from("clients").select("id,name").eq("firm_id", membership.firmId).in("id", scopeIds) : Promise.resolve({ data: [] }),
    // The daily check could not reach the drive (drive_check), and how much space a year needs.
    drive ? supabase.from("requests").select("id").eq("firm_id", membership.firmId).eq("kind", "alert").eq("entity_type", "drive_away").eq("status", "pending").maybeSingle() : Promise.resolve({ data: null }),
    drive ? lowSpace(membership.firmId) : 0,
  ]);
  const folderOrder = (driveSettings?.settings as { folder_order?: string } | undefined)?.folder_order ?? "year_client_work";
  const naming = (driveSettings?.settings as { naming?: string } | undefined)?.naming ?? "client_type_period";
  // A line for each thing InboxCA set up in the drive, and whether it is as it should be.
  const setup = driveSetup?.details as { reached?: boolean; clients?: number; test_file?: boolean; shared?: boolean; free_bytes?: number | null; notices?: boolean } | undefined;
  const clientFolders = setup?.clients ?? 0;
  const ticks: [boolean, string][] | null = !setup ? null : !setup.reached ? [[false, "InboxCA could not reach your drive to set it up. Disconnect it and connect it again."]] : [
    [true, "Made the InboxCA folder"],
    [true, !clientFolders ? "Each client gets a folder when their first paper arrives" : clientFolders === 1 ? "Made this year's folder for your client" : `Made this year's folder for each of your ${clientFolders} clients`],
    [!!setup.test_file, setup.test_file ? "Saved a test file, read it back and removed it" : "Could not read back a test file. Disconnect the drive and connect it again."],
    [!setup.shared, setup.shared ? "The InboxCA folder is shared or has a link. Stop the sharing in your drive." : "The InboxCA folder is shared with nobody"],
    [setup.free_bytes == null || setup.free_bytes >= low, setup.free_bytes == null ? "Your drive does not say how much space is left" : `${(setup.free_bytes / 1024 ** 3).toFixed(1)} GB free in your drive${setup.free_bytes < low ? ". Free up space or add more, or InboxCA cannot save new papers" : ""}`],
    [true, setup.notices ? "Changes made in the drive show here within minutes" : "Changes made in the drive show here the next morning"],
  ];
  const ready: Record<string, boolean> = { onedrive: false, dropbox: !!process.env.DROPBOX_APP_KEY, local: true };
  const settings = membership.settings;
  // The hours shown and changed: the main office's, or the picked branch's as its people have them.
  const picked = branches?.find((row) => row.id === branch);
  const times = memberHours(settings, picked);
  const ownHours = !!picked && HOURS_KEYS.some((key) => key in ((picked.settings ?? {}) as object));
  const where = picked && <input type="hidden" name="branch" value={picked.id} />;
  const hours = (times.hours as Hours | undefined) ?? SUGGESTED_HOURS;
  const holidays = (times.holidays as string[] | undefined) ?? [];
  const special = (times.special_hours as SpecialHours[] | undefined) ?? [];
  const access = (settings.access ?? {}) as { hours_only?: boolean; idle_minutes?: number; session_hours?: number; india_only?: boolean };
  const hoursOnly = access.hours_only ?? false;
  const records = (settings.records ?? {}) as RecordsSettings;
  const namesOf=(ids?:string[])=>ids?.map(id=>scopeClients?.find(client=>client.id===id)?.name ?? "Client no longer available").join("\n") ?? "";
  const preset = presetOf(settings);
  const others = people?.filter((person) => person.role !== "owner" && person.status === "active") ?? [];
  const problem = (section: string) => error && problems[error]?.[0] === section && <p className="alert" role="alert">{problems[error][1]}</p>;
  // Connect with Google, Microsoft or Zoho, each shown only once its app's keys are set.
  const signIn = (again?: MailApi) => {
    const button = (provider: MailApi, admin = false) => (
      <form key={`${provider}-${admin}`} action={connectMailSignIn}>
        <input type="hidden" name="provider" value={provider} />
        {admin && <input type="hidden" name="admin" value="1" />}
        <Pending className={`b ${again ? "b-primary" : "b-secondary"}`}>{admin ? "Allow for the whole firm" : `Connect ${again ? "again " : ""}with ${signInNames[provider]}`}</Pending>
      </form>
    );
    const shown = again ? [again] : mailApis.filter(mailSignInReady);
    return <>
      {!!shown.length && <div className="set-foot">{shown.map((provider) => button(provider))}</div>}
      {!again && problem("mailbox")}
      {error === "mail_admin" && shown.includes("outlook") && <div className="set-foot">{button("outlook", true)}<p className="hint">Sign in as your firm&apos;s Microsoft 365 admin.</p></div>}
      {!again && <p className="hint">{signInNotReady() ?? "Or connect with the address and its password."}</p>}
    </>;
  };
  return (
    <div className="set-page">
      <PageHead title="Settings" sub={owner ? "How your firm uses InboxCA. Only you, the owner, see this page." : "How your firm keeps client data safe. As second admin, you can change these, and so can the owner."} />
      <GroupAnchor groupOf={groupOf} />
      <div className="set">
        <nav className="set-nav" aria-label="Settings">
          {shown.map(([id, name]) => {
            const Icon = groupIcons[id];
            return (
              <Link key={id} href={`/app/settings?group=${id}`} aria-current={group === id ? "page" : undefined}>
                <Icon size={16} aria-hidden />
                {name}
              </Link>
            );
          })}
        </nav>
        <div key={group} className="set-body page-in">
          {group === "email" && <>
          <Card id="mailbox" title="Firm email" line="The address your clients write to. InboxCA reads only your clients' emails, keeps no copy of them, and replies from this address.">
            {mailbox ? (
              <div className="connection">
                <Mail size={16} aria-hidden />
                <p className="grow" role="status">
                  <Badge tone={mailbox.status === "connected" ? "done" : "late"}>{mailbox.status === "connected" ? "Connected" : "Needs to be connected again"}</Badge>
                  <span className="sr-only">: </span>
                  <strong>{mailAddress}</strong>
                </p>
                <Link className="b b-secondary" href="/app/settings?group=email&confirm=mail#mailbox" scroll={false}>
                  Disconnect
                </Link>
              </div>
            ) : (
              <>
                {signIn()}
                <MailboxForm />
              </>
            )}
            {mailbox && confirm === "mail" && (
              <form action={disconnectMailbox} className="set-foot">
                <p className="hint grow">Disconnect {mailAddress}? InboxCA stops reading it, and replies and reminders stop until you connect it again. Your emails stay where they are.</p>
                <Pending className="b b-danger" type="submit" busy="Disconnecting">Yes, disconnect</Pending>
                <Link className="b b-secondary" href="/app/settings?group=email#mailbox" scroll={false}>Cancel</Link>
              </form>
            )}
            {mailbox?.status==="needs_reconnect" && <>
              <p className="alert" role="alert">Connect the firm email again. Replies will wait until it is connected.</p>
              {isMailApi(mailbox.provider) && mailSignInReady(mailbox.provider) ? signIn(mailbox.provider) : <MailboxForm reconnecting initial={{address:mailAddress ?? "",...Object.fromEntries(Object.entries((mailServers?.settings ?? {}) as Record<string,unknown>).filter(([key])=>["imap","smtp"].includes(key)).flatMap(([key,value])=>Object.entries(value as Record<string,string|number>).map(([part,value])=>[`${key}_${part}`,String(value)])))}} />}
            </>}
            {mailbox && <form action={saveMailLimit} className="set-fields">
              <div><label htmlFor="mail-limit">Emails in 24 hours</label><input id="mail-limit" name="limit" type="number" min="1" max="2000" step="1" className="num" defaultValue={Number(settings.mail_limit) || 500} /></div>
              <p className="hint set-wide">Every reply and bulk send shares this limit. Lower it if your email provider allows fewer.</p>
              {problem("mailbox")}
              <div className="set-foot"><Pending busy="Saving" className={`b ${mailbox.status === "connected" ? "b-primary" : "b-secondary"}`}>Save email limit</Pending></div>
            </form>}
          </Card>

          <Card id="replies" title="Replies from your team" line="Emails InboxCA cannot answer go to the person who looks after the client. They turn red once they wait longer than this.">
            <form action={saveReplies} className="set-stack">
              <div className="set-fields">
                <div>
                  <label htmlFor="reply-days">Late after</label>
                  <select id="reply-days" name="days" defaultValue={Number(settings.reply_days) || REPLY_DAYS}>
                    {[1, 2, 3, 4, 5].map((days) => <option key={days} value={days}>{days === 1 ? "1 working day" : `${days} working days`}</option>)}
                  </select>
                </div>
              </div>
              <p className="hint">Sundays and your holidays do not count.</p>
              <label className="check">
                <input className="toggle" type="checkbox" name="list" defaultChecked={settings.reply_list !== false} />
                Email me at 9:00 each morning when replies have waited more than a day
              </label>
              <div className="set-foot"><Pending busy="Saving" className="b b-primary" type="submit">Save reply time</Pending></div>
            </form>
          </Card>

          <Card id="drive" title="Firm drive" line="Client papers are saved in your firm's own drive, in folders by year, client and type of work. InboxCA keeps no copy of them.">
            {drive && (
              <form action={reconnectDrive} className="connection">
                <HardDrive size={16} aria-hidden />
                <p className="grow" role="status">
                  <Badge tone={driveAway ? "late" : "done"}>{driveAway ? "Cannot be reached" : "Connected"}</Badge>
                  <span className="sr-only">: </span>
                  <strong>{driveAddress}</strong>
                </p>
                {/* Signs in to the same drive again, keeping its folders and papers. */}
                {ready[drive.provider] && (
                  <Pending className={`b ${driveAway ? "b-primary" : "b-secondary"}`} type="submit" busy="Connecting again">
                    Connect again
                  </Pending>
                )}
                <Link className="b b-secondary" href="/app/settings?group=email&confirm=drive#drive" scroll={false}>
                  Disconnect
                </Link>
              </form>
            )}
            {drive && confirm === "drive" && (
              <form action={disconnectDrive} className="set-foot">
                <p className="hint grow">Disconnect {driveAddress}? InboxCA stops saving papers to it until you connect it again. The papers already in your drive stay where they are.</p>
                <Pending className="b b-danger" type="submit" busy="Disconnecting">Yes, disconnect</Pending>
                <Link className="b b-secondary" href="/app/settings?group=email#drive" scroll={false}>Cancel</Link>
              </form>
            )}
            {drive && problem("drive")}
            {drive && (
              <List className="set-rows set-ticks" label="What InboxCA set up">
                {ticks ? (
                  ticks.map(([ok, text]) => (
                    <Item key={text} className={ok ? undefined : "warn"}>
                      {ok ? <Check size={16} aria-label="Done" /> : <TriangleAlert size={16} aria-label="Needs a look" />}
                      <span className="grow">{text}</span>
                    </Item>
                  ))
                ) : (
                  <Item key="setting-up">
                    <span className="grow">InboxCA is setting up your drive. This takes a minute.</span>
                  </Item>
                )}
              </List>
            )}
            {drive && (
              <form action={setFolderOrder} className="set-fields">
                <p className="hint set-wide">
                  Old papers already in your drive? <Link href="/app/import">Add old files</Link> moves them into their client folders.
                </p>
                <div>
                  <label htmlFor="folder-order">Folder order for new papers</label>
                  <select id="folder-order" name="order" defaultValue={folderOrder}>
                    {Object.entries(folderOrderNames).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="naming">How new papers are named</label>
                  <select id="naming" name="naming" defaultValue={naming}>
                    {Object.entries(namings).map(([value, example]) => (
                      <option key={value} value={value}>
                        {example}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="set-foot"><Pending busy="Saving" className="b b-primary" type="submit">Save</Pending></div>
              </form>
            )}
            {!drive && (
              <form action={connectDrive} className="set-stack">
                <fieldset className="set-options">
                  <legend>Which drive</legend>
                  {(["onedrive", "dropbox", ...(process.env.DRIVE_LOCAL_DIR ? ["local"] : [])] as const).map((provider) => (
                    <label key={provider} className="check">
                      <input type="radio" name="provider" value={provider} required disabled={!ready[provider]} />
                      {driveNames[provider]}
                      {!ready[provider] && <span className="badge plain">Coming soon</span>}
                    </label>
                  ))}
                </fieldset>
                <p className="hint">InboxCA gets access to the whole drive, but it opens only the folders you choose and its own InboxCA folder. Connect a drive used only for your firm.</p>
                <div>
                  <h3 className="set-sub">What you are allowing InboxCA to do</h3>
                  <ul className="points">
                    <li>Read the files in the folders you choose, and every file it saves.</li>
                    <li>Make folders, and rename and move folders and files to keep them in order.</li>
                    <li>Save papers from client emails, and the returns it prepares.</li>
                    <li>Read figures from your papers to prepare GST and income tax returns for your team to check.</li>
                    <li>It will not delete a file without your approval, share anything outside your firm, open folders you did not choose, or use your files to train AI.</li>
                    <li>You can take this access back at any time, here or at your drive provider.</li>
                  </ul>
                </div>
                <label className="check">
                  <input type="checkbox" name="agree" required />
                  <span>
                    I have read this and I agree, on behalf of my firm, to the <Link href="/terms#drive">Drive access terms</Link>.
                  </span>
                </label>
                {problem("drive")}
                <div className="set-foot"><Pending className="b b-primary" type="submit" busy="Connecting">Connect drive</Pending></div>
              </form>
            )}
          </Card>
          </>}

          {group === "access" && <>
          <Card id="preset" title="How your team works" line="One choice sets Office only, office hours and signing out. You can change each of them after.">
            <form id="preset-form" action={choosePreset} className="set-stack">
              <fieldset className="set-choices">
                <legend className="sr-only">How your team works</legend>
                {Object.entries(presets).map(([key, { name, line }]) => (
                  <label key={key}>
                    <input type="radio" name="preset" value={key} required defaultChecked={preset === key} aria-label={`${name}: ${line}`} />
                    <span><strong>{name}</strong> <span className="hint">{line}</span></span>
                  </label>
                ))}
              </fieldset>
              {(!(settings.office as Office | undefined)?.on || (settings.office as Office).anywhere) && <fieldset className="set-options"><legend>If you choose anything but Standard: are you in the office now?</legend>
                <label className="check"><input type="radio" name="here" value="yes" defaultChecked />Yes, I am in the office now</label>
                <label className="check"><input type="radio" name="here" value="no" />No, I will approve the office internet connection later, from the office</label>
              </fieldset>}
              <div className="set-foot">
                <Pending busy="Saving" className="b b-primary" type="submit">Use this choice</Pending>
                {!preset && <p className="hint">Your rules no longer match one of these choices.</p>}
              </div>
            </form>
            <OfficePanel error={error} inPreset branch={branch} />
          </Card>
          <Card id="limits" title="Signing in" line="For everyone in the firm, you included.">
            <form action={saveLimits} className="set-fields">
              <div>
                <label htmlFor="idle_minutes">Sign out after no activity for</label>
                <select id="idle_minutes" name="idle_minutes" defaultValue={access.idle_minutes ?? 0}>
                  {IDLE_CHOICES.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes ? `${minutes} minutes` : "Never"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="session_hours">Ask for the 2 step code again after</label>
                <select id="session_hours" name="session_hours" defaultValue={access.session_hours ?? 0}>
                  {SESSION_CHOICES.map((hours) => (
                    <option key={hours} value={hours}>
                      {hours ? `${hours} hours` : "Only at sign in"}
                    </option>
                  ))}
                </select>
              </div>
              <label className="check">
                <input className="toggle" type="checkbox" name="india_only" defaultChecked={!!access.india_only} />
                Everyone except you can use InboxCA only from India
              </label>
              <div className="set-foot"><Pending busy="Saving" className="b b-primary" type="submit">Save signing in limits</Pending></div>
            </form>
          </Card>
          <Card id="tester" title="Check someone's access" line="Can a person use InboxCA now, from here, on this PC? InboxCA answers with the same checks it makes on every page.">
            <AccessCheck person={check} />
          </Card>
          <Card id="notices" title="Notices on this computer" line="Show a notice on this computer when someone needs your approval. Off until you turn it on here.">
            {process.env.VAPID_PUBLIC_KEY ? <PushSwitch publicKey={process.env.VAPID_PUBLIC_KEY} /> : <p className="hint">Not set up yet.</p>}
          </Card>
          {owner && <Card id="recovery" title="Recovery codes" line="If you lose the phone that gives your 2 step code, sign in with the email code, then type one of these codes to set up a new phone. Each code works once. Keep them somewhere other than your phone.">
            {confirm === "codes" ? (
              <form action="/app/settings/recovery-codes" method="post" className="set-foot">
                <p className="hint grow">Your old codes stop working as soon as you download new ones.</p>
                <button className="b b-primary" type="submit">Yes, download 10 new codes</button>
                <Link className="b b-secondary" href="/app/settings?group=access#recovery" scroll={false}>Cancel</Link>
              </form>
            ) : (
              <div className="set-foot"><Link className="b b-secondary" href="/app/settings?group=access&confirm=codes#recovery" scroll={false}>Download 10 new codes</Link></div>
            )}
          </Card>}
          </>}

          {group === "hours" && <>
          <Card id="hours" title={picked ? `Office hours for ${picked.name}` : "Office hours"} line={picked ? "India time. The switch that limits people to office hours is under Main office." : "India time. You can always sign in. If the switch below is on, everyone else can use InboxCA only in these hours."}>
            {!!branches?.length && <Form action="/app/settings#hours">
              <input type="hidden" name="group" value="hours" />
              <div className="form-row"><div>
                <label htmlFor="hours-branch">Office</label>
                <AutoSelect save="branch" id="hours-branch" name="branch" defaultValue={picked?.id ?? ""}>
                  <option value="">Main office</option>
                  {branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </AutoSelect>
              </div><button className="sr-only" value="branch">Show</button></div>
              {picked && !ownHours && <p className="hint">{picked.name} uses the main office&apos;s hours, holidays and special hours until you save its own here.</p>}
            </Form>}
            <form action={saveHours} className="set-stack">{where}
              <table className="set-hours">
                <tbody>
                  {DAYS.map((name, day) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>
                        <label className="check">
                          <input className="toggle" type="checkbox" name={`open-${day}`} defaultChecked={!!hours[day]} /> Open
                        </label>
                      </td>
                      <td>
                        <input type="time" name={`from-${day}`} defaultValue={hours[day]?.[0] ?? "09:00"} aria-label={`${name} opens`} />
                        <span>to</span>
                        <input type="time" name={`to-${day}`} defaultValue={hours[day]?.[1] ?? "18:00"} aria-label={`${name} closes`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!picked && <label className="check">
                <input className="toggle" type="checkbox" name="hours_only" defaultChecked={hoursOnly} />
                Everyone except you can use InboxCA only during office hours, and not on holidays
              </label>}
              {problem("hours")}
              <div className="set-foot"><Pending busy="Saving" className="b b-primary" type="submit">Save office hours</Pending></div>
            </form>
            {ownHours && <form action={saveHours} className="set-foot">{where}
              <Pending className="b b-ghost" name="intent" value="follow">Use the main office&apos;s hours</Pending>
            </form>}
          </Card>

          <Card id="special" title={picked ? `Special hours for ${picked.name}` : "Special hours"} line="A tax season or a late evening: these times replace the office hours on every day in the dates. Holidays stay closed.">
            {!!special.length && <List className="set-rows" rise={false}>
              {special.map((range) => (
                <Item key={range.from + range.to}>
                  <span className="grow">
                    {range.from === range.to ? longDate(range.from) : `${longDate(range.from)} to ${longDate(range.to)}`}: {range.open} to {range.close}
                  </span>
                  <form action={changeSpecialHours}>{where}
                    <input type="hidden" name="from" value={range.from} />
                    <input type="hidden" name="to" value={range.to} />
                    <Pending className="b b-ghost" name="intent" value="remove">
                      Remove
                    </Pending>
                  </form>
                </Item>
              ))}
            </List>}
            <form action={changeSpecialHours} className="set-fields set-four">{where}
              {[
                ["from", "From", "date"],
                ["to", "To", "date"],
                ["open", "Opens", "time"],
                ["close", "Closes", "time"],
              ].map(([name, label, type]) => (
                <div key={name}>
                  <label htmlFor={`special-${name}`}>{label}</label>
                  <input id={`special-${name}`} name={name} type={type} required />
                </div>
              ))}
              {problem("special")}
              <div className="set-foot"><Pending className="b b-primary" type="submit" busy="Adding">Add special hours</Pending></div>
            </form>
          </Card>

          <Card id="holidays" title={picked ? `Holidays for ${picked.name}` : "Holidays"} line="Days your office is closed.">
            {!!holidays.length && <List className="set-rows" rise={false}>
              {holidays.map((date) => (
                <Item key={date}>
                  <span className="grow">
                    {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long" })}, {longDate(date)}
                  </span>
                  <form action={changeHoliday}>{where}
                    <input type="hidden" name="date" value={date} />
                    <Pending className="b b-ghost" name="intent" value="remove">
                      Remove
                    </Pending>
                  </form>
                </Item>
              ))}
            </List>}
            <form action={changeHoliday} className="set-fields">{where}
              <div>
                <label htmlFor="holiday">Add a holiday</label>
                <input id="holiday" type="date" name="date" required />
              </div>
              <div className="set-foot"><Pending className="b b-primary" type="submit" busy="Adding">Add holiday</Pending></div>
            </form>
          </Card>
          </>}

          {group === "people" && <>
          <Card id="permissions" title="Permissions" line="Everyone can view every client's papers. The ticks below are what staff and managers may do without asking. For anything not ticked, they ask their manager or you for permission.">
            <form action={savePermissions} className="set-stack">
              <div className="set-table">
                <table className="t">
                  <thead>
                    <tr>
                      <th scope="col">Without asking</th>
                      <th scope="col" className="shrink">Staff</th>
                      <th scope="col" className="shrink">Managers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(switchable).map(([right, label]) => (
                      <tr key={right}>
                        <td>{label}</td>
                        {(["employee", "manager"] as const).map((column) => (
                          <td key={column} className="shrink">
                            <input type="checkbox" name={`${column}:${right}`} disabled={right==="approve_requests" && column==="employee"} defaultChecked={permissions[column]?.[right as keyof typeof switchable] ?? (right in defaults || right==="approve_requests" && column==="manager")} aria-label={`${label}: ${column === "employee" ? "staff" : "managers"}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">Partners may do the same as managers. Only you can remove papers.</p>
              <details className="reveal"><summary>Limit these to some clients or a last day</summary><p className="hint">Leave blank for every client with no end date. View only access stays the same.</p><div className="set-fields">{(["employee","manager"] as const).map(column=><fieldset key={column} className="set-stack"><legend>{column==="employee" ? "Staff" : "Managers"}</legend><div><label htmlFor={`${column}-clients`}>Client names, one per line</label><textarea id={`${column}-clients`} name={`${column}:clients`} rows={3} defaultValue={namesOf(permissions[column]?.scope?.clients)}/></div><div><label htmlFor={`${column}-until`}>Last day, if needed</label><input id={`${column}-until`} type="date" name={`${column}:until`} defaultValue={permissions[column]?.scope?.until}/></div></fieldset>)}</div></details>
              <label className="check">
                <input className="toggle" type="checkbox" name="hide_inactive" defaultChecked={settings.viewer_hide_inactive === true} />
                Hide papers when someone switches to another window. Leave this off if staff read a paper while typing into the tax portal beside it.
              </label>
              <label className="check"><input className="toggle" type="checkbox" name="second_form_approval" defaultChecked={settings.second_form_approval===true}/>Second approval before filing. Another person must approve after the figures are checked.</label>
              <div className="set-days"><label htmlFor="pin-days">Days before the due date to fill each GST return, and show it in red if it still needs papers or checks</label><input id="pin-days" name="pin_days" type="number" min="1" max="30" step="1" className="num" defaultValue={Number(settings.pin_days) || 5} /></div>
              {problem("permissions")}
              <div className="set-foot">
                <Pending busy="Saving" className="b b-primary" name="intent" value="save">
                  Save permissions
                </Pending>
                <Link className="b b-ghost" href="/app/settings?group=people&confirm=reset#permissions" scroll={false}>
                  Reset to defaults
                </Link>
              </div>
            </form>
            {confirm === "reset" && (
              <form action={savePermissions} className="set-foot">
                <p className="hint grow">Reset every permission to the defaults? This also clears the client and last day limits, Hide papers and the second approval, and sets the GST fill days back to 5.</p>
                <Pending className="b b-danger" name="intent" value="reset" busy="Resetting">Yes, reset</Pending>
                <Link className="b b-secondary" href="/app/settings?group=people#permissions" scroll={false}>Cancel</Link>
              </form>
            )}
          </Card>

          {(!!others.length || !!always.length) && <Card id="always" title="Extra permission for one person" line="Let one person do one thing without asking, for some clients or until a date, on top of their role.">
            {!!others.length && <form action={allowStanding} className="set-fields"><div><label htmlFor="standing-person">Person</label><select id="standing-person" name="person" required>{others.map(person=><option key={person.user_id} value={person.user_id}>{person.email}</option>)}</select></div><div><label htmlFor="standing-right">What they may do</label><select id="standing-right" name="right">{Object.entries(switchable).map(([right,label])=><option key={right} value={right}>{label}</option>)}</select></div><div><label htmlFor="standing-clients">Client names, one per line. Blank means every client.</label><textarea id="standing-clients" name="clients" rows={3}/></div><div><label htmlFor="standing-until">Last day, if needed</label><input id="standing-until" name="until" type="date"/></div><div className="set-foot"><Pending busy="Saving" className="b b-primary">Allow this person</Pending></div></form>}
            {!!always.length && (
              <>
                <h3 className="set-sub">Always allowed</h3>
                <List className="set-rows" rise={false}>
                  {always.map((person) => (
                    <Item key={person.id}>
                      <span className="grow">
                        <strong>{person.email}</strong> may {person.rights.map(grant=>`${switchable[grant.right as keyof typeof switchable].toLowerCase()}${"clients" in grant && grant.clients ? ` for ${namesOf(grant.clients).replaceAll("\n",", ")}` : " for every client"}${"until" in grant && grant.until ? ` until ${longDate(grant.until)}` : ""}`).join("; ")} without asking
                      </span>
                      <form action={withdrawAlways}>
                        <input type="hidden" name="person" value={person.id} />
                        <Pending className="b b-ghost">Withdraw</Pending>
                      </form>
                    </Item>
                  ))}
                </List>
              </>
            )}
          </Card>}

          {owner && <Card id="visibility" title="Who sees which clients" line="Choose whether everyone sees every client, or only the people assigned to it.">
            <form action={saveVisibility} className="set-stack">
              <fieldset className="set-options">
                <legend className="sr-only">Who sees clients</legend>
                {[
                  ["open", "Everyone in the firm sees every client"],
                  ["restricted", "Only you, partners and the people assigned to a client see it"],
                ].map(([value, label]) => (
                  <label key={value} className="check">
                    <input type="radio" name="visibility" value={value} defaultChecked={(settings.client_visibility ?? "open") === value} />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="set-foot"><Pending busy="Saving" className="b b-primary" type="submit">Save who sees clients</Pending></div>
            </form>
          </Card>}
          </>}

          {group === "reminders" && <>
          <Card id="reminders" title="Reminders" line="InboxCA emails each client at most once a day, from your firm email, at the stages you choose. It reminds only for due dates it has checked against the government notification.">
            <form action={saveReminders} className="set-stack">
              <label className="check">
                <input className="toggle" type="checkbox" name="on" defaultChecked={settings.reminders === true} />
                Email clients before their returns are due
              </label>
              <fieldset>
                <legend>When to remind</legend>
                <div className="set-grid">{STAGES.map((day) => <label className="check" key={day}><input type="checkbox" name="stage" value={day} defaultChecked={reminderStages(settings).includes(day)} />{stageNames[day]}</label>)}</div>
              </fieldset>
              <fieldset>
                <legend>Ask for papers before the due date</legend>
                <p className="hint">InboxCA emails the client a list of the papers each return needs, with a private link to upload them. It leaves out papers you already have. If nothing comes back, it emails again every 3 days. After two of these, the person who looks after the client is asked to call.</p>
                <div className="set-fields">{Object.entries({ monthly: "Monthly returns", quarterly: "Quarterly returns", yearly: "Yearly returns" }).map(([often, label]) => (
                  <div key={often}>
                    <label htmlFor={`ask-${often}`}>{label}</label>
                    <select id={`ask-${often}`} name={`ask_${often}`} defaultValue={askDays(settings)[often]}>
                      {askChoices.map((days) => <option key={days} value={days}>{days ? `${days} days before` : "Off"}</option>)}
                    </select>
                  </div>
                ))}</div>
              </fieldset>
              <p className="hint">A reminder is skipped when the return is filed, the client already sent papers for it, or your team is replying to them.</p>
              <div className="set-foot"><Pending busy="Saving" className="b b-primary" type="submit">Save reminders</Pending></div>
            </form>
          </Card>

          <Card id="answers" title="Replies by InboxCA" line="InboxCA answers these emails from your records only, in English, to the client's own address or a contact allowed to receive papers. Questions about advice, fees or what a notice means always wait for your team.">
            <form action={saveAnswers} className="set-stack">
              <ul className="set-rows set-answers">{(Object.entries(answerKinds) as [AnswerKind, readonly [string, string]][]).map(([kind, [label, hint]]) => (
                <li key={kind}>
                  <span className="grow">
                    <label htmlFor={`answer-${kind}`}>{label}</label>
                    <span className="hint" id={`answer-${kind}-hint`}>{hint}</span>
                  </span>
                  <select id={`answer-${kind}`} name={kind} defaultValue={answerMode(settings, kind)} aria-describedby={`answer-${kind}-hint`}>
                    {Object.entries(answerModes).map(([mode, name]) => <option key={mode} value={mode}>{name}</option>)}
                  </select>
                </li>
              ))}</ul>
              <p className="hint">Auto sends {UNDO_MINUTES} minutes after the email arrives. Until then, Undo in the Inbox stops it. Ask me first keeps the reply in the Inbox for you to send or change. Off sends nothing, and a question waits in Needs reply.</p>
              <div className="set-foot"><Pending busy="Saving" className="b b-primary" type="submit">Save replies</Pending></div>
            </form>
          </Card>

          <Card id="records" title="Papers sent on request" line="When a client, or a contact with Receives papers ticked, asks for a paper by email, InboxCA finds it and replies with a secure link. Ticked paper types go at once. The others wait until someone approves them in the Inbox.">
            <form action={saveRecords} className="set-stack">
              <fieldset>
                <legend>Send at once</legend>
                <div className="set-grid">{documentTypes.map((type) => (
                  <label key={type} className="check">
                    <input type="checkbox" name="routine" value={type} defaultChecked={isRoutine(type, { routine: records.routine })} />
                    {paperType(type)}
                  </label>
                ))}</div>
              </fieldset>
              <label className="check">
                <input className="toggle" type="checkbox" name="approve_all" defaultChecked={records.approve_all === true} />
                Wait for approval for every paper
              </label>
              <div className="set-foot"><Pending busy="Saving" className="b b-primary" type="submit">Save paper sending rules</Pending></div>
            </form>
          </Card>
          </>}

          {group === "data" && <>
          <Card id="use" title="InboxCA use" line="How much your firm uses InboxCA, which will later decide your plan. Your papers stay in your own drive. InboxCA stores your client list, returns, notices, the activity log and what it reads from papers.">
            {usage && (
              <Suspense fallback={<div className="set-meters" aria-busy="true"><span className="skel" /><span className="skel" /></div>}>
                <Meters usage={usage} />
              </Suspense>
            )}
            <p className="hint set-after">Shown for your information. Plans and their limits come later; nothing is limited or charged by these figures yet.</p>
          </Card>
          <Card id="data" title="Your data" line="Your client list, returns and notices, the list of papers and the activity log, as spreadsheet files in one ZIP. The papers themselves are already in your firm's drive.">
            <div className="set-foot">{download}</div>
          </Card>
          <Card id="support" title="Orelu support" line="Orelu is the company that makes InboxCA. Orelu cannot see your clients or papers. To fix a problem, Orelu support may ask here to see your people and client names for one hour.">
            <Support supabase={supabase} firmId={membership.firmId} />
          </Card>
          <Card id="close" title="Close the firm" danger line="Everyone is signed out, your team can no longer sign in, and the firm email and drive are disconnected. For 30 days you can still sign in and download your data. Then InboxCA deletes your firm's data; the activity log is kept one more year, as Indian rules require. Papers in your drive are not touched.">
            <details className="reveal" open={error === "close_name"}>
              <summary>Close the firm</summary>
              <form action={closeFirm} className="set-fields">
                <div><label htmlFor="close-name">Type {membership.firmName} to confirm</label><input id="close-name" name="name" required autoComplete="off" /></div>
                {problem("close")}
                <div className="set-foot"><Pending className="b b-danger" type="submit" busy="Closing">Close the firm for good</Pending></div>
              </form>
            </details>
          </Card>
          </>}

          {group === "billing" && <BillingCards supabase={supabase} firmId={membership.firmId} ask={{ ...plan, error }} Card={Card} />}
        </div>
      </div>
      {saved && savedNames[saved] && <Toast>{savedNames[saved]}</Toast>}
    </div>
  );
}

const supportWords: Record<string, string> = {
  "support.asked": "Orelu support asked for a look",
  "support.approved": "You allowed an hour",
  "support.refused": "You refused",
  "support.viewed": "Orelu support looked at your people and client names",
  "support.ended": "You ended it",
};
const at = (when: string) => new Date(when).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

// Orelu's support access to this firm (PLAN.md 8.5): what is asked or allowed now, one answer,
// and the last few steps from the activity log.
async function Support({ supabase, firmId }: { supabase: Awaited<ReturnType<typeof currentMember>>["supabase"]; firmId: string }) {
  const [{ data: request }, { data: steps }] = await Promise.all([
    supabase.from("requests").select("status, expires_at").eq("firm_id", firmId).eq("kind", "support_access").eq("entity_id", firmId).maybeSingle(),
    supabase.from("activity_log").select("action, at").eq("firm_id", firmId).like("action", "support.%").order("at", { ascending: false }).limit(5),
  ]);
  const open = request?.status === "approved" && !!request.expires_at && new Date(request.expires_at) > new Date();
  const answer = (decision: string, label: string, kind = "b-secondary") => <Pending className={`b ${kind}`} name="decision" value={decision}>{label}</Pending>;
  return (
    <>
      {request?.status === "pending" && (
        <form action={answerSupport} className="set-foot">
          <p className="hint grow">Orelu support asks for an hour&apos;s look at your people and client names.</p>
          {answer("refuse", "Refuse", "b-ghost")}
          {answer("approve", "Allow for 1 hour", "b-primary")}
        </form>
      )}
      {open && (
        <form action={answerSupport} className="set-foot">
          <p className="hint grow">Orelu support can look until {at(request.expires_at!)}.</p>
          {answer("end", "End now")}
        </form>
      )}
      {!!steps?.length && (
        <ul className="set-support">
          {steps.map((step) => <li key={`${step.action}${step.at}`} className="hint"><span className="num">{at(step.at)}</span> {supportWords[step.action] ?? "Orelu support access changed"}</li>)}
        </ul>
      )}
    </>
  );
}

// The usage meters, once firm_usage answers.
async function Meters({ usage: asked }: { usage: Promise<{ returns_so_far: number; returns_this_year: number; workspace_bytes: number; workspace_by_march: number } | undefined> }) {
  const usage = await asked;
  if (!usage) return null;
  return (
    <dl className="set-meters">
      <div>
        <dt>Returns this year</dt>
        <dd>{usage.returns_so_far.toLocaleString("en-IN")} due so far</dd>
        <dd className="set-bar"><span style={{ width: `${Math.round((100 * usage.returns_so_far) / Math.max(usage.returns_this_year, 1))}%` }} /></dd>
        <dd className="set-meter-note">About {usage.returns_this_year.toLocaleString("en-IN")} by March, from your calendar</dd>
      </div>
      <div>
        <dt>InboxCA storage used</dt>
        <dd>{storage(usage.workspace_bytes)}</dd>
        <dd className="set-bar"><span style={{ width: `${Math.round((100 * usage.workspace_bytes) / Math.max(usage.workspace_by_march, 1))}%` }} /></dd>
        <dd className="set-meter-note">At this pace about {storage(usage.workspace_by_march)} by March</dd>
      </div>
    </dl>
  );
}
