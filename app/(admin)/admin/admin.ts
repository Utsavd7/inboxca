import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { supabaseAdmin, supabaseServer } from "@/src/lib/supabase";

// The passkey proof for this session (PLAN.md 8.1), made by the server after a passkey check and
// sent to the database with every console request.
export const PROOF_COOKIE = "orelu_admin_proof";

// A listed admin past the 2 step code, before the passkey check. Anyone else meets a missing page.
export async function listedAdmin() {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const userId = claims.claims.sub;
  const { data: listed } = await supabaseAdmin().from("orelu_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (!listed) notFound();
  return { userId, session: String(claims.claims.session_id ?? ""), email: String(claims.claims.email ?? "") };
}

// The signed in Orelu admin with a passkey checked in this session, for every admin page and
// action. The database's admin functions refuse anyone else again.
export const currentAdmin = cache(async () => {
  const proof = (await cookies()).get(PROOF_COOKIE)?.value;
  const supabase = await supabaseServer(proof ? { "x-orelu-admin": proof } : undefined);
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const { data: admin } = await supabase.rpc("is_orelu_admin");
  if (!admin) {
    await listedAdmin();
    redirect("/sign-in/passkey");
  }
  return { supabase, userId: claims.claims.sub, email: String(claims.claims.email ?? "") };
});

// "25 Oct, 09:30" in India time.
export const when = (at: string | null) =>
  at ? new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "Never";
