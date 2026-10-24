import { HardDrive, Mail } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { changeHoliday, changeSpecialHours, closeFirm, connectDrive, disconnectDrive, disconnectMailbox, saveHours, saveLimits, savePermissions, saveRecords, saveReminders, saveMailLimit, saveVisibility, setFolderOrder, withdrawAlways, allowStanding } from "@/app/(app)/actions";
import { officeApprover } from "@/src/lib/office";
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
import { Badge, PageHead } from "../ui";
import { STAGES, stageNames, reminderStages } from "@/src/lib/reminders";
import { MailboxForm } from "./mailbox-form";

const driveNames: Record<string, string> = { onedrive: "OneDrive", dropbox: "Dropbox", local: "Test drive on this computer" };
const driveErrors: Record<string, string> = {
  permission_scope:"Check the end date and client names. Use the full names shown in Clients, one per line, with no repeated names.",
  mail_limit:"Choose a whole number from 1 to 2,000 for the email limit.",
  drive_terms: "Tick the box to agree to the Drive access terms first.",
  drive_provider: "Choose a drive.",
  drive_taken: "A drive is already connected. Disconnect it first.",
  drive_denied: "The drive was not allowed, so nothing was connected.",
  drive_failed: "The drive did not finish connecting. Try again.",
  close_name: "Type the firm name exactly as it is shown.",
};
const download = <form action="/app/settings/download" method="post"><button className="b b-secondary" type="submit">Download your data</button></form>;

