import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseServer } from "./supabase";

// The signed in person and their firm, for every product page and action; cached for the
// request, so the layout and the page share one lookup. Sends anyone who has not finished
// both sign in steps back to sign in. Row level security shows only active memberships,
// within office hours where the firm uses them; a person in two firms sees the first for now.
export const currentMember = cache(async () => {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const { data } = await supabase
    .from("firm_members")
    .select("firm_id, role, firms(name, settings)")
    .eq("user_id", claims.claims.sub)
    .limit(1)
    .maybeSingle();
  const membership = data
    ? {
        firmId: data.firm_id,
        firmName: data.firms?.name ?? "",
        settings: (data.firms?.settings ?? {}) as Record<string, unknown>,
        role: data.role,
      }
    : null;
  return { supabase, userId: claims.claims.sub, membership };
});
