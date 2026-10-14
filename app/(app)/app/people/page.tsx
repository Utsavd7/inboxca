import { redirect } from "next/navigation";
import { manageMember } from "@/app/(app)/actions";
import { currentMember } from "@/src/lib/member";
import { invitableRoles, roleLabel, roleNames } from "@/src/lib/roles";
import { InviteForm } from "./invite-form";

const statusNames: Record<string, string> = { invited: "invited", deactivated: "removed" };

// The firm's people. Everyone in the firm sees the list; only the owner invites, changes
// roles and removes people.
export default async function People() {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const { data: people } = await supabase.rpc("firm_people", { target_firm: membership.firmId });
  const isOwner = membership.role === "owner";

  return (
    <>
      <h1>People</h1>
      <section className="app-card" aria-labelledby="people">
        <h2 id="people">{membership.firmName}</h2>
        <ul className="app-list">
          {people?.map((person) => (
            <li key={person.user_id}>
              <span className="person">{person.email}</span>
              {isOwner && person.user_id !== userId ? (
                // Keyed on the saved values, so the form shows them after each change.
                <form key={person.role + person.status} action={manageMember} className="person-role">
                  <input type="hidden" name="person" value={person.user_id} />
                  {statusNames[person.status] && (
                    <span className={`tag tag-${person.status}`}>{statusNames[person.status]}</span>
                  )}
                  {person.status === "deactivated" ? (
                    <button className="btn btn-quiet" name="intent" value="restore">
                      Bring back
                    </button>
                  ) : (
                    <>
                      <select name="role" defaultValue={person.role} aria-label={`Role for ${person.email}`}>
                        {invitableRoles.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-quiet" name="intent" value="role">
                        Save role
                      </button>
                      <button className="btn btn-quiet" name="intent" value="remove">
                        {person.status === "invited" ? "Withdraw invite" : "Remove"}
                      </button>
                    </>
                  )}
                </form>
              ) : (
                <span className="person-role">
                  {roleNames[person.role]}
                  {statusNames[person.status] && (
                    <span className={`tag tag-${person.status}`}>{statusNames[person.status]}</span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      {isOwner && <InviteForm />}
    </>
  );
}
