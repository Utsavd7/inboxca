import Link from "next/link";
import { recoverComputer, signOut } from "@/app/(auth)/actions";
import { removeComputer, reviewOwnerDevice } from "@/app/(app)/actions";
import { currentMember } from "@/src/lib/member";
import { ASK_MINUTES, computersOf, thisComputer } from "@/src/lib/owner-device";
import { supabaseAdmin } from "@/src/lib/supabase";
import { Pending } from "./pending";
import { PageHead } from "./ui";

// New computers on the owner's login (PLAN.md D38), for the owner on a computer already signed
// in: one card on Today and in Settings, Office and sign in, with Approve and Refuse.
const problems: Record<string, string> = {
  phone: "Approve new computers from a laptop or desktop, not a phone.",
  computer_ended: "That request has ended. The new computer can sign in again to ask again.",
};
export async function NewComputers({ error = "", back = "" }: { error?: string; back?: "settings" | "" }) {
  const { supabase, membership } = await currentMember();
  if (membership?.role !== "owner") return null;
  const { data: asks } = await supabase.from("requests").select("id, details").eq("kind", "alert").eq("entity_type", "owner_device").eq("status", "pending").gt("expires_at", new Date().toISOString()).limit(5);
  return (
    <>
      {problems[error] && <p className="alert" role="alert">{problems[error]}</p>}
      {asks?.map((ask) => {
        const { name, at } = ask.details as { name?: string; at?: string };
        const time = at ? new Date(at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "";
        return (
          <div className="notice" role="region" aria-label="New computer" key={ask.id}>
            <span className="grow"><strong>A new computer wants to use your login:</strong> {name}{time && `, at ${time}`}. Approve it only if it is yours.</span>
            <form action={reviewOwnerDevice} className="form-row">
              <input type="hidden" name="request" value={ask.id} />
              {back && <input type="hidden" name="back" value={back} />}
              <Pending className="b b-primary b-small" name="decision" value="approve">Approve</Pending>
              <Pending className="b b-ghost b-small" name="decision" value="refuse">Refuse</Pending>
            </form>
          </div>
        );
      })}
    </>
  );
}

// The computers approved for the owner's login, by when each was approved, this one marked. Any
// other can be removed: as a session cannot be traced to its computer, every other computer is
// signed out too.
export async function YourComputers() {
  const { userId } = await currentMember();
  const [{ data }, mine] = await Promise.all([supabaseAdmin().auth.admin.getUserById(userId), thisComputer(userId)]);
  const computers = computersOf(data.user?.app_metadata.devices).slice().reverse();
  const when = (at: string) => at ? new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  return (
    <ul className="rows">
      {computers.map((computer) => (
        <li key={computer.id}>
          <span className="grow"><strong>{computer.id === mine ? "This computer" : "Another computer"}</strong>, approved {when(computer.at)}</span>
          {computer.id !== mine && (
            <form action={removeComputer}>
              <input type="hidden" name="computer" value={computer.id} />
              <Pending className="b b-ghost b-small">Remove and sign out other computers</Pending>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

// What the new computer shows meanwhile: nothing of the firm. With no other computer, one of the
// owner's recovery codes lets it in (5.17.4 #23), as for a lost phone.
const recoveryErrors: Record<string, string> = {
  recovery: "That recovery code did not work. Check it, or use another one.",
  recovery_limit: "Too many tries. Wait an hour, then try again.",
};
export function ComputerWaits({ state, codes, error = "" }: { state: "waiting" | "refused" | "ended"; codes: boolean; error?: string }) {
  return (
    <>
      <PageHead
        title={state === "waiting" ? "Approve this computer from a computer already signed in" : state === "refused" ? "This computer was refused" : "This request has ended"}
        sub={state === "waiting"
          ? `This computer is new for your login. On a computer where you already use InboxCA, choose Approve on Today. We emailed you too. The request ends in ${ASK_MINUTES} minutes.`
          : state === "refused" ? "Your other computer refused it. If that was a mistake, sign out, sign in again here and approve it." : `It was not approved in ${ASK_MINUTES} minutes. Sign out, then sign in again here to ask again.`}
      />
      {state === "waiting" ? <div className="form-row"><Link className="b b-primary" href="/app">I approved it</Link></div> : <form action={signOut} className="form-row"><Pending className="b b-secondary">Sign out</Pending></form>}
      {codes && state !== "refused" && (
        <details className="reveal" open={!!recoveryErrors[error]}>
          <summary>No other computer? Use a recovery code</summary>
          <form action={recoverComputer} className="form-row">
            <div>
              <label htmlFor="recovery">Recovery code</label>
              <input id="recovery" name="recovery" autoComplete="off" required aria-invalid={!!recoveryErrors[error]} />
            </div>
            <Pending className="b b-secondary">Use recovery code</Pending>
          </form>
          {recoveryErrors[error] && <p className="alert" role="alert">{recoveryErrors[error]}</p>}
        </details>
      )}
    </>
  );
}
