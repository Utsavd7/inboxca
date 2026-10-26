import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { todayInIndia } from "@/src/lib/calendar";
import { longDate } from "@/src/lib/hours";
import { currentMember, myQuestions } from "@/src/lib/member";
import { canManageClients } from "@/src/lib/clients";
import { pagesFor, personName, roleLabel } from "@/src/lib/roles";
import { awake } from "@/src/lib/triage";
import "./app.css";
import { ClosingWatch } from "./closing-watch";
import { Command } from "./command";
import { IdleWatch } from "./idle-watch";
import { NavLinks } from "./nav-links";
import { NavProgress } from "./nav-progress";
import { PageIn } from "./page-in";
import { PcKey } from "./pc-key";
import { AccountMenu, ShellFrame, SideFoot, WorkspaceMenu, type Theme } from "./shell";
import { firmAccounts, returnsThisYear } from "./shell-data";
import { NewMenu } from "./ui-client";

export const metadata: Metadata = {
  title: "InboxCA",
  robots: { index: false, follow: false },
};

const fortnightAgo = () => new Date(Date.now() - 14 * 86_400_000).toISOString();

// The app's frame: the sidebar (the firm, New, search, the places this person's role uses, then
// use, help and who is signed in), and the stage beside it, where each page draws its own
// header and the status line sits at the foot. Only the sign in check waits; the counts, the
// owner's use and the status line arrive as they are ready.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, membership, pcKey } = await currentMember();
  const jar = await cookies();
  // Light unless the person chose Dark or System in their account menu (user, 26 Oct 2026).
  const theme = (["light", "dark", "system"].includes(jar.get("theme")?.value ?? "") ? jar.get("theme")!.value : "light") as Theme;
  // The bell's count: questions for this person, and what happened on their clients since
  // they last marked all read (14 days at most).
  const seen = jar.get("bell_seen")?.value;
  const since = seen && !Number.isNaN(Date.parse(seen)) ? seen : fortnightAgo();
  const email = membership?.email ?? String((await supabase.auth.getClaims()).data?.claims.email ?? "");
  const role = membership?.role ?? "";
  const write = !!membership && !membership.viewOnlyUntil;
  const manage = write && canManageClients(role);
  const owner = role === "owner";
  // The Inbox's count: emails waiting for a reply and the questions this person answers.
  const waiting = membership
    ? Promise.all([
        supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending").or(awake(todayInIndia())),
        myQuestions(),
      ]).then(([{ count }, questions]) => (count ?? 0) + questions.length)
    : Promise.resolve(0);
  const bell = membership
    ? Promise.all([myQuestions(), supabase.rpc("activity_feed", { target_firm: membership.firmId, since, mine: true }).limit(10)]).then(([questions, { data }]) => questions.length + (data?.length ?? 0))
    : Promise.resolve(0);
  const sidebar = (
    <aside className="side" aria-label="Sidebar">
      <WorkspaceMenu />
      {membership && (
        <div className="side-tools">
          <NewMenu manage={manage} write={write} />
          <Command pages={pagesFor(role)} manage={manage} write={write} />
        </div>
      )}
      {membership && (
        <nav className="side-nav" aria-label="InboxCA">
          <NavLinks role={role} waiting={waiting} place="main" />
          <div className="side-group">Workspace</div>
          <NavLinks role={role} place="workspace" />
        </nav>
      )}
      <div className="side-foot">
        {owner && (
          <Suspense fallback={null}>
            <Usage firm={membership!.firmId} />
          </Suspense>
        )}
        <SideFoot />
        <AccountMenu place="side" />
      </div>
    </aside>
  );
  return (
    <ShellFrame
      me={{ member: !!membership, name: personName(email), email, role: role && roleLabel(role), firm: membership?.firmName ?? "", firmId: membership?.firmId ?? "", firms: membership?.firms ?? [], owner, people: ["owner", "partner", "manager"].includes(role) }}
      theme={theme}
      rail={jar.get("side")?.value === "rail"}
      newsSeen={jar.get("news_seen")?.value ?? ""}
      bell={bell}
      sidebar={sidebar}
    >
      <main className="stage">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <div className="stage-notes">
          {membership && pcKey === "needed" && (
            <div className="notice">
              <span className="grow">The owner marked this PC as an office PC. Set it up once: this PC asks for its PIN or fingerprint. Then it can confirm a change in the office internet connection without the owner.</span>
              <PcKey mode="setup" />
            </div>
          )}
          {membership?.viewOnlyUntil && (
            <p className="notice" role="status">
              This laptop is away from the office, so it can only view papers until {longDate(membership.viewOnlyUntil)}.
            </p>
          )}
          {membership?.closing && <ClosingWatch at={membership.closing.at} close={membership.closing.close} extended={membership.closing.extended} />}
        </div>
        <div className="stage-panel">
          <div className="stage-body">
            <PageIn>{children}</PageIn>
          </div>
        </div>
        {membership && (
          <Suspense fallback={<footer className="status-bar" aria-busy="true" />}>
            <StatusLine owner={owner} reminders={membership.settings.reminders === true || membership.settings.reminders === "true"} />
          </Suspense>
        )}
      </main>
      {!!membership?.idleMinutes && <IdleWatch minutes={membership.idleMinutes} />}
    </ShellFrame>
  );
}

