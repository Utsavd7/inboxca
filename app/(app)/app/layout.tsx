import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { currentMember } from "@/src/lib/member";
import { pagesFor, roleLabel } from "@/src/lib/roles";
import "./app.css";
import { ClosingWatch } from "./closing-watch";
import { Command } from "./command";
import { IdleWatch } from "./idle-watch";
import { NavLinks } from "./nav-links";
import { PageIn } from "./page-in";
import { Avatar } from "./ui";

export const metadata: Metadata = {
  title: "InboxCA",
  robots: { index: false, follow: false },
};

// The app's frame: a quiet rail with the firm, search, the pages this person's role uses
// and who is signed in; each page sits on one white panel beside it.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, membership } = await currentMember();
  const [{ count: waiting }, { data: auth }] = await Promise.all([
    membership
      ? supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    supabase.auth.getUser(),
  ]);
  const email = auth.user?.email ?? "";
  const role = membership?.role ?? "";
  return (
    <div className="ui">
      <aside className="rail">
        <div className="rail-firm">
          <Avatar name={membership?.firmName ?? "InboxCA"} square />
          <span>
            <strong>{membership?.firmName ?? "InboxCA"}</strong>
            <small>InboxCA</small>
          </span>
        </div>
        {membership && <Command pages={pagesFor(role)} />}
        {membership && (
          <nav className="rail-nav" aria-label="InboxCA">
            <NavLinks role={role} waiting={waiting ?? 0} />
          </nav>
        )}
        <div className="rail-me">
          <Avatar name={email || "?"} />
          <span>
            <strong title={email}>{email}</strong>
            {membership && <small>{roleLabel(role)}</small>}
          </span>
          <form action={signOut} style={{ marginLeft: "auto" }}>
            <button className="b b-ghost b-icon" type="submit" aria-label="Sign out" title="Sign out and lock this PC">
              <LogOut size={16} aria-hidden />
            </button>
          </form>
        </div>
      </aside>
      <main className="stage">
        <div className="stage-panel">
          <div className="stage-body">
            {membership?.closing && <ClosingWatch at={membership.closing.at} close={membership.closing.close} extended={membership.closing.extended} />}
            <PageIn>{children}</PageIn>
          </div>
        </div>
      </main>
      {!!membership?.idleMinutes && <IdleWatch minutes={membership.idleMinutes} />}
    </div>
  );
}
