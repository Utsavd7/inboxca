import { redirect } from "next/navigation";
import { changeGroup, manageMember } from "@/app/(app)/actions";
import { currentMember } from "@/src/lib/member";
import { invitableRoles, roleLabel } from "@/src/lib/roles";
import { InviteForm } from "./invite-form";

const statusNames: Record<string, string> = { invited: "Invited", deactivated: "Removed" };

// The firm's people. Everyone in the firm sees the list; only the owner invites, changes
// roles and removes people.
export default async function People() {
  const { supabase, userId, membership } = await currentMember();
  if (!membership) redirect("/app");
  const [{ data: people }, { data: groups }] = await Promise.all([
    supabase.rpc("firm_people", { target_firm: membership.firmId }),
    supabase.from("groups").select("id, kind, name").in("kind", ["team", "branch"]).order("name"),
  ]);
  const groupName = new Map(groups?.map((group) => [group.id, group.name]));
  // A person is in at most one team and works at most at one branch.
  const kinds = [
    { kind: "team", column: "team_id", title: "Teams", one: "team" },
    { kind: "branch", column: "branch_id", title: "Branches", one: "branch" },
  ] as const;
  const groupsOf = (kind: string) => groups?.filter((group) => group.kind === kind) ?? [];
  const size = (column: "team_id" | "branch_id", id: string) => {
    const count = people?.filter((person) => person[column] === id).length ?? 0;
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
                <form key={person.role + person.status + person.team_id + person.branch_id} action={manageMember} className="person-role">
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
                      {kinds.map(({ kind, column, one }) =>
                        groupsOf(kind).length ? (
                          <select key={kind} name={kind} defaultValue={person[column] ?? ""} aria-label={`${one[0].toUpperCase() + one.slice(1)} for ${person.email}`}>
                            <option value="">No {one}</option>
                            {groupsOf(kind).map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                          </select>
                        ) : null,
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
                  {person.branch_id && groupName.get(person.branch_id)}
                  {person.team_id && groupName.get(person.team_id)}
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
      {kinds.map(({ kind, column, title, one }) =>
        isOwner || groupsOf(kind).length ? (
          <section key={kind} className="app-card" aria-labelledby={title.toLowerCase()}>
            <h2 id={title.toLowerCase()}>{title}</h2>
            <ul className="app-list">
              {groupsOf(kind).map((group) => (
                <li key={group.id}>
                  <span className="person">{group.name}</span>
                  <span className="person-role">
                    {size(column, group.id)}
                    {isOwner && (
                      <form action={changeGroup}>
                        <input type="hidden" name="kind" value={kind} />
                        <input type="hidden" name="group" value={group.id} />
                        <button className="btn btn-quiet" name="intent" value="remove">
                          Remove {one}
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {isOwner && (
              <form action={changeGroup} className="app-form-row">
                <input type="hidden" name="kind" value={kind} />
                <div>
                  <label htmlFor={`${kind}-name`}>New {one}</label>
                  <input id={`${kind}-name`} name="name" required maxLength={120} />
                </div>
                <button className="btn btn-quiet" type="submit">
                  Add {one}
                </button>
              </form>
            )}
          </section>
        ) : null,
      )}
      {isOwner && <InviteForm />}
    </>
  );
}