// The owner's settings: the firm's email, who sees clients, office hours, holidays and
// signing in limits (PLAN.md 5.13, 5.17).
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership || !officeApprover(membership.role, userId, membership.settings)) redirect("/app");
  if (membership.role !== "owner") return <><PageHead title="Office approvals" sub="Confirm your office connection and approve PCs for your firm." /><OfficePanel /></>;
  // A closed firm keeps only its download until InboxCA deletes it, 30 days on.
  const { data: closed } = await supabase.from("activity_log").select("at").eq("entity_id", membership.firmId).eq("firm_id", membership.firmId).eq("action", "firm.closed").maybeSingle();
  if (closed) return (
    <>
      <PageHead title="Settings" sub="Only you, the owner, see this page." />
      <section className="panel" aria-labelledby="data">
        <h2 id="data">Your firm is closing</h2>
        <p className="hint">InboxCA deletes your firm&apos;s data on {longDate(new Date(Date.parse(closed.at) + 30 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }))}. Download your data before then. The activity log is kept one more year, as Indian rules require, then deleted. Files in your firm&apos;s drive stay where they are.</p>
        {download}
      </section>
    </>
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
  const { saved, error } = await searchParams;
  const settings = membership.settings;
  const hours = (settings.hours as Hours | undefined) ?? SUGGESTED_HOURS;
  const holidays = (settings.holidays as string[] | undefined) ?? [];
  const special = (settings.special_hours as SpecialHours[] | undefined) ?? [];
  const access = (settings.access ?? {}) as { hours_only?: boolean; idle_minutes?: number; session_hours?: number };
  const hoursOnly = access.hours_only ?? false;
  const records = (settings.records ?? {}) as RecordsSettings;
  const permissions = (settings.permissions ?? {}) as Permissions;
  const [{ data: used }, { data: people }] = await Promise.all([
    supabase.rpc("firm_usage", { target_firm: membership.firmId }),
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
  return (
    <>
      <PageHead title="Settings" sub="How your firm uses InboxCA. Only you, the owner, see this page." />
      <div className="settings">
        <nav className="settings-index" aria-label="Settings">
          {[
            ["#mailbox", "Firm email"],
            ["#drive", "Firm drive"],
            ["#office", "Office only"],
            ["#permissions", "Permissions"],
            ["#reminders", "Reminders"],
            ["#records", "Papers on request"],
            ["#visibility", "Who sees clients"],
            ["#hours", "Office hours"],
            ["#special", "Special hours"],
            ["#limits", "Signing in"],
            ["#holidays", "Holidays"],
            ["#use", "InboxCA use"],
            ["#data", "Your data"],
            ["#close", "Close the firm"],
          ].map(([href, name]) => (
            <a key={href} href={href}>
              {name}
            </a>
          ))}
        </nav>
        <div>
          <section className="panel" aria-labelledby="mailbox">
            <h2 id="mailbox">Firm email</h2>
            <p className="hint">The address your clients write to. InboxCA reads only mail from your clients and their contacts, keeps no copy of it, and replies from this address.</p>
            {mailbox ? (
              <form action={disconnectMailbox} className="connection">
                <Mail size={18} aria-hidden />
                <p className="grow" role="status">
                  <Badge tone={mailbox.status === "connected" ? "done" : "late"}>{mailbox.status === "connected" ? "Connected" : "Needs to be connected again"}</Badge>
                  <span className="sr-only">: </span>
                  <strong>{mailAddress}</strong>
                </p>
                <button className="b b-secondary b-small" type="submit">
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
            {mailbox && <form action={saveMailLimit} className="form-row">
              <div><label htmlFor="mail-limit">Emails in 24 hours</label><input id="mail-limit" name="limit" type="number" min="1" max="2000" step="1" className="num" defaultValue={Number(settings.mail_limit) || 500} /></div>
              <button className="b b-secondary">Save email limit</button>
              <p className="hint">Every reply and bulk send shares this limit. Lower it if your email provider allows fewer.</p>
            </form>}
          </section>

          <section className="panel" aria-labelledby="drive-title" id="drive">
            <h2 id="drive-title">Firm drive</h2>
            <p className="hint">Client files are saved in your firm&apos;s own drive, in folders by year, client and work. InboxCA keeps no client files.</p>
            {drive ? (
              <form action={disconnectDrive} className="connection">
                <HardDrive size={18} aria-hidden />
                <p className="grow" role="status">
                  <Badge tone="done">Connected</Badge>
                  <span className="sr-only">: </span>
                  <strong>{driveAddress}</strong>
                </p>
                <button className="b b-secondary b-small" type="submit">
                  Disconnect
                </button>
              </form>
            ) : null}
            {drive && (
              <p className="hint">
                Past files already in your drive? <Link href="/app/import">Add old files</Link>, sorted into their client folders in place.
              </p>
            )}
            {drive && (
              <form action={setFolderOrder} className="form-row">
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
                <button className="b b-secondary" type="submit">
                  Save
                </button>
              </form>
            )}
            {!drive && (
              <form action={connectDrive}>
                <fieldset className="fieldset">
                  <legend>Which drive</legend>
                  {(["onedrive", "dropbox", ...(process.env.DRIVE_LOCAL_DIR ? ["local"] : [])] as const).map((provider) => (
                    <label key={provider} className="check check-row">
                      <input type="radio" name="provider" value={provider} required disabled={!ready[provider]} />
                      {driveNames[provider]}
                      {!ready[provider] && <span className="badge plain">Coming soon</span>}
                    </label>
                  ))}
                </fieldset>
    <p className="hint">InboxCA can read this whole drive and touches only the folders you choose and its own InboxCA folder, so connect a drive kept for your firm.</p>
                <h3 className="subhead">What you are allowing InboxCA to do</h3>
                <ul className="points">
                  <li>Read the files in the folders you choose, and every file it saves.</li>
                  <li>Make folders, and rename and move folders and files to keep them in order.</li>
                  <li>Save files from client emails, and the forms it fills.</li>
                  <li>Read figures from your files to fill GST and income tax forms for your team to check.</li>
                  <li>It will not delete a file without your approval, share anything outside your firm, open folders you did not choose, or use your files to train AI.</li>
                  <li>You can take this access back at any time, here or at your drive provider.</li>
                </ul>
                <label className="check check-row">
                  <input type="checkbox" name="agree" required />
                  <span>
                    I have read this and I agree, on behalf of my firm, to the <Link href="/terms#drive">Drive access terms</Link>.
                  </span>
                </label>
                {error?.startsWith("drive_") && (
                  <p className="alert" role="alert">
                    {driveErrors[error]}
                  </p>
                )}
                <button className="b b-primary" type="submit">
                  Connect drive
                </button>
              </form>
            )}
          </section>
          <OfficePanel error={error === "deputies"} />

          <section className="panel" aria-labelledby="permissions-title" id="permissions">
            <h2 id="permissions-title">Permissions</h2>
            <p className="hint">
              Everyone sees every client&apos;s files, view only, and does the filing work: correcting a file&apos;s type or period, adding portal files, marking returns filed.
              Anything more is a question to their manager or to you, unless you switch it on here. Partners follow managers. Removing files stays yours.
            </p>
            <form action={savePermissions}>
              <div className="table-wrap">
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
              <details><summary>Limit these role permissions</summary><p className="hint">Leave blank for every client with no end date. View only access stays the same.</p><div className="cols">{(["employee","manager"] as const).map(column=><fieldset key={column} className="fields"><legend>{column==="employee" ? "Employees" : "Managers"}</legend><div><label htmlFor={`${column}-clients`}>Client names, one per line</label><textarea id={`${column}-clients`} name={`${column}:clients`} rows={3} defaultValue={namesOf(permissions[column]?.scope?.clients)}/></div><div><label htmlFor={`${column}-until`}>Last day, if needed</label><input id={`${column}-until`} type="date" name={`${column}:until`} defaultValue={permissions[column]?.scope?.until}/></div></fieldset>)}</div></details>
              <label className="check">
                <input type="checkbox" name="hide_inactive" defaultChecked={settings.viewer_hide_inactive === true} />
                Hide documents when InboxCA is not the active window (staff often read a document while typing in the portal beside it, so this is off unless you need it)
              </label>
              <label className="check"><input type="checkbox" name="second_form_approval" defaultChecked={settings.second_form_approval===true}/>Second approval before filing. Another person must approve after the figures are checked.</label>
              <div className="form-row">
                <button className="b b-secondary" name="intent" value="save">
                  Save permissions
                </button>
                <button className="b b-ghost" name="intent" value="reset">
                  Reset to defaults
                </button>
              </div>
            </form>
            {!!people?.some(person=>person.role!=="owner" && person.status==="active") && <details><summary>Allow one person without asking</summary><form action={allowStanding} className="fields"><div><label htmlFor="standing-person">Person</label><select id="standing-person" name="person" required>{people.filter(person=>person.role!=="owner" && person.status==="active").map(person=><option key={person.user_id} value={person.user_id}>{person.email}</option>)}</select></div><div><label htmlFor="standing-right">What they may do</label><select id="standing-right" name="right">{Object.entries(switchable).map(([right,label])=><option key={right} value={right}>{label}</option>)}</select></div><div><label htmlFor="standing-clients">Client names, one per line. Blank means every client.</label><textarea id="standing-clients" name="clients" rows={3}/></div><div><label htmlFor="standing-until">Last day, if needed</label><input id="standing-until" name="until" type="date"/></div><button className="b b-secondary">Allow this person</button></form></details>}
            {!!always.length && (
              <>
                <h3 className="sub-head">Always allowed</h3>
                <ul className="rows">
                  {always.map((person) => (
                    <li key={person.id}>
                      <span className="grow">
                        <strong>{person.email}</strong> may {person.rights.map(grant=>`${switchable[grant.right as keyof typeof switchable].toLowerCase()}${"clients" in grant && grant.clients ? ` for ${namesOf(grant.clients).replaceAll("\n",", ")}` : " for every client"}${"until" in grant && grant.until ? ` until ${longDate(grant.until)}` : ""}`).join("; ")} without asking
                      </span>
                      <form action={withdrawAlways} className="end">
                        <input type="hidden" name="person" value={person.id} />
                        <button className="b b-ghost b-small">Withdraw</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="panel" aria-labelledby="reminders-title" id="reminders">
            <h2 id="reminders-title">Reminders</h2>
            <p className="hint">
              InboxCA emails each client once a day at most, from your firm&apos;s address, at the stages you choose below. It skips a
              reminder when the return is filed, the client already sent files for it, or your team is replying to them. Only dates a CA has confirmed are reminded.
            </p>
            <form action={saveReminders} className="form-row">
              <label className="check">
                <input type="checkbox" name="on" defaultChecked={settings.reminders === true} />
                Email clients before their returns are due
              </label>
              <fieldset><legend>When to remind</legend><div className="routine-grid">{STAGES.map((day) => <label className="check" key={day}><input type="checkbox" name="stage" value={day} defaultChecked={reminderStages(settings).includes(day)} />{stageNames[day]}</label>)}</div></fieldset>
              <label className="check">
                <input type="checkbox" name="acknowledge" defaultChecked={settings.acknowledge === true} />
                Reply to clients when their files arrive, saying what was received
              </label>
              <button className="b b-secondary" type="submit">
                Save reminders
              </button>
            </form>
          </section>

          <section className="panel" aria-labelledby="records-title" id="records">
            <h2 id="records-title">Papers sent on request</h2>
            <p className="hint">
              When a client or an allowed contact asks for a paper by email, InboxCA finds it and replies with a secure link. Ticked papers go at once; the rest wait for one approval in the
              Inbox.
            </p>
            <form action={saveRecords}>
              <div className="routine-grid">
                {documentTypes.map((type) => (
                  <label key={type} className="check">
                    <input type="checkbox" name="routine" value={type} defaultChecked={isRoutine(type, { routine: records.routine })} />
                    {type}
                  </label>
                ))}
              </div>
              <div className="form-row">
                <label className="check">
                  <input type="checkbox" name="approve_all" defaultChecked={records.approve_all === true} />
                  Wait for approval for every paper
                </label>
                <button className="b b-secondary" type="submit">
                  Save papers
                </button>
              </div>
            </form>
          </section>

          <section className="panel" aria-labelledby="visibility">
            <h2 id="visibility">Who sees which clients</h2>
            <form action={saveVisibility}>
              {[
                ["open", "Everyone in the firm sees every client"],
                ["restricted", "Only you, partners and the people assigned to a client see it"],
              ].map(([value, label]) => (
                <label key={value} className="check check-row">
                  <input type="radio" name="visibility" value={value} defaultChecked={(settings.client_visibility ?? "open") === value} />
                  {label}
                </label>
              ))}
              <button className="b b-primary" type="submit">
                Save who sees clients
              </button>
              {saved === "visibility" && (
                <p className="ok" role="status">
                  Who sees clients saved.
                </p>
              )}
            </form>
          </section>

          <section className="panel" aria-labelledby="hours">
            <h2 id="hours">Office hours</h2>
            <p className="hint">India time. You can always sign in; these hours apply to everyone else.</p>
            <form action={saveHours}>
              <table className="hours-table">
                <tbody>
                  {DAYS.map((name, day) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>
                        <label>
                          <input type="checkbox" name={`open-${day}`} defaultChecked={!!hours[day]} /> Open
                        </label>
                      </td>
                      <td>
                        <input type="time" name={`from-${day}`} defaultValue={hours[day]?.[0] ?? "09:00"} aria-label={`${name} opens`} />
                        {" to "}
                        <input type="time" name={`to-${day}`} defaultValue={hours[day]?.[1] ?? "18:00"} aria-label={`${name} closes`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label className="check check-row">
                <input type="checkbox" name="hours_only" defaultChecked={hoursOnly} />
                Everyone except you can use InboxCA only during office hours, and not on holidays
              </label>
              <button className="b b-primary" type="submit">
                Save office hours
              </button>
              {saved === "hours" && (
                <p className="ok" role="status">
                  Office hours saved.
                </p>
              )}
              {error && DAYS.includes(error) && (
                <p className="alert" role="alert">
                  {error}: the closing time must be after the opening time.
                </p>
              )}
            </form>
          </section>

          <section className="panel" aria-labelledby="special">
            <h2 id="special">Special hours</h2>
            <p className="hint">A tax season or a late evening: these times replace the office hours on every day in the dates. Holidays stay closed.</p>
            <ul className="rows">
              {special.map((range) => (
                <li key={range.from + range.to}>
                  <span className="name">
                    {range.from === range.to ? longDate(range.from) : `${longDate(range.from)} to ${longDate(range.to)}`}: {range.open} to {range.close}
                  </span>
                  <form action={changeSpecialHours}>
                    <input type="hidden" name="from" value={range.from} />
                    <input type="hidden" name="to" value={range.to} />
                    <button className="b b-ghost b-small" name="intent" value="remove">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={changeSpecialHours} className="form-row">
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
              <button className="b b-secondary" type="submit">
                Add special hours
              </button>
            </form>
            {error === "special" && (
              <p className="alert" role="alert">
                The dates must run forward and the closing time must be after the opening time.
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="limits">
            <h2 id="limits">Signing in</h2>
            <p className="hint">For everyone in the firm, you included.</p>
            <form action={saveLimits} className="form-row">
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
              <button className="b b-primary" type="submit">
                Save signing in limits
              </button>
            </form>
            {saved === "limits" && (
              <p className="ok" role="status">
                Signing in limits saved.
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="holidays">
            <h2 id="holidays">Holidays</h2>
            <ul className="rows">
              {holidays.map((date) => (
                <li key={date}>
                  <span className="name">
                    {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long" })}, {longDate(date)}
                  </span>
                  <form action={changeHoliday}>
                    <input type="hidden" name="date" value={date} />
                    <button className="b b-ghost b-small" name="intent" value="remove">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={changeHoliday} className="form-row">
              <div>
                <label htmlFor="holiday">Add a holiday</label>
                <input id="holiday" type="date" name="date" required />
              </div>
              <button className="b b-secondary" type="submit">
                Add holiday
              </button>
            </form>
          </section>
          <section className="panel" aria-labelledby="use-title" id="use">
            <h2 id="use-title">InboxCA use</h2>
            <p className="hint">What sizes a plan. Your files stay in your own drive; InboxCA storage holds the client list, records and what InboxCA reads from files.</p>
            <dl className="meters">
              <div>
                <dt>Returns this financial year</dt>
                <dd>{usage?.returns_this_year ?? 0}</dd>
              </div>
              <div>
                <dt>InboxCA storage</dt>
                <dd>{(usage?.workspace_bytes ?? 0) < 1024 ** 2 ? `${Math.ceil((usage?.workspace_bytes ?? 0) / 1024)} KB` : `${((usage?.workspace_bytes ?? 0) / 1024 ** 2).toFixed(1)} MB`}</dd>
              </div>
            </dl>
            <p className="hint">Shown for your information. Plans and their limits come later; nothing is limited or charged by these figures yet.</p>
          </section>
          <section className="panel" aria-labelledby="data">
            <h2 id="data">Your data</h2>
            <p className="hint">Your client list, returns and notices, the list of papers and the activity log, as spreadsheet files in one ZIP. The papers themselves are already in your firm&apos;s drive.</p>
            {download}
          </section>
          <section className="panel" aria-labelledby="close">
            <h2 id="close">Close the firm</h2>
            <p className="hint">Everyone is signed out, your team can no longer sign in, and the firm email and drive are disconnected. For 30 days you can still sign in and download your data. Then InboxCA deletes your firm&apos;s data; the activity log is kept one more year, as Indian rules require. Files in your drive are not touched.</p>
            <details className="reveal" open={error === "close_name"}>
              <summary>Close the firm</summary>
              <form action={closeFirm} className="fields">
                <div><label htmlFor="close-name">Type {membership.firmName} to confirm</label><input id="close-name" name="name" required autoComplete="off" /></div>
                <button className="b b-secondary" type="submit">Close the firm for good</button>
              </form>
              {error === "close_name" && <p className="alert" role="alert">{driveErrors[error]}</p>}
            </details>
          </section>
        </div>
      </div>
    </>
  );
}
