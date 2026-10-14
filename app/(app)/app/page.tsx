import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/site/logo";
import { signOut } from "@/app/(auth)/actions";
import { supabaseServer } from "@/src/lib/supabase";

export const metadata: Metadata = {
  title: "InboxCA",
  robots: { index: false, follow: false },
};

const roleNames: Record<string, string> = {
  owner: "owner",
  partner: "partner",
  manager: "manager",
  staff: "staff",
  front_desk: "front desk",
};

// The signed in start page. The dashboard arrives in M10; for now it shows whose firm this is.
export default async function AppHome() {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) redirect("/sign-in");
  if (claims.claims.aal !== "aal2") redirect("/sign-in/two-step");
  const { data: memberships } = await supabase
    .from("firm_members")
    .select("role, firms(name)")
    .eq("user_id", claims.claims.sub);

  return (
    <main className="app-page">
      <header className="app-bar">
        <Logo />
        <form action={signOut}>
          <button className="btn btn-quiet" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <section className="app-body">
        {memberships && memberships.length > 0 ? (
          memberships.map((membership) => (
            <h1 key={membership.firms?.name}>
              {membership.firms?.name}
              <span className="app-role">You are signed in as {roleNames[membership.role]}.</span>
            </h1>
          ))
        ) : (
          <h1>
            You are not part of a firm yet.
            <span className="app-role">Ask your firm&apos;s owner to invite you.</span>
          </h1>
        )}
      </section>
    </main>
  );
}
