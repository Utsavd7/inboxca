import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { signOut } from "@/app/(auth)/actions";
import { roleLabel } from "@/src/lib/roles";
import { IdleWatch } from "./idle-watch";
import { NavLinks } from "./nav-links";
import { currentMember } from "@/src/lib/member";

export const metadata: Metadata = {
  title: "InboxCA",
  robots: { index: false, follow: false },
};

// The app's frame: a sidebar with the pages this person's role uses, their firm and role,
// and sign out; the page itself beside it.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, membership } = await currentMember();
  const { count: waiting } = membership
    ? await supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending")
    : { count: 0 };
  return (
    <div className="app-page">
      <aside className="app-side">
        <Logo light />
        {membership && (
          <nav className="app-nav" aria-label="InboxCA">
            <NavLinks role={membership.role} waiting={waiting ?? 0} />
          </nav>
        )}
        <div className="app-me">
          {membership && (
            <span>
              <strong>{membership.firmName}</strong>
              <small>{roleLabel(membership.role)}</small>
            </span>
          )}
          <form action={signOut}>
            <button className="app-icon-button" type="submit" aria-label="Sign out" title="Sign out">
              <LogOut size={17} aria-hidden />
            </button>
          </form>
        </div>
      </aside>
      <main className="app-body">{children}</main>
      {!!membership?.idleMinutes && <IdleWatch minutes={membership.idleMinutes} />}
    </div>
  );
}
