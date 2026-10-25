import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { cookies } from "next/headers";
import { signOut } from "@/app/(auth)/actions";
import { longDate } from "@/src/lib/hours";
import { currentMember, myQuestions } from "@/src/lib/member";
import { canManageClients } from "@/src/lib/clients";
import { pagesFor, roleLabel } from "@/src/lib/roles";
import "./app.css";
import { ClosingWatch } from "./closing-watch";
import { Command } from "./command";
import { IdleWatch } from "./idle-watch";
import { NavLinks } from "./nav-links";
import { PageIn } from "./page-in";
import { PcKey } from "./pc-key";
import { Avatar } from "./ui";
import { Bell, NewMenu } from "./ui-client";

export const metadata: Metadata = {
  title: "InboxCA",
  robots: { index: false, follow: false },
};

const fortnightAgo = () => new Date(Date.now() - 14 * 86_400_000).toISOString();

// The app's frame: the navy rail with the firm, New, search, the pages this person's role
// uses, the bell and who is signed in; each page sits on the canvas beside it.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, membership, pcKey } = await currentMember();
  // The bell's dot: something on this person's clients since they last opened it (14 days at most).
  const seen = (await cookies()).get("bell_seen")?.value;
  const since = seen && !Number.isNaN(Date.parse(seen)) ? seen : fortnightAgo();
  // The Inbox's count: emails waiting for a reply and the questions this person answers.
  const [{ count: replies }, questions, { data: auth }, { data: lately }] = await Promise.all([
    membership
      ? supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    myQuestions(),
    supabase.auth.getUser(),
    membership ? supabase.rpc("activity_feed", { target_firm: membership.firmId, since, mine: true }).limit(1) : Promise.resolve({ data: [] }),
  ]);
  const waiting = (replies ?? 0) + questions.length;
  const email = auth.user?.email ?? "";
  const role = membership?.role ?? "";
  const write = !!membership && !membership.viewOnlyUntil;
  const manage = write && canManageClients(role);
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
        {membership && (
          <div className="rail-tools">
            <NewMenu manage={manage} write={write} />
            <Command pages={pagesFor(role)} manage={manage} write={write} />
          </div>
        )}
        {membership && (
          <nav className="rail-nav" aria-label="InboxCA">
            <NavLinks role={role} waiting={waiting} place="main" />
          </nav>
        )}
        {membership && (
          <nav className="rail-nav rail-foot" aria-label="Firm">
            <NavLinks role={role} waiting={0} place="foot" />
          </nav>
        )}
        <div className="rail-me">
          <Avatar name={email || "?"} />
          <span>
            <strong title={email}>{email}</strong>
            {membership && <small>{roleLabel(role)}</small>}
          </span>
          {membership && <Bell fresh={!!questions.length || !!lately?.length} />}
          <form action={signOut} style={membership ? undefined : { marginLeft: "auto" }}>
            <button className="b b-ghost b-icon" type="submit" aria-label="Sign out" title="Sign out and lock this PC">
              <LogOut size={16} aria-hidden />
            </button>
          </form>
        </div>
      </aside>
      <main className="stage">
        <div className="stage-panel">
          <div className="stage-body">
            {membership && pcKey === "needed" && (
              <div className="notice">
                <span className="grow">The owner marked this PC as staying in the office. Set up its key once, so it can confirm a new office internet connection by itself.</span>
                <PcKey mode="setup" />
              </div>
            )}
            {membership?.viewOnlyUntil && (
              <p className="notice" role="status">
                Away from the office this device only views, until {longDate(membership.viewOnlyUntil)}.
              </p>
            )}
            {membership?.closing && <ClosingWatch at={membership.closing.at} close={membership.closing.close} extended={membership.closing.extended} />}
            <PageIn>{children}</PageIn>
          </div>
        </div>
      </main>
      {!!membership?.idleMinutes && <IdleWatch minutes={membership.idleMinutes} />}
    </div>
  );
}
