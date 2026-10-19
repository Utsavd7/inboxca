import Link from "next/link";
import { headers } from "next/headers";
import { reviewDevice, setOfficeOnly } from "@/app/(app)/actions";
import { todayInIndia, dueLabel } from "@/src/lib/calendar";
import { currentMember } from "@/src/lib/member";
import { officeApprover, onOfficeLine, requestAddress, type Office } from "@/src/lib/office";
import { supabaseAdmin } from "@/src/lib/supabase";

const personName = (email?: string) => {
  const name = email?.split("@")[0].split(/[._-]/)[0] || "Someone";
  return name[0].toUpperCase() + name.slice(1);
};

// Only office approvers read these requests and the activity behind them.
// When to suggest a fixed connection; later these move to admin configuration (5.8).
const FIXED_SUGGESTION_TAPS = 3;
const FIXED_SUGGESTION_DAYS = 14;

export async function OfficePanel({ compact = false, error = false }: { compact?: boolean; error?: boolean }) {
  const { supabase, userId, membership } = await currentMember();
  if (!membership || !officeApprover(membership.role, userId, membership.settings)) return null;
  const office = (membership.settings.office ?? {}) as Office;
  const owner = membership.role === "owner";
  const admin = supabaseAdmin();
  const today = todayInIndia();
  const [{ data: pcs }, { data: activity }, { data: people }, { data: requests }] = await Promise.all([
    admin.from("devices").select("id, name, status, kind").eq("firm_id", membership.firmId),
    admin.from("activity_log").select("entity_id, actor_id, action, at").eq("firm_id", membership.firmId).in("action", ["device.first_seen", "office.refused", "office.here", "office.confirm", "office.today"]),
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    admin.from("requests").select("id, entity_id, reason_code, details").eq("firm_id", membership.firmId).eq("entity_type", "office_connection").eq("status", "pending"),
  ]);
  const emails = new Map(people?.map((person) => [person.user_id, person.email]));
  const first = new Map(activity?.filter((entry) => entry.action === "device.first_seen").map((entry) => [entry.entity_id, entry]));
  const waiting = (pcs ?? []).filter((pc) => pc.status === "waiting");
  const refusals = (activity ?? []).filter((entry) => entry.action === "office.refused" && Date.parse(entry.at) >= Date.parse(`${today}T00:00:00+05:30`));
  const here = onOfficeLine(requestAddress(await headers()), office);
  // Self-adjusting (5.8): after 3 office confirmations in 14 days, or with no PC that stays in
  // the office, the owner is told once how to get a fixed connection.
  const since = Date.parse(`${today}T00:00:00+05:30`) - FIXED_SUGGESTION_DAYS * 86_400_000;
  const confirmations = (activity ?? []).filter((entry) => entry.action !== "device.first_seen" && entry.action !== "office.refused" && Date.parse(entry.at) >= since).length;
  const trustedPc = (pcs ?? []).some((pc) => pc.status === "approved" && pc.kind === "office");
  const suggestFixed =
    owner && office.on && !(office.lines ?? []).some((line) => (line as { fixed?: boolean }).fixed) && !(office as { fixed_declined?: boolean }).fixed_declined && (confirmations >= FIXED_SUGGESTION_TAPS || !trustedPc);
  if (compact && !requests?.length && !refusals.length && (owner || !waiting.length)) return null;
  return (
    <section className="panel" aria-labelledby={compact ? "office-alerts" : "office-title"} id={compact ? undefined : "office"}>
      <h2 id={compact ? "office-alerts" : "office-title"}>{compact ? "Your office today" : "Staff can use InboxCA only in the office"}</h2>
      {error && <p className="alert" role="alert">Choose up to 2 active partners as deputies.</p>}
      {!compact && <p className="hint">Staff, managers and front desk use approved PCs on your office internet connection. You and partners can use InboxCA anywhere.</p>}
      {office.on && !compact && <p className={here ? "notice" : "alert"} role="status">{here ? "On. You are on your office internet connection now." : "On. Waiting for your firm to confirm the office internet connection."}</p>}
      {office.on && requests?.map((request) => {
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
              <button className="b b-primary b-small" name="intent" value="confirm">This is my office</button>
              <button className="b b-secondary b-small" name="intent" value="today">Allow this network today</button>
            </>}
            <button className="b b-ghost b-small" name="intent" value="refuse">Not my office</button>
          </form>
        </div>;
      })}
      {refusals.map((entry) => <p className="alert" key={entry.actor_id}>{personName(emails.get(entry.actor_id ?? ""))} tried to use InboxCA from outside the office today.</p>)}
      {compact && !owner && !!waiting.length && <p>{waiting.length} PCs are waiting for approval. <Link href="/app/settings#office">Approve PCs</Link></p>}
      {!compact && <>
        {office.on && !!waiting.length && <div className="device-list">
          <h3 className="sub-head">PCs waiting for approval</h3>
          <ul className="rows">{waiting.map((pc) => {
            const seen = first.get(pc.id);
            const date = seen?.at ? new Date(seen.at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : today;
            return <li key={pc.id}>
              <span className="grow"><strong>{personName(emails.get(seen?.actor_id ?? ""))} on {pc.name}</strong>, first seen {date === today ? "today" : `on ${dueLabel(date)}`}</span>
              <form action={reviewDevice} className="end">
                <input type="hidden" name="device" value={pc.id} />
                <button className="b b-primary b-small" name="decision" value="office">Stays in the office</button>
                <button className="b b-secondary b-small" name="decision" value="laptop">Laptop</button>
                <button className="b b-ghost b-small" name="decision" value="refuse">Refuse</button>
              </form>
            </li>;
          })}</ul>
          {waiting.length > 1 && <form action={reviewDevice}><button className="b b-secondary" name="decision" value="office">Approve all as staying in the office</button></form>}
        </div>}
        {office.on ? <form action={setOfficeOnly} className="form-row">
          {!here && <button className="b b-primary" name="intent" value="here">This is my office</button>}
          {owner && <><button className="b b-ghost" name="intent" value="forget">Forget office connections</button><button className="b b-secondary" name="intent" value="off">Turn off</button></>}
        </form> : owner && <form action={setOfficeOnly}>
          <fieldset className="fieldset"><legend>Are you in your office right now?</legend>
            <label className="check"><input type="radio" name="here" value="yes" defaultChecked />Yes, this is my office</label>
            <label className="check"><input type="radio" name="here" value="no" />No, I will confirm it from the office</label>
          </fieldset><button className="b b-primary" name="intent" value="on">Turn on</button>
        </form>}
        {suggestFixed && <form action={setOfficeOnly} className="fixed-suggestion">
          <p><strong>To stop these confirmations, ask your internet provider for a fixed address.</strong> Here is what to say:</p>
          <blockquote>&ldquo;Please add a static public IP to our broadband connection, account number ___. We need it for office software access.&rdquo;</blockquote>
          <p className="hint">When it is done, press Done from a PC in the office.</p>
          <span className="form-row">
            <button className="b b-primary" name="intent" value="fixed">Done</button>
            <button className="b b-ghost" name="intent" value="no_fixed">My provider doesn&apos;t offer it</button>
          </span>
        </form>}
        {owner && office.on && !suggestFixed && (office as { fixed_declined?: boolean }).fixed_declined && !trustedPc && <p className="hint">Without a fixed connection, mark one desktop in the office as Stays in the office and name a deputy, so a changed connection is confirmed without you.</p>}
        {owner && office.on && !suggestFixed && <form action={setOfficeOnly}>
          <p className="hint">If your internet provider gave your office a fixed connection, confirm it here from the office.</p>
          <button className="b b-secondary" name="intent" value="fixed">Done</button>
        </form>}
        {owner && <form action={setOfficeOnly}>
          <fieldset className="fieldset"><legend>Name up to 2 deputies</legend>
            <p className="hint">Partners who can approve PCs and office connections when you are away. They keep using their 2 step code.</p>
            {people?.filter((person) => person.role === "partner" && person.status === "active").map((person) => <label className="check" key={person.user_id}>
              <input type="checkbox" name="deputy" value={person.user_id} defaultChecked={office.deputies?.includes(person.user_id)} />{person.email}
            </label>)}
          </fieldset><button className="b b-secondary" name="intent" value="deputies">Save deputies</button>
        </form>}
        {owner && office.on && <div className="side-doors"><h3 className="sub-head">Doors InboxCA cannot close for you</h3><ul>
          <li>Don&apos;t give staff the firm mailbox&apos;s password; InboxCA does the email work.</li>
          <li>Uninstall remote desktop tools such as AnyDesk and TeamViewer from office PCs.</li>
          <li>Ask clients to send documents to the firm&apos;s email, not to staff phones.</li>
          <li>Photos of the screen cannot be blocked; every page InboxCA shows names who viewed it and when.</li>
        </ul></div>}
      </>}
    </section>
  );
}
