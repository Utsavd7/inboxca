import { redirect } from "next/navigation";
import { changeTeam, manageMember } from "@/app/(app)/actions";
import { currentMember } from "@/src/lib/member";
import { invitableRoles, roleLabel } from "@/src/lib/roles";
import { InviteForm } from "./invite-form";

const statusNames: Record<string, string> = { invited: "Invited", deactivated: "Removed" };

// The firm's people. Everyone in the firm sees the list; only the owner invites, changes
// roles and removes people.
export default async function People() {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ data: people }, { data: teams }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, name").eq("kind", "team").order("name"),
  ]);
  const teamName = new Map(teams?.map((team) => [team.id, team.name]));
  const teamSize = (id: string) => {
    const count = people?.filter((person) => person.team_id === id).length ?? 0;
    return `${count} ${count === 1 ? "person" : "people"}`;
  };
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
                <form key={person.role + person.status + person.team_id} action={manageMember} className="person-role">
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
                      {!!teams?.length && (
                        <select name="team" defaultValue={person.team_id ?? ""} aria-label={`Team for ${person.email}`}>
                          <option value="">No team</option>
                          {teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button className="btn btn-quiet" name="intent" value="role">
                        Save
                      </button>
                      <button className="btn btn-quiet" name="intent" value="remove">
                        {person.status === "invited" ? "Withdraw invite" : "Remove"}
                      </button>
                    </>
                  )}
                </form>
              ) : (
                <span className="person-role">
                  {person.team_id && teamName.get(person.team_id)}
                  {roleLabel(person.role)}
                  {statusNames[person.status] && (
                    <span className={`tag tag-${person.status}`}>{statusNames[person.status]}</span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      {(isOwner || !!teams?.length) && (
        <section className="app-card" aria-labelledby="teams">
          <h2 id="teams">Teams</h2>
          <ul className="app-list">
            {teams?.map((team) => (
              <li key={team.id}>
                <span className="person">{team.name}</span>
                <span className="person-role">
                  {teamSize(team.id)}
                  {isOwner && (
                    <form action={changeTeam}>
                      <input type="hidden" name="team" value={team.id} />
                      <button className="btn btn-quiet" name="intent" value="remove">
                        Remove team
                      </button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {isOwner && (
            <form action={changeTeam} className="app-form-row">
              <div>
                <label htmlFor="team-name">New team</label>
                <input id="team-name" name="name" required maxLength={120} />
              </div>
              <button className="btn btn-quiet" type="submit">
                Add team
              </button>
            </form>
          )}
        </section>
      )}
      {isOwner && <InviteForm />}
    </>
  );
}
