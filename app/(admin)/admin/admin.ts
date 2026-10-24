import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { supabaseServer } from "@/src/lib/supabase";

// The signed in Orelu admin, for every admin page and action. Anyone else meets a missing
// page; the database's admin functions refuse them again.
export const currentAdmin = cache(async () => {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const { data: admin } = await supabase.rpc("is_orelu_admin");
  if (!admin) notFound();
  return { supabase, email: String(claims.claims.email ?? "") };
});

// "25 Oct, 09:30" in India time.
export const when = (at: string | null) =>
  at ? new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "Never";
