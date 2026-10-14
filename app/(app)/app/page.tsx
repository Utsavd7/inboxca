import { joinFirm } from "@/app/(app)/actions";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { roleNames } from "@/src/lib/roles";

// The signed in start page. The dashboard arrives in M10; for now it shows whose firm this
// is, and any firm that has invited this person.
export default async function AppHome() {
  const { supabase, membership } = await currentMember();
  const { data: invites } = await supabase.rpc("my_invites");
  const closed = membership ? null : (await supabase.rpc("closed_firms")).data?.[0];

  return (
    <>
      {membership ? (
        <h1>
          {membership.firmName}
          <span className="app-role">You are signed in as {roleNames[membership.role]}.</span>
        </h1>
      ) : closed ? (
        <h1>
          {closed.firm_name} is closed now.
          <span className="app-role">
            {describeHours(closed.hours as Hours)
              ? `Your firm uses InboxCA during office hours: ${describeHours(closed.hours as Hours)}, India time.`
              : "Your firm has no office hours set. Ask the owner."}
          </span>
        </h1>
      ) : invites?.length ? (
        <h1>
          Welcome to InboxCA.
          <span className="app-role">Join your firm to start.</span>
        </h1>
      ) : (
        <h1>
          You are not part of a firm yet.
          <span className="app-role">Ask your firm&apos;s owner to invite you.</span>
        </h1>
      )}
      {!!invites?.length && (
        <section className="app-card" aria-labelledby="invites">
          <h2 id="invites">Invites</h2>
          <ul className="app-list">
            {invites.map((invite) => (
              <li key={invite.firm_id}>
                <span>
                  <strong>{invite.firm_name}</strong> has invited you as {roleNames[invite.role]}.
                </span>
                <form action={joinFirm}>
                  <input type="hidden" name="firm" value={invite.firm_id} />
                  <button className="btn" type="submit">
                    Join {invite.firm_name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
