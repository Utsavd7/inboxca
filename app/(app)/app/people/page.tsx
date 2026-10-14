import { redirect } from "next/navigation";
import { currentMember, roleNames } from "@/src/lib/member";
import { InviteForm } from "./invite-form";

// The firm's people. Everyone in the firm sees the list; only the owner invites.
export default async function People() {
  const { supabase, membership } = await currentMember();
  if (!membership) redirect("/app");
  const { data: people } = await supabase.rpc("firm_people", { target_firm: membership.firmId });

  return (
    <>
      <h1>People</h1>
      <section className="app-card" aria-labelledby="people">
        <h2 id="people">{membership.firmName}</h2>
        <ul className="app-list">
          {people?.map((person) => (
            <li key={person.user_id}>
              <span className="person">{person.email}</span>
              <span className="person-role">
                {roleNames[person.role]}
                {person.status !== "active" && <span className={`tag tag-${person.status}`}>{person.status}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {membership.role === "owner" && <InviteForm />}
    </>
  );
}