// The owner's returns this year, with how many are due so far as a thin bar.
async function Usage({ firm }: { firm: string }) {
  const { all, due } = await returnsThisYear(firm, todayInIndia());
  if (!all) return null;
  return (
    <Link className="side-usage" href="/app/settings?group=data#use" aria-label={`Returns this year: ${all.toLocaleString("en-IN")}, ${due.toLocaleString("en-IN")} due so far`}>
      <span>
        Returns this year <strong>{all.toLocaleString("en-IN")}</strong>
      </span>
      <span className="side-bar">
        <span style={{ width: `${Math.round((100 * due) / all)}%` }} />
      </span>
    </Link>
  );
}

// The status line: is the firm's email being read, is the drive linked (or away, while the
// drive check's alert is open), when the next reminders go, and the shortcuts key. One small
// query shared with Today, and one for the alert.
async function StatusLine({ owner, reminders }: { owner: boolean; reminders: boolean }) {
  const { supabase, membership } = await currentMember();
  const [accounts, { count: away }] = await Promise.all([
    firmAccounts(),
    supabase.from("requests").select("id", { count: "exact", head: true }).eq("firm_id", membership?.firmId ?? "").eq("kind", "alert").eq("entity_type", "drive_away").eq("status", "pending"),
  ]);
  const mail = accounts.find((account) => account.kind === "mail");
  const drive = accounts.find((account) => account.kind === "drive");
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }));
  const reading = mail?.status === "connected";
  // Something to fix is a link to its place in Settings, for the owner who can fix it.
  const fix = (text: string, href: string) => (owner ? <Link href={href}>{text}</Link> : text);
  return (
    <footer className="status-bar" aria-label="Status">
      <span>
        <span className={`foot-dot${reading ? " on" : mail ? " off" : ""}`} aria-hidden />
        {reading ? "Firm email connected, read every 2 minutes" : fix(mail ? "Firm email needs connecting again" : "Firm email not connected", "/app/settings#mailbox")}
      </span>
      <span>
        <span className={`foot-dot${drive && away ? " off" : drive ? " on" : ""}`} aria-hidden />
        {drive && away ? fix("Drive cannot be reached, new papers wait", "/app/settings#drive") : drive ? "Drive connected" : fix("Drive not connected", "/app/settings#drive")}
      </span>
      {reminders && reading && (
        <span>
          <span className="foot-dot" aria-hidden />
          Next reminders {hour < 10 ? "today" : "tomorrow"} at 10:00
        </span>
      )}
      <span className="foot-keys">
        Press <kbd>?</kbd> for shortcuts
      </span>
    </footer>
  );
}
