import { officeDeviceAccess } from "@/src/lib/office";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/src/lib/supabase";
import { TwoStepForm } from "./two-step-form";

// The second step. Firm data stays closed until this passes (the database checks it too).
export default async function TwoStep() {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal === "aal2") redirect("/app");
  const office = await officeDeviceAccess(claims.claims.sub, false);
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const ready = factors?.totp.find((factor) => factor.status === "verified");
  // Only someone with recovery codes (the owner, once downloaded) is offered one.
  const codes = ((claims.claims.app_metadata as { recovery?: string[] } | undefined)?.recovery?.length ?? 0) > 0;
  return (
    <>
      <h1>{ready ? "Enter your 2 step code" : "Set up your 2 step code"}</h1>
      {office.connectionWaiting && <p className="auth-note" role="status">Your firm has not yet approved this internet connection as the office. Enter your 2 step code to sign in.</p>}
      <TwoStepForm factorId={ready?.id} codes={codes} />
    </>
  );
}
