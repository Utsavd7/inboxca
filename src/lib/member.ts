import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase";

export const roleNames: Record<string, string> = {
  owner: "owner",
  partner: "partner",
  manager: "manager",
  staff: "staff",
  front_desk: "front desk",
};

// The signed in person and their firm, for every product page and action. Sends anyone
// who has not finished both sign in steps back to sign in. Row level security shows only
// active memberships; a person in two firms sees the first for now.
export async function currentMember() {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const { data } = await supabase
    .from("firm_members")
    .select("firm_id, role, firms(name)")
    .eq("user_id", claims.claims.sub)
    .limit(1)
    .maybeSingle();
  const membership = data
    ? { firmId: data.firm_id, firmName: data.firms?.name ?? "", role: data.role }
    : null;
  return { supabase, userId: claims.claims.sub, membership };
}
