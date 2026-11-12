import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/src/lib/supabase";

// Once, right after an owner sets up the 2 step code (afterTwoStep): the recovery codes, so a
// lost phone does not lock the firm out. Skipping is fine; Settings, Your sign in has them too.
export default async function RecoveryCodes() {
  const { data: claims } = await (await supabaseServer()).auth.getClaims();
  if (claims?.claims.aal !== "aal2") redirect("/sign-in");
  return (
    <>
      <h1>Keep your recovery codes</h1>
      <p className="auth-lead">If you lose your phone, one of these codes signs you in.</p>
      <form action="/app/settings/recovery-codes" method="post" className="auth-form">
        <button className="btn" type="submit">Download recovery codes</button>
        <Link className="btn btn-quiet" href="/app">Continue to Today</Link>
      </form>
    </>
  );
}
