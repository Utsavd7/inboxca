import { PageHead } from "@/app/(app)/app/ui";
import { removePasskeys } from "../actions";
import { currentAdmin } from "../admin";
import { Passkey } from "../passkey";
import { Submit } from "../parts";

// Orelu's admins and their passkeys (PLAN.md 8.1): add one of your own, or remove another
// admin's when they lose theirs, which also signs them out.
export default async function AdminAdmins() {
  const { supabase, userId } = await currentAdmin();
  const { data: admins, error } = await supabase.rpc("admin_people");
  if (error) throw new Error(`Admin people failed: ${error.code}`);
  return (
    <>
      <PageHead title="Admins" sub="Each Orelu admin signs in with an email code, a 2 step code and a passkey." />
      <section className="admin-card" aria-label="Admins">
        {admins.map((admin) => (
          <div className="admin-row" key={admin.user_id}>
            <div className="grow">
              <strong>{admin.email}{admin.user_id === userId && " (you)"}</strong>
              <span className="sub">{admin.passkeys === 1 ? "1 passkey" : `${admin.passkeys} passkeys`}</span>
            </div>
            {admin.user_id === userId ? (
              <Passkey mode="add" button="b b-secondary" note="hint" />
            ) : (
              !!admin.passkeys && (
                <form action={removePasskeys}>
                  <input type="hidden" name="person" value={admin.user_id} />
                  <Submit>Remove passkeys</Submit>
                </form>
              )
            )}
          </div>
        ))}
      </section>
    </>
  );
}
