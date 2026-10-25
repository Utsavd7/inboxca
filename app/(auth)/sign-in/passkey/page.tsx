import { listedAdmin } from "@/app/(admin)/admin/admin";
import { Passkey } from "@/app/(admin)/admin/passkey";
import { supabaseAdmin } from "@/src/lib/supabase";

// The third step for Orelu admins only (PLAN.md 8.1): a passkey, after the email and 2 step codes.
export default async function AdminPasskey() {
  const { userId } = await listedAdmin();
  const { count } = await supabaseAdmin().from("admin_passkeys").select("id", { count: "exact", head: true }).eq("user_id", userId);
  return (
    <>
      <h1>{count ? "Confirm with your passkey" : "Set up a passkey"}</h1>
      <p className="auth-lead">
        {count
          ? "Orelu admins confirm each sign in with a passkey. It opens the admin console for an hour."
          : "Orelu admins also sign in with a passkey: this laptop's fingerprint or PIN, your phone, or a security key. You can add more later."}
      </p>
      <div className="auth-form">
        <Passkey mode={count ? "check" : "setup"} button="btn" note="field-error" />
        {!!count && <p className="auth-small">Lost your passkey? Another Orelu admin can remove it, then you set up a new one here.</p>}
      </div>
    </>
  );
}
