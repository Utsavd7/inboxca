import { HardDrive, Mail } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { changeHoliday, changeSpecialHours, connectDrive, disconnectDrive, disconnectMailbox, saveHours, saveLimits, saveRecords, saveReminders, saveVisibility, setFolderOrder } from "@/app/(app)/actions";
import { documentTypes } from "@/src/lib/documents";
import { isRoutine, type RecordsSettings } from "@/src/lib/records";
import { folderOrderNames, namings } from "@/src/lib/drive";
import { supabaseAdmin } from "@/src/lib/supabase";
import { serverCrypto } from "@/src/lib/crypto";
import { DAYS, longDate, SUGGESTED_HOURS, type Hours, type SpecialHours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { IDLE_CHOICES, SESSION_CHOICES } from "@/src/lib/session";
import { Badge, PageHead } from "../ui";
import { MailboxForm } from "./mailbox-form";

const driveNames: Record<string, string> = { onedrive: "OneDrive", dropbox: "Dropbox", local: "Test drive on this computer" };
const driveErrors: Record<string, string> = {
  drive_terms: "Tick the box to agree to the Drive access terms first.",
  drive_provider: "Choose a drive.",
  drive_taken: "A drive is already connected. Disconnect it first.",
  drive_denied: "The drive was not allowed, so nothing was connected.",
  drive_failed: "The drive did not finish connecting. Try again.",
};

// The owner's settings: the firm's email, who sees clients, office hours, holidays and
// signing in limits (PLAN.md 5.13, 5.17).
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") redirect("/app");
  const { data: accounts } = await supabase.from("connected_accounts").select("id, kind, provider, address_enc, status");
  const mailbox = accounts?.find((account) => account.kind === "mail");
  const drive = accounts?.find((account) => account.kind === "drive");
  // Only the server reads a drive's settings; this page is the owner's.
  const { data: driveSettings } = drive ? await supabaseAdmin().from("connected_accounts").select("settings").eq("id", drive.id).single() : { data: null };
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
  const { data: used } = await supabase.rpc("firm_usage", { target_firm: membership.firmId });
  const usage = used?.[0];

  return (
    <>
      <PageHead title="Settings" sub="How your firm uses InboxCA. Only you, the owner, see this page." />
      <div className="settings">
        <nav className="settings-index" aria-label="Settings">
          {[
            ["#mailbox", "Firm email"],
            ["#drive", "Firm drive"],
            ["#reminders", "Reminders"],
            ["#records", "Papers on request"],
            ["#visibility", "Who sees clients"],
            ["#hours", "Office hours"],
            ["#special", "Special hours"],
            ["#limits", "Signing in"],
            ["#holidays", "Holidays"],
            ["#use", "InboxCA use"],
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
          <section className="panel" aria-labelledby="reminders-title" id="reminders">
            <h2 id="reminders-title">Reminders</h2>
            <p className="hint">
              InboxCA emails each client once a day at most, from your firm&apos;s address, about returns due in 7, 3 or 1 days, on the day, and 1 and 3 days late. It skips a
              reminder when the return is filed, the client already sent files for it, or your team is replying to them. Only dates a CA has confirmed are reminded.
            </p>
            <form action={saveReminders} className="form-row">
              <label className="check">
                <input type="checkbox" name="on" defaultChecked={settings.reminders === true} />
                Email clients before their returns are due
              </label>
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
        </div>
      </div>
    </>
  );
}
