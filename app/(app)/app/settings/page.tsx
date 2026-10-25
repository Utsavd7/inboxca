import { HardDrive, Mail } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { changeHoliday, changeSpecialHours, choosePreset, closeFirm, connectDrive, disconnectDrive, disconnectMailbox, saveHours, saveLimits, savePermissions, saveRecords, saveReminders, saveMailLimit, saveVisibility, setFolderOrder, withdrawAlways, allowStanding } from "@/app/(app)/actions";
import { firmAdmin, officeApprover, type Office } from "@/src/lib/office";
import { presetOf, presets } from "@/src/lib/presets";
import { OfficePanel } from "../office-panel";
import { documentTypes } from "@/src/lib/documents";
import { switchable, defaults, type Permissions, type Standing } from "@/src/lib/rights";
import { isRoutine, type RecordsSettings } from "@/src/lib/records";
import { folderOrderNames, namings } from "@/src/lib/drive";
import { supabaseAdmin } from "@/src/lib/supabase";
import { serverCrypto } from "@/src/lib/crypto";
import { DAYS, longDate, SUGGESTED_HOURS, type Hours, type SpecialHours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { IDLE_CHOICES, SESSION_CHOICES } from "@/src/lib/session";
import { Badge, NotForYou, PageHead, storage, Toast } from "../ui";
import { Pending } from "../pending";
import { STAGES, stageNames, reminderStages } from "@/src/lib/reminders";
import { MailboxForm } from "./mailbox-form";
import { GroupAnchor } from "./group-anchor";
import "./settings.css";

const driveNames: Record<string, string> = { onedrive: "OneDrive", dropbox: "Dropbox", local: "Test drive on this computer" };
// Each problem a save can report, shown in the section it belongs to.
const problems: Record<string, [string, string]> = {
  permission_scope: ["permissions", "Check the end date and client names. Use the full names shown in Clients, one per line, with no repeated names."],
  mail_limit: ["mailbox", "Choose a whole number from 1 to 2,000 for the email limit."],
  drive_terms: ["drive", "Tick the box to agree to the Drive access terms first."],
  drive_provider: ["drive", "Choose a drive."],
  drive_taken: ["drive", "A drive is already connected. Disconnect it first."],
  drive_denied: ["drive", "The drive was not allowed, so nothing was connected."],
  drive_failed: ["drive", "The drive did not finish connecting. Try again."],
  close_name: ["close", "Type the firm name exactly as it is shown."],
  special: ["special", "The dates must run forward and the closing time must be after the opening time."],
  ...Object.fromEntries(DAYS.map((day) => [day, ["hours", `${day}: the closing time must be after the opening time.`]])),
};
const savedNames: Record<string, string> = { preset: "Preset saved.", visibility: "Who sees clients saved.", hours: "Office hours saved.", limits: "Signing in limits saved.", reminders: "Reminders saved.", records: "Papers saved.", permissions: "Permissions saved.", mail_limit: "Email limit saved." };
// The page shows one group at a time, chosen by ?group=. Each section keeps its old anchor.
const groups = [
  ["email", "Email and drive", ["mailbox", "drive"]],
  ["access", "Office and sign in", ["preset", "office", "limits", "recovery"]],
  ["hours", "Hours and holidays", ["hours", "special", "holidays"]],
  ["people", "People's access", ["permissions", "always", "visibility"]],
  ["reminders", "Reminders and papers", ["reminders", "records"]],
  ["data", "Your data", ["use", "data", "close"]],
] as const;
const ownerOnly = ["mailbox", "drive", "recovery", "visibility", "reminders", "records", "use", "data", "close"];
const download = <form action="/app/settings/download" method="post"><button className="b b-secondary" type="submit">Download your data</button></form>;

function Card({ id, title, line, danger, children }: { id: string; title: string; line?: React.ReactNode; danger?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className={`panel set-card${danger ? " set-danger" : ""}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {line && <p className="hint">{line}</p>}
      {children}
    </section>
  );
}

// The owner's settings: the firm's email, who sees clients, office hours, holidays and
// signing in limits (PLAN.md 5.13, 5.17).
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; group?: string }>;
}) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  if (!officeApprover(membership.role, userId, membership.settings)) return <NotForYou title="Settings" who="the owner" />;
  if (!firmAdmin(membership.role, userId, membership.settings)) return <><PageHead title="Office approvals" sub="Confirm your office connection and approve PCs for your firm." /><OfficePanel /></>;
  const owner = membership.role === "owner";
  // A closed firm keeps only its download until InboxCA deletes it, 30 days on.
  const { data: closed } = await supabase.from("activity_log").select("at").eq("entity_id", membership.firmId).eq("firm_id", membership.firmId).eq("action", "firm.closed").maybeSingle();
  if (closed) return (
    <div className="set-page">
      <PageHead title="Settings" sub="Only you, the owner, see this page." />
      <div className="set-body">
        <Card id="data" title="Your firm is closing" line={<>InboxCA deletes your firm&apos;s data on {longDate(new Date(Date.parse(closed.at) + 30 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }))}. Download your data before then. The activity log is kept one more year, as Indian rules require, then deleted. Files in your firm&apos;s drive stay where they are.</>}>
          <div className="set-foot">{download}</div>
        </Card>
      </div>
    </div>
  );
  const { data: accounts } = await supabase.from("connected_accounts").select("id, kind, provider, address_enc, status");
  const mailbox = accounts?.find((account) => account.kind === "mail");
  const drive = accounts?.find((account) => account.kind === "drive");
  // Only the server reads a drive's settings; this page is the owner's.
  const { data: driveSettings } = drive ? await supabaseAdmin().from("connected_accounts").select("settings").eq("id", drive.id).single() : { data: null };
  const {data:mailServers}=mailbox?.status==="needs_reconnect" ? await supabaseAdmin().from("connected_accounts").select("settings").eq("firm_id",membership.firmId).eq("id",mailbox.id).single() : {data:null};
  const folderOrder = (driveSettings?.settings as { folder_order?: string } | undefined)?.folder_order ?? "year_client_work";
  const naming = (driveSettings?.settings as { naming?: string } | undefined)?.naming ?? "client_type_period";
  const driveAddress = drive && (await serverCrypto().decrypt(membership.firmId, `accounts/${drive.id}/address`, drive.address_enc));
  const ready: Record<string, boolean> = { onedrive: false, dropbox: !!process.env.DROPBOX_APP_KEY, local: true };
  const mailAddress = mailbox && (await serverCrypto().decrypt(membership.firmId, `accounts/${mailbox.id}/address`, mailbox.address_enc));
  const { saved, error, group: asked } = await searchParams;
  const settings = membership.settings;
  const hours = (settings.hours as Hours | undefined) ?? SUGGESTED_HOURS;
  const holidays = (settings.holidays as string[] | undefined) ?? [];
  const special = (settings.special_hours as SpecialHours[] | undefined) ?? [];
  const access = (settings.access ?? {}) as { hours_only?: boolean; idle_minutes?: number; session_hours?: number };
  const hoursOnly = access.hours_only ?? false;
  const records = (settings.records ?? {}) as RecordsSettings;
  const permissions = (settings.permissions ?? {}) as Permissions;
  // The usage meters are only on Your data; at 10,000 clients they cost about 100 ms.
  const onData = asked === "data" || ["use", "data", "close"].includes(problems[error ?? ""]?.[0] ?? "");
  const [{ data: used }, { data: people }] = await Promise.all([
    onData ? supabase.rpc("firm_usage", { target_firm: membership.firmId }) : Promise.resolve({ data: null }),
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
  ]);
  // People the owner or a deputy always allowed something, from a question in the Inbox.
  const { data: standing } = await supabaseAdmin().from("firm_members").select("user_id, access").eq("firm_id", membership.firmId).not("access->always", "is", null);
  const always = (standing ?? []).flatMap((member) => {
    const rights = ((member.access as { always?: Standing[] }).always ?? []).map(grant=>typeof grant==="string" ? {right:grant} : grant).filter(grant=>Object.hasOwn(switchable,grant.right));
    return rights.length ? [{ id: member.user_id, email: people?.find((person) => person.user_id === member.user_id)?.email ?? "", rights }] : [];
  });
  const scopeIds=[...new Set([...Object.values(permissions).flatMap(column=>column?.scope?.clients ?? []),...always.flatMap(person=>person.rights.flatMap(grant=>"clients" in grant ? grant.clients ?? [] : []))])];
  const {data:scopeClients}=scopeIds.length ? await supabase.from("clients").select("id,name").eq("firm_id",membership.firmId).in("id",scopeIds) : {data:[]};
  const namesOf=(ids?:string[])=>ids?.map(id=>scopeClients?.find(client=>client.id===id)?.name ?? "Client no longer available").join("\n") ?? "";
  const usage = used?.[0];
  const preset = presetOf(settings);
  const others = people?.filter((person) => person.role !== "owner" && person.status === "active") ?? [];
  // The co-admin sees only the groups about keeping client data safe.
  const shown = groups.map(([id, name, sections]) => [id, name, sections.filter((section) => owner || !ownerOnly.includes(section))] as const).filter(([, , sections]) => sections.length);
  const groupOf = Object.fromEntries(shown.flatMap(([id, , sections]) => sections.map((section) => [section, id])));
  const group = shown.find(([id]) => id === asked)?.[0] ?? groupOf[problems[error ?? ""]?.[0]] ?? shown[0][0];
  const problem = (section: string) => error && problems[error]?.[0] === section && <p className="alert" role="alert">{problems[error][1]}</p>;
  return (
    <div className="set-page">
      <PageHead title="Settings" sub={owner ? "How your firm uses InboxCA. Only you, the owner, see this page." : "How your firm keeps client data safe. As co-admin you change these with the owner."} />
      <GroupAnchor groupOf={groupOf} />
      <div className="set">
        <nav className="set-nav" aria-label="Settings">
          {shown.map(([id, name]) => (
            <Link key={id} href={`/app/settings?group=${id}`} aria-current={group === id ? "page" : undefined}>
              {name}
            </Link>
          ))}
        </nav>
        <div key={group} className="set-body page-in">
          {group === "email" && <>
          <Card id="mailbox" title="Firm email" line="The address your clients write to. InboxCA reads only your clients' mail, keeps no copy of it, and replies from this address.">
            {mailbox ? (
              <form action={disconnectMailbox} className="connection">
                <Mail size={16} aria-hidden />
                <p className="grow" role="status">
                  <Badge tone={mailbox.status === "connected" ? "done" : "late"}>{mailbox.status === "connected" ? "Connected" : "Needs to be connected again"}</Badge>
                  <span className="sr-only">: </span>
                  <strong>{mailAddress}</strong>
                </p>
                <button className="b b-secondary" type="submit">
                  Disconnect
                </button>
              </form>
            ) : (
              <MailboxForm />
            )}
            {mailbox?.status==="needs_reconnect" && <>
              <p className="alert" role="alert">Connect your firm&apos;s email again. Replies will wait until it is connected.</p>
              <MailboxForm reconnecting initial={{address:mailAddress ?? "",...Object.fromEntries(Object.entries((mailServers?.settings ?? {}) as Record<string,unknown>).filter(([key])=>["imap","smtp"].includes(key)).flatMap(([key,value])=>Object.entries(value as Record<string,string|number>).map(([part,value])=>[`${key}_${part}`,String(value)])))}} />
            </>}
            {mailbox && <form action={saveMailLimit} className="set-fields">
              <div><label htmlFor="mail-limit">Emails in 24 hours</label><input id="mail-limit" name="limit" type="number" min="1" max="2000" step="1" className="num" defaultValue={Number(settings.mail_limit) || 500} /></div>
              <p className="hint set-wide">Every reply and bulk send shares this limit. Lower it if your email provider allows fewer.</p>
              {problem("mailbox")}
              <div className="set-foot"><Pending className={`b ${mailbox.status === "connected" ? "b-primary" : "b-secondary"}`}>Save email limit</Pending></div>
            </form>}
          </Card>

          <Card id="drive" title="Firm drive" line="Client files are saved in your firm's own drive, in folders by year, client and work. InboxCA keeps no client files.">
            {drive && (
              <form action={disconnectDrive} className="connection">
                <HardDrive size={16} aria-hidden />
                <p className="grow" role="status">
                  <Badge tone="done">Connected</Badge>
                  <span className="sr-only">: </span>
                  <strong>{driveAddress}</strong>
                </p>
                <button className="b b-secondary" type="submit">
                  Disconnect
                </button>
              </form>
            )}
            {drive && (
              <form action={setFolderOrder} className="set-fields">
                <p className="hint set-wide">
                  Past files already in your drive? <Link href="/app/import">Add old files</Link>, sorted into their client folders in place.
                </p>
                <div>
                  <label htmlFor="folder-order">How new files are arranged</label>
                  <select id="folder-order" name="order" defaultValue={folderOrder}>
                    {Object.entries(folderOrderNames).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="naming">How new files are named</label>
                  <select id="naming" name="naming" defaultValue={naming}>
                    {Object.entries(namings).map(([value, example]) => (
                      <option key={value} value={value}>
                        {example}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="set-foot"><Pending className="b b-primary" type="submit">Save</Pending></div>
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
                <p className="hint">InboxCA can read this whole drive and touches only the folders you choose and its own InboxCA folder, so connect a drive kept for your firm.</p>
                <div>
                  <h3 className="set-sub">What you are allowing InboxCA to do</h3>
                  <ul className="points">
                    <li>Read the files in the folders you choose, and every file it saves.</li>
                    <li>Make folders, and rename and move folders and files to keep them in order.</li>
                    <li>Save files from client emails, and the forms it fills.</li>
                    <li>Read figures from your files to fill GST and income tax forms for your team to check.</li>
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
          <Card id="preset" title="Access preset" line="One choice sets Office only, office hours and signing out. You can change each of them after.">
            <form id="preset-form" action={choosePreset} className="set-stack">
              <fieldset className="set-choices">
                <legend className="sr-only">Preset</legend>
                {Object.entries(presets).map(([key, { name, line }]) => (
                  <label key={key}>
                    <input type="radio" name="preset" value={key} required defaultChecked={preset === key} aria-label={`${name}: ${line}`} />
                    <span><strong>{name}</strong> <span className="hint">{line}</span></span>
                  </label>
                ))}
              </fieldset>
              {!(settings.office as Office | undefined)?.on && <fieldset className="set-options"><legend>If you choose an office preset: are you in the office now?</legend>
                <label className="check"><input type="radio" name="here" value="yes" defaultChecked />Yes, I am in the office now</label>
                <label className="check"><input type="radio" name="here" value="no" />No, I will confirm it there later</label>
              </fieldset>}
              <div className="set-foot">
                <Pending className="b b-primary" type="submit">Use this preset</Pending>
                {!preset && <p className="hint">Your rules no longer match a preset.</p>}
              </div>
            </form>
            <OfficePanel error={error === "deputies"} inPreset />
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
              <div className="set-foot"><Pending className="b b-primary" type="submit">Save signing in limits</Pending></div>
            </form>
          </Card>
          {owner && <Card id="recovery" title="Recovery codes" line="If you lose the phone with your 2 step code, one of these codes lets you set it up again after the email code. Each code works once, and new codes stop the old ones. Keep them away from your phone.">
            <form action="/app/settings/recovery-codes" method="post" className="set-foot"><button className="b b-secondary" type="submit">Download 10 new codes</button></form>
          </Card>}
          </>}

          {group === "hours" && <>
          <Card id="hours" title="Office hours" line="India time. You can always sign in; these hours apply to everyone else.">
            <form action={saveHours} className="set-stack">
              <table className="set-hours">
                <tbody>
                  {DAYS.map((name, day) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>
                        <label className="check">
                          <input type="checkbox" name={`open-${day}`} defaultChecked={!!hours[day]} /> Open
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
              <label className="check">
                <input type="checkbox" name="hours_only" defaultChecked={hoursOnly} />
                Everyone except you can use InboxCA only during office hours, and not on holidays
              </label>
              {problem("hours")}
              <div className="set-foot"><Pending className="b b-primary" type="submit">Save office hours</Pending></div>
            </form>
          </Card>

          <Card id="special" title="Special hours" line="A tax season or a late evening: these times replace the office hours on every day in the dates. Holidays stay closed.">
            {!!special.length && <ul className="set-rows">
              {special.map((range) => (
                <li key={range.from + range.to}>
                  <span className="grow">
                    {range.from === range.to ? longDate(range.from) : `${longDate(range.from)} to ${longDate(range.to)}`}: {range.open} to {range.close}
                  </span>
                  <form action={changeSpecialHours}>
                    <input type="hidden" name="from" value={range.from} />
                    <input type="hidden" name="to" value={range.to} />
                    <button className="b b-ghost" name="intent" value="remove">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>}
            <form action={changeSpecialHours} className="set-fields set-four">
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

          <Card id="holidays" title="Holidays" line="Days your office is closed.">
            {!!holidays.length && <ul className="set-rows">
              {holidays.map((date) => (
                <li key={date}>
                  <span className="grow">
                    {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long" })}, {longDate(date)}
                  </span>
                  <form action={changeHoliday}>
                    <input type="hidden" name="date" value={date} />
                    <button className="b b-ghost" name="intent" value="remove">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>}
            <form action={changeHoliday} className="set-fields">
              <div>
                <label htmlFor="holiday">Add a holiday</label>
                <input id="holiday" type="date" name="date" required />
              </div>
              <div className="set-foot"><Pending className="b b-primary" type="submit" busy="Adding">Add holiday</Pending></div>
            </form>
          </Card>
          </>}

          {group === "people" && <>
          <Card id="permissions" title="Permissions" line="Everyone sees every client's files, view only, and does the filing work: correcting a file's type or period, adding portal files, marking returns filed. Anything more is a question to their manager or to you, unless you switch it on here.">
            <form action={savePermissions} className="set-stack">
              <div className="set-table">
                <table className="t">
                  <thead>
                    <tr>
                      <th scope="col">Without asking</th>
                      <th scope="col" className="shrink">Employees</th>
                      <th scope="col" className="shrink">Managers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(switchable).map(([right, label]) => (
                      <tr key={right}>
                        <td>{label}</td>
                        {(["employee", "manager"] as const).map((column) => (
                          <td key={column} className="shrink">
                            <input type="checkbox" name={`${column}:${right}`} disabled={right==="approve_requests" && column==="employee"} defaultChecked={permissions[column]?.[right as keyof typeof switchable] ?? (right in defaults || right==="approve_requests" && column==="manager")} aria-label={`${label}: ${column === "employee" ? "employees" : "managers"}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">Partners follow managers. Removing files stays yours.</p>
              <details className="reveal"><summary>Limit these role permissions</summary><p className="hint">Leave blank for every client with no end date. View only access stays the same.</p><div className="set-fields">{(["employee","manager"] as const).map(column=><fieldset key={column} className="set-stack"><legend>{column==="employee" ? "Employees" : "Managers"}</legend><div><label htmlFor={`${column}-clients`}>Client names, one per line</label><textarea id={`${column}-clients`} name={`${column}:clients`} rows={3} defaultValue={namesOf(permissions[column]?.scope?.clients)}/></div><div><label htmlFor={`${column}-until`}>Last day, if needed</label><input id={`${column}-until`} type="date" name={`${column}:until`} defaultValue={permissions[column]?.scope?.until}/></div></fieldset>)}</div></details>
              <label className="check">
                <input type="checkbox" name="hide_inactive" defaultChecked={settings.viewer_hide_inactive === true} />
                Hide documents when InboxCA is not the active window (staff often read a document while typing in the portal beside it, so this is off unless you need it)
              </label>
              <label className="check"><input type="checkbox" name="second_form_approval" defaultChecked={settings.second_form_approval===true}/>Second approval before filing. Another person must approve after the figures are checked.</label>
              {problem("permissions")}
              <div className="set-foot">
                <Pending className="b b-primary" name="intent" value="save">
                  Save permissions
                </Pending>
                <Pending className="b b-ghost" name="intent" value="reset" busy="Resetting">
                  Reset to defaults
                </Pending>
              </div>
            </form>
          </Card>

          {(!!others.length || !!always.length) && <Card id="always" title="Allow one person without asking" line="Let one person do one thing without asking, for some clients or until a date, on top of their role.">
            {!!others.length && <form action={allowStanding} className="set-fields"><div><label htmlFor="standing-person">Person</label><select id="standing-person" name="person" required>{others.map(person=><option key={person.user_id} value={person.user_id}>{person.email}</option>)}</select></div><div><label htmlFor="standing-right">What they may do</label><select id="standing-right" name="right">{Object.entries(switchable).map(([right,label])=><option key={right} value={right}>{label}</option>)}</select></div><div><label htmlFor="standing-clients">Client names, one per line. Blank means every client.</label><textarea id="standing-clients" name="clients" rows={3}/></div><div><label htmlFor="standing-until">Last day, if needed</label><input id="standing-until" name="until" type="date"/></div><div className="set-foot"><Pending className="b b-primary">Allow this person</Pending></div></form>}
            {!!always.length && (
              <>
                <h3 className="set-sub">Always allowed</h3>
                <ul className="set-rows">
                  {always.map((person) => (
                    <li key={person.id}>
                      <span className="grow">
                        <strong>{person.email}</strong> may {person.rights.map(grant=>`${switchable[grant.right as keyof typeof switchable].toLowerCase()}${"clients" in grant && grant.clients ? ` for ${namesOf(grant.clients).replaceAll("\n",", ")}` : " for every client"}${"until" in grant && grant.until ? ` until ${longDate(grant.until)}` : ""}`).join("; ")} without asking
                      </span>
                      <form action={withdrawAlways}>
                        <input type="hidden" name="person" value={person.id} />
                        <button className="b b-ghost">Withdraw</button>
                      </form>
                    </li>
                  ))}
                </ul>
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
              <div className="set-foot"><Pending className="b b-primary" type="submit">Save who sees clients</Pending></div>
            </form>
          </Card>}
          </>}

          {group === "reminders" && <>
          <Card id="reminders" title="Reminders" line="InboxCA emails each client once a day at most, from your firm's address, at the stages you choose. Only dates a CA has confirmed are reminded.">
            <form action={saveReminders} className="set-stack">
              <label className="check">
                <input type="checkbox" name="on" defaultChecked={settings.reminders === true} />
                Email clients before their returns are due
              </label>
              <fieldset>
                <legend>When to remind</legend>
                <div className="set-grid">{STAGES.map((day) => <label className="check" key={day}><input type="checkbox" name="stage" value={day} defaultChecked={reminderStages(settings).includes(day)} />{stageNames[day]}</label>)}</div>
              </fieldset>
              <label className="check">
                <input type="checkbox" name="acknowledge" defaultChecked={settings.acknowledge === true} />
                Reply to clients when their files arrive, saying what was received
              </label>
              <p className="hint">A reminder is skipped when the return is filed, the client already sent files for it, or your team is replying to them.</p>
              <div className="set-foot"><Pending className="b b-primary" type="submit">Save reminders</Pending></div>
            </form>
          </Card>

          <Card id="records" title="Papers sent on request" line="When a client or an allowed contact asks for a paper by email, InboxCA finds it and replies with a secure link. Ticked papers go at once; the rest wait for one approval in the Inbox.">
            <form action={saveRecords} className="set-stack">
              <fieldset>
                <legend>Send at once</legend>
                <div className="set-grid">{documentTypes.map((type) => (
                  <label key={type} className="check">
                    <input type="checkbox" name="routine" value={type} defaultChecked={isRoutine(type, { routine: records.routine })} />
                    {type}
                  </label>
                ))}</div>
              </fieldset>
              <label className="check">
                <input type="checkbox" name="approve_all" defaultChecked={records.approve_all === true} />
                Wait for approval for every paper
              </label>
              <div className="set-foot"><Pending className="b b-primary" type="submit">Save papers</Pending></div>
            </form>
          </Card>
          </>}

          {group === "data" && <>
          <Card id="use" title="InboxCA use" line="What sizes a plan. Your files stay in your own drive; InboxCA storage holds the client list, records and what InboxCA reads from files.">
            {usage && <dl className="set-meters">
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
            </dl>}
            <p className="hint set-after">Shown for your information. Plans and their limits come later; nothing is limited or charged by these figures yet.</p>
          </Card>
          <Card id="data" title="Your data" line="Your client list, returns and notices, the list of papers and the activity log, as spreadsheet files in one ZIP. The papers themselves are already in your firm's drive.">
            <div className="set-foot">{download}</div>
          </Card>
          <Card id="close" title="Close the firm" danger line="Everyone is signed out, your team can no longer sign in, and the firm email and drive are disconnected. For 30 days you can still sign in and download your data. Then InboxCA deletes your firm's data; the activity log is kept one more year, as Indian rules require. Files in your drive are not touched.">
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
        </div>
      </div>
      {saved && savedNames[saved] && <Toast>{savedNames[saved]}</Toast>}
    </div>
  );
}
