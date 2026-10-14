import { redirect } from "next/navigation";
import { supabaseServer } from "@/src/lib/supabase";
import { TwoStepForm } from "./two-step-form";

// The second step. Firm data stays closed until this passes (the database checks it too).
export default async function TwoStep() {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal === "aal2") redirect("/app");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const ready = factors?.totp.find((factor) => factor.status === "verified");
  return (
    <>
      <h1>{ready ? "Enter your 2 step code" : "Set up your 2 step code"}</h1>
      <TwoStepForm factorId={ready?.id} />
    </>
  );
}
