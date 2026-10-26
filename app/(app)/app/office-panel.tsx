import Form from "next/form";
import Link from "next/link";
import { headers } from "next/headers";
import { reviewDevice, setOfficeOnly } from "@/app/(app)/actions";
import { addDays, todayInIndia, dueLabel } from "@/src/lib/calendar";
import { currentMember } from "@/src/lib/member";
import { personName } from "@/src/lib/roles";
import { firmAdmin, fixedSuggestion, memberOffice, officeApprover, onOfficeLine, requestAddress, type Office } from "@/src/lib/office";
import { supabaseAdmin } from "@/src/lib/supabase";
import { AutoSelect } from "./auto-select";
import { Pending } from "./pending";

// Only office approvers read these requests and the activity behind them.

// inPreset draws it inside Settings' Access preset card, the one office control there: the
// Office only switch waits under Change details, the rest shows as usual. Its Turn on sends
// the preset form, so the preset's "are you in the office now?" answer is the one used (a
// button with its own action sends no name and value, so intent rides in a hidden field).
// Why the last office change was refused, from setOfficeOnly's redirect.
const refusedNotes: Record<string, string> = {
  deputies: "Choose up to 2 active partners as deputies, with the co-admin one of them.",
  no_line: "InboxCA could not see this connection's address. Try again from the office's own network.",
  closed: "The office has closed for today, so it cannot be opened now.",
  pc: "That PC is no longer approved.",
  self: "Ask another approver to decide on your own request.",
  office: "That change could not be saved. Try again.",
};

