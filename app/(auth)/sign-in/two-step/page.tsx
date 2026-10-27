import { officeDeviceAccess } from "@/src/lib/office";
import { redirect } from "next/navigation";
import { Passkey } from "@/app/(admin)/admin/passkey";
import { PASSKEY_FACTOR } from "@/src/lib/sign-in";
import { supabaseAdmin, supabaseServer } from "@/src/lib/supabase";
import { TwoStepForm } from "./two-step-form";

// The second step. Firm data stays closed until this passes (the database checks it too). Someone
// with a passkey may use it in place of the 6 digit code (PLAN.md 5.17, 8.5).
export default async function TwoStep() {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal === "aal2") redirect("/app");
  const office = await officeDeviceAccess(claims.claims.sub, false);
  const [{ data: factors }, { count: passkeys }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabaseAdmin().from("passkeys").select("id", { count: "exact", head: true }).eq("user_id", claims.claims.sub),
  ]);
  // A passkey's own factor is answered only by the server, after the passkey.
  const ready = factors?.totp.find((factor) => factor.status === "verified" && !factor.friendly_name?.startsWith(PASSKEY_FACTOR));
  // Only someone with recovery codes (the owner, once downloaded) is offered one.
  const codes = ((claims.claims.app_metadata as { recovery?: string[] } | undefined)?.recovery?.length ?? 0) > 0;
  return (
    <>
      <h1>{passkeys ? "Confirm it is you" : ready ? "Enter your 2 step code" : "Set up your 2 step code"}</h1>
      {office.connectionWaiting && <p className="auth-note" role="status">Your firm has not yet approved this internet connection as the office. Enter your 2 step code to sign in.</p>}
      {!!passkeys && (
        <>
          <div className="auth-form">
            <Passkey mode="check" kind="person" button="btn" note="field-error" />
          </div>
          <p className="auth-or">or enter the 6 digit code</p>
        </>
      )}
      <TwoStepForm factorId={ready?.id} codes={codes} />
    </>
  );
}