export async function OfficePanel({ compact = false, error = "", inPreset = false, branch = "" }: { compact?: boolean; error?: string; inPreset?: boolean; branch?: string }) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership || !officeApprover(membership.role, userId, membership.settings)) return null;
  const firmOffice = (membership.settings.office ?? {}) as Office;
  const owner = membership.role === "owner";
  const isAdmin = firmAdmin(membership.role, userId, membership.settings);
  const admin = supabaseAdmin();
  const today = todayInIndia();
  const [{ data: pcs }, { data: activity }, { data: people }, { data: requests }, { data: branches }, fixedRule] = await Promise.all([
    admin.from("devices").select("id, name, status, kind, person_id, ends_on, key_id").eq("firm_id", membership.firmId),
    admin.from("activity_log").select("entity_id, actor_id, action, at, details").eq("firm_id", membership.firmId).in("action", ["device.first_seen", "office.refused", "office.here", "office.confirm", "office.today"]),
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    admin.from("requests").select("id, entity_id, reason_code, details").eq("firm_id", membership.firmId).eq("entity_type", "office_connection").eq("status", "pending"),
    admin.from("groups").select("id, name, kind, settings").eq("firm_id", membership.firmId).eq("kind", "branch").order("name"),
    fixedSuggestion(),
  ]);
  // The office shown and changed below: the main one, or the picked branch's own (5.17.4 #13).
  const picked = branches?.find((row) => row.id === branch);
  const office = memberOffice(firmOffice, picked) ?? {};
  const anyOn = firmOffice.on || branches?.some((row) => memberOffice(firmOffice, row)?.on);
  const where = picked && <input type="hidden" name="branch" value={picked.id} />;
  const emails = new Map(people?.map((person) => [person.user_id, person.email]));
  const first = new Map(activity?.filter((entry) => entry.action === "device.first_seen").map((entry) => [entry.entity_id, entry]));
  const waiting = (pcs ?? []).filter((pc) => pc.status === "waiting");
  const approved = (pcs ?? []).filter((pc) => pc.status === "approved" && (pc.kind !== "personal" || (pc.ends_on ?? "") >= today));
  const refusals = (activity ?? []).filter((entry) => entry.action === "office.refused" && Date.parse(entry.at) >= Date.parse(`${today}T00:00:00+05:30`));
  const here = onOfficeLine(requestAddress(await headers()), office);
  // Self-adjusting (5.8): after 3 office confirmations in 14 days (the admin console's numbers),
  // or with no PC that stays in the office, the owner is told once how to get a fixed connection.
  const since = Date.parse(`${today}T00:00:00+05:30`) - fixedRule.days * 86_400_000;
  const confirmations = (activity ?? []).filter((entry) => entry.action !== "device.first_seen" && entry.action !== "office.refused" && Date.parse(entry.at) >= since).length;
  const trustedPc = (pcs ?? []).some((pc) => pc.status === "approved" && pc.kind === "office" && pc.key_id);
  const suggestFixed =
    isAdmin && office.on && !(office.lines ?? []).some((line) => (line as { fixed?: boolean }).fixed) && !(office as { fixed_declined?: boolean }).fixed_declined && (confirmations >= fixedRule.taps || !trustedPc);
  if (compact && !requests?.length && !refusals.length && (owner || !waiting.length)) return null;
  const line = <p className="hint">Staff, managers and front desk use approved PCs on your office internet connection. You and partners can use InboxCA anywhere.</p>;
  const toggle = office.on ? isAdmin && <form action={setOfficeOnly} className="form-row">{where}
    <Pending className="b b-ghost" name="intent" value="forget">Forget office connections</Pending><Pending className="b b-secondary" name="intent" value="off">Turn off</Pending>
  </form> : isAdmin && inPreset ? <><input type="hidden" form="preset-form" name="intent" value="on" />{picked && <input type="hidden" form="preset-form" name="branch" value={picked.id} />}<Pending className="b b-primary" form="preset-form" formAction={setOfficeOnly} formNoValidate>Turn on</Pending></>
    : isAdmin && <form action={setOfficeOnly}>{where}
    <fieldset className="fieldset"><legend>Are you in your office right now?</legend>
      <label className="check"><input type="radio" name="here" value="yes" defaultChecked />Yes, this is my office</label>
      <label className="check"><input type="radio" name="here" value="no" />No, I will confirm it from the office</label>
    </fieldset><Pending className="b b-primary" name="intent" value="on">Turn on</Pending>
  </form>;
  const Box = inPreset ? "div" : "section";
  return (
    <Box className={inPreset ? "office-in-preset" : "panel"} aria-labelledby={inPreset ? undefined : compact ? "office-alerts" : "office-title"} id={compact ? undefined : "office"}>
      {!inPreset && <h2 id={compact ? "office-alerts" : "office-title"}>{compact ? "Your office today" : "Staff can use InboxCA only in the office"}</h2>}
      {refusedNotes[error] && <p className="alert" role="alert">{refusedNotes[error]}</p>}
      {!compact && !inPreset && line}
      {!compact && !!branches?.length && <Form action="/app/settings#office">
        <input type="hidden" name="group" value="access" />
        <div className="form-row"><div>
          <label htmlFor="office-branch">Office</label>
          <AutoSelect save="branch" id="office-branch" name="branch" defaultValue={picked?.id ?? ""}>
            <option value="">Main office</option>
            {branches.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </AutoSelect>
        </div><button className="sr-only" value="branch">Show</button></div>
        {picked && !(picked.settings as { office?: Office }).office && <p className="hint">{picked.name} follows the main office until you turn Office only on or off for it here.</p>}
      </Form>}
      {office.on && !compact && <p className={here ? "notice" : "alert"} role="status">{here ? "On. You are on your office internet connection now." : "On. Waiting for your firm to confirm the office internet connection."}</p>}
      {anyOn && requests?.map((request) => {
        const details = request.details as { person?: string; day?: string };
        const pc = pcs?.find((pc) => pc.id === request.entity_id);
        if (!pc || pc.status !== "approved") return null;
        if (!owner && details.person === userId) return <p key={request.id}>Ask the owner or another deputy to check your connection.</p>;
        return <div className="notice" key={request.id}>
          <p>{request.reason_code === "office_changed"
            ? `Your office internet connection changed ${details.day === today ? "today" : `on ${dueLabel(details.day ?? today)}`} (first seen on ${pc.name})`
            : `${personName(emails.get(details.person ?? ""))} on ${pc.name} is on a new internet connection:`}</p>
          <form action={setOfficeOnly} className="form-row">
            <input type="hidden" name="request" value={request.id} />
            {request.reason_code === "office_waiting" && <>
              <Pending className="b b-primary b-small" name="intent" value="confirm">This is my office</Pending>
              <Pending className="b b-secondary b-small" name="intent" value="today">Allow this network today</Pending>
            </>}
            <Pending className="b b-ghost b-small" name="intent" value="refuse">Not my office</Pending>
          </form>
        </div>;
      })}
      {refusals.map((entry) => <p className="alert" key={entry.actor_id}>{personName(emails.get(entry.actor_id ?? ""))} tried to use InboxCA from outside the office today.</p>)}
      {compact && !owner && !!waiting.length && <p>{waiting.length} PCs are waiting for approval. <Link href="/app/settings#office">Approve PCs</Link></p>}
      {!compact && <>
        {anyOn && !!waiting.length && <div className="device-list">
          <h3 className="sub-head">PCs waiting for approval</h3>
          <ul className="rows">{waiting.map((pc) => {
            const seen = first.get(pc.id);
            const date = seen?.at ? new Date(seen.at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : today;
            // Asked from away from the office: only for that person, until a day, view only.
            const away = !!(seen?.details as { away?: boolean } | null)?.away;
            return <li key={pc.id}>
              <span className="grow"><strong>{personName(emails.get(seen?.actor_id ?? ""))} on {pc.name}</strong>, {away ? "asks to use it away from the office, to view only" : `first seen ${date === today ? "today" : `on ${dueLabel(date)}`}`}</span>
              <form action={reviewDevice} className="end">
                <input type="hidden" name="device" value={pc.id} />
                {away ? <>
                  <label className="until">Until <input type="date" name="until" required min={today} max={addDays(today, 90)} defaultValue={addDays(today, 7)} /></label>
                  <Pending className="b b-primary b-small" name="decision" value="personal">Allow</Pending>
                </> : <>
                  <Pending className="b b-primary b-small" name="decision" value="office">Stays in the office</Pending>
                  <Pending className="b b-secondary b-small" name="decision" value="laptop">Laptop</Pending>
                </>}
                <Pending className="b b-ghost b-small" name="decision" value="refuse" formNoValidate>Refuse</Pending>
              </form>
            </li>;
          })}</ul>
          {waiting.length > 1 && <form action={reviewDevice}><Pending className="b b-secondary" name="decision" value="office">Approve all as staying in the office</Pending></form>}
        </div>}
        {!!approved.length && <div className="device-list">
          <h3 className="sub-head">Approved devices</h3>
          <ul className="rows">{approved.map((pc) => <li key={pc.id}>
            <span className="grow"><strong>{pc.name}</strong>, {pc.kind === "office" ? (pc.key_id ? "stays in the office" : "stays in the office, waiting for its key to be set up on it") : pc.kind === "laptop" ? "laptop" : `${personName(emails.get(pc.person_id ?? ""))}'s, away from the office until ${dueLabel(pc.ends_on ?? today)}`}</span>
            <form action={reviewDevice} className="end">
              <input type="hidden" name="device" value={pc.id} />
              <Pending className="b b-ghost b-small" name="decision" value="withdraw">Withdraw</Pending>
            </form>
          </li>)}</ul>
        </div>}
        {office.on && !here && <form action={setOfficeOnly} className="form-row">{where}
          <Pending className="b b-primary" name="intent" value="here">This is my office</Pending>
        </form>}
        {inPreset && toggle ? <details className="reveal office-switch"><summary>Change details</summary><h3 className="sub-head">Office only {office.on ? "is on" : "is off"}</h3>{line}{toggle}</details> : toggle}
        {suggestFixed && <form action={setOfficeOnly} className="fixed-suggestion">{where}
          <p><strong>To stop these confirmations, ask your internet provider for a fixed address.</strong> Here is what to say:</p>
          <blockquote>&ldquo;Please add a fixed internet address to our broadband connection, account number ___. We need it for office software access.&rdquo;</blockquote>
          <p className="hint">When it is done, press Done from a PC in the office.</p>
          <span className="form-row">
            <Pending className="b b-primary" name="intent" value="fixed">Done</Pending>
            <Pending className="b b-ghost" name="intent" value="no_fixed">My provider doesn&apos;t offer it</Pending>
          </span>
        </form>}
        {isAdmin && office.on && !suggestFixed && (office as { fixed_declined?: boolean }).fixed_declined && !trustedPc && <p className="hint">Without a fixed connection, mark one desktop in the office as Stays in the office and name a deputy, so a changed connection is confirmed without you.</p>}
        {isAdmin && office.on && !suggestFixed && <form action={setOfficeOnly}>{where}
          <p className="hint">If your internet provider gave your office a fixed connection, confirm it here from the office.</p>
          <Pending className="b b-secondary" name="intent" value="fixed">Done</Pending>
        </form>}
        {owner && <form action={setOfficeOnly}>
          <fieldset className="fieldset"><legend>Name up to 2 deputies</legend>
            <p className="hint">Partners who can approve PCs and office connections when you are away. They keep using their 2 step code.</p>
            {people?.filter((person) => person.role === "partner" && person.status === "active").map((person) => <label className="check" key={person.user_id}>
              <input type="checkbox" name="deputy" value={person.user_id} defaultChecked={office.deputies?.includes(person.user_id)} />{person.email}
            </label>)}
          </fieldset>
          <div className="form-row"><div>
            <label htmlFor="co-admin">Co-admin</label>
            <select id="co-admin" name="co_admin" defaultValue={office.co_admin ?? ""}>
              <option value="">No co-admin</option>
              {people?.filter((person) => person.role === "partner" && person.status === "active").map((person) => <option key={person.user_id} value={person.user_id}>{person.email}</option>)}
            </select>
          </div></div>
          <p className="hint">A partner who is also a deputy and changes the access preset, Office only, office hours, signing in and permissions like you. Your email, drive, people, recovery codes and closing the firm stay yours.</p>
          <Pending className="b b-secondary" name="intent" value="deputies">Save deputies and co-admin</Pending>
        </form>}
        {isAdmin && office.on && <div className="side-doors"><h3 className="sub-head">Doors InboxCA cannot close for you</h3><ul>
          <li>Don&apos;t give staff the firm mailbox&apos;s password; InboxCA does the email work.</li>
          <li>Uninstall remote desktop tools such as AnyDesk and TeamViewer from office PCs.</li>
          <li>Ask clients to send documents to the firm&apos;s email, not to staff phones.</li>
          <li>Photos of the screen cannot be blocked; every page InboxCA shows names who viewed it and when.</li>
        </ul></div>}
      </>}
    </Box>
  );
}
