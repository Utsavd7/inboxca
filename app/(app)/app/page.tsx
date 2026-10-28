import { CalendarDays, KeyRound, ListChecks, Rocket, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { askAwayDevice, joinFirm } from "@/app/(app)/actions";
import { signOut } from "@/app/(auth)/actions";
import { PcKey } from "./pc-key";
import { canManageClients } from "@/src/lib/clients";
import { todayInIndia } from "@/src/lib/calendar";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { personName, roleNames } from "@/src/lib/roles";
import { isLead } from "@/src/lib/work/today";
import { OfficePanel } from "./office-panel";
import { ComputerWaits, problems } from "./new-computers";
import { GovLine } from "./gov-line";
import { DroppedNotice, PortalDrop } from "./portal-drop";
import { Count, Presence, Press } from "./motion";
import { Pending } from "./pending";
import { attention, weekFor, workFor } from "./work-data";
import { WorkRows } from "./work-rows";
import { Card, PageHead, SidePanel, Toast } from "./ui";
import { PlanFit } from "./settings/billing";
import { WarmLink } from "./ui-client";
import "./today.css";

// Today shows this many of the person's list; See all opens the rest.
const SHOWN = 7;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

type Params = { dropped?: string; error?: string; asked?: string; panel?: string };
type Context = Parameters<typeof workFor>[0];

// Today, one screen for each person whatever the firm's size (PLAN.md "Today by role"): a
// greeting with how many things need them, at most two lines about the firm (Attention), their
// list (what waits for their yes first, at most 7 in all, most urgent first, See all for the
// rest) and this week in a few numbers, each opening its list. The owner and partners see the
// firm, a manager their team and what waits for their approval, staff and front desk their own
// clients. Every query starts at once and each part shows as soon as its data is in.
export default async function AppHome({ searchParams }: { searchParams: Promise<Params> }) {
  const { dropped, error, asked, panel } = await searchParams;
  const { supabase, userId, membership, deviceStatus, connectionWaiting, pcKey, ownerDevice } = await currentMember();
  if (ownerDevice) return <ComputerWaits state={ownerDevice} codes={!!((await supabase.auth.getClaims()).data?.claims.app_metadata as { recovery?: string[] } | undefined)?.recovery?.length} error={error} />;
  if (!membership) {
    const [{ data: invites }, { data: closedFirms }] = await Promise.all([supabase.rpc("my_invites"), supabase.rpc("closed_firms")]);
    const closed = closedFirms?.[0];
    if (closed?.reason === "session") redirect("/auth/sign-out?reason=session");
    return <NoFirm closed={closed} invites={invites ?? []} deviceStatus={deviceStatus} connectionWaiting={connectionWaiting} pcKey={pcKey} />;
  }
  const ctx = { supabase, membership, userId };
  const work = workFor(ctx, SHOWN);
  const week = weekFor(ctx, work);
  const portal = membership.may("portal_files");
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="today">
      <PageHead
        title="Today"
        sub={
          <p className="greet">
            <strong>
              {greeting}, {membership.name}.
            </strong>{" "}
            {new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}.{" "}
            <Suspense fallback={<span className="greet-wait">Looking at what needs you</span>}>
              <Things work={work} />
            </Suspense>
          </p>
        }
        actions={
          <>
            {/* Add portal files is in the sidebar's New menu. */}
            {!membership.viewOnlyUntil && (
              <Link className="b b-secondary" href="/app/documents?upload=1">
                Upload papers
              </Link>
            )}
            {canManageClients(membership.role) && (
              <Link className="b b-primary" href="/app/clients?panel=add">
                New client
              </Link>
            )}
          </>
        }
      />

      {asked === "time" && <Toast>The owner is asked for more time today. You can keep working until closing.</Toast>}
      <DroppedNotice value={dropped} />
      {error && (todayErrors[error] ?? problems[error]) && (
        <p className="alert" role="alert">
          {todayErrors[error] ?? problems[error]}
        </p>
      )}
      <Suspense fallback={null}>
        <Attention ctx={ctx} />
      </Suspense>

      <div className="today-grid">
        <Suspense fallback={<CardSkeleton title="Your list" rows={5} />}>
          <YourList work={work} ctx={ctx} />
        </Suspense>
        <Suspense fallback={<CardSkeleton title="This week" rows={3} />}>
          <ThisWeek week={week} role={membership.role} />
        </Suspense>
      </div>

      <Presence>
        {portal && panel === "portal" && (
          <SidePanel key="portal" id="portal-title" title="Files from the GST portal" close="/app">
            <PortalDrop />
          </SidePanel>
        )}
      </Presence>
    </div>
  );
}

const todayErrors: Record<string, string> = {
  view_only: "This device can only view. Make changes from the office.",
  billing: "Your firm can only view until its plan is paid. The owner can pay in Settings, Billing.",
  drive: "Connect the firm's drive in Settings first; portal files are saved there.",
};

// The greeting's end: how many things need this person.
async function Things({ work }: { work: ReturnType<typeof workFor> }) {
  const { total } = await work;
  return <span>{total ? `${plural(total, "thing needs", "things need")} you.` : "Nothing needs you today."}</span>;
}

// At most two lines above the list (work-data.ts attention): the firm's email or drive not
// working, this office PC to set up, setup still to do, what is new from the government; then,
// while there is room, who was kept out of the office today and the plan's fit.
async function Attention({ ctx }: { ctx: Context }) {
  const { membership } = ctx;
  const [{ lines, setup, owner }, office, plan] = await Promise.all([
    attention(ctx),
    OfficePanel({ compact: true }),
    membership.role === "owner" ? PlanFit({ firmId: membership.firmId }) : null,
  ]);
  const room = 2 - lines.length;
  return (
    <>
      {lines.includes("mail") && (
        <div className="today-line is-bad" role="alert">
          <TriangleAlert size={16} aria-hidden />
          <span className="grow">Connect your firm&apos;s email again. Replies wait until it is connected.</span>
          <Link className="b b-secondary b-small" href="/app/settings#mailbox">
            Reconnect email
          </Link>
        </div>
      )}
      {lines.includes("drive") && (
        <div className="today-line is-bad" role="alert">
          <TriangleAlert size={16} aria-hidden />
          <span className="grow">InboxCA cannot reach your drive. New files wait up to 7 days.</span>
          {owner && (
            <Link className="b b-secondary b-small" href="/app/settings?group=email#drive">
              Open drive settings
            </Link>
          )}
        </div>
      )}
      {lines.includes("pc") && (
        <div className="today-line today-pc" role="region" aria-label="Set up this office PC">
          <KeyRound size={16} aria-hidden />
          <span className="grow">
            <strong>Set up this office PC.</strong> One check with its PIN or fingerprint, then it confirms a new office internet connection by itself.
          </span>
          <PcKey mode="setup" />
        </div>
      )}
      {lines.includes("setup") && setup && (
        <div className="today-line" role="region" aria-label="Setup">
          <Rocket size={16} aria-hidden />
          <span className="grow">
            <strong>Setup:</strong> {setup.done} of {setup.total} done.
          </span>
          <span className="today-setup-bar" role="progressbar" aria-label="Setup done" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.done}>
            <span style={{ width: `${(setup.done * 100) / setup.total}%` }} />
          </span>
          <Link className="b b-primary b-small" href={setup.next.href}>
            {setup.next.action}
          </Link>
        </div>
      )}
      {lines.includes("gov") && <GovLine />}
      {room > 0 && (office ?? plan)}
      {room > 1 && office && plan}
    </>
  );
}

// Your list: the first 7 of everything that needs this person, most urgent first.
async function YourList({ work, ctx }: { work: ReturnType<typeof workFor>; ctx: Context }) {
  const { items, total } = await work;
  const today = todayInIndia();
  const shown = items.slice(0, SHOWN);
  const red = shown.some((item) => item.urgent || (!!item.due && item.due < today));
  return (
    <Card id="t-list" title="Your list" Icon={ListChecks} kind="approve" count={total} countTone={red ? "late" : "blue"} className="today-list">
      {shown.length ? (
        <WorkRows name="today" items={shown} today={today} membership={ctx.membership} />
      ) : (
        <Calm title="You are all caught up" line="Nothing waits for you. New work for your clients shows here first." />
      )}
      {total > SHOWN && (
        <div className="app-card-foot">
          <WarmLink className="b b-ghost b-small" href="/app/work">
            See all {total.toLocaleString("en-IN")}
          </WarmLink>
        </div>
      )}
    </Card>
  );
}

// This week in three or four numbers for the person's role, each opening its list.
async function ThisWeek({ week, role }: { week: ReturnType<typeof weekFor>; role: string }) {
  const { range, mail, late, approve, stuck, busiest } = await week;
  const tiles = isLead(role) ? (
    <>
      <Tile id="w-month" href="/app/calendar?view=month" label="Returns this month" value={range.filed} of={range.due} sub={range.due ? "filed" : "None due this month"} />
      <Tile id="w-late" href="/app/work?show=late" label="Late" value={late} red={!!late} sub={late ? `${late === 1 ? "client has" : "clients have"} a late return` : "No client is late"} />
      <div className="week-tile week-mail">
        <span className="week-label">Emails this week</span>
        {mail &&
          (
            [
              ["status=answered", "Answered by InboxCA", mail.answered],
              ["status=replied", "By your team", mail.replied],
              ["status=reply", "Waiting", mail.waiting],
            ] as const
          ).map(([filter, label, value]) => (
            <Link key={filter} href={`/app/inbox?when=week&${filter}`}>
              <strong>
                <Count id={`w-${filter}`} value={value} />
              </strong>{" "}
              {label}
            </Link>
          ))}
      </div>
      <Tile id="w-papers" href="/app/clients?show=missing" label="Waiting for papers" value={range.waiting} sub={`${range.waiting === 1 ? "client" : "clients"} asked, not all in`} />
    </>
  ) : role === "manager" ? (
    <>
      <Tile id="w-team" href="/app/calendar?view=week" label="Team returns this week" value={range.filed} of={range.due} sub={range.due ? "filed" : "None due this week"} />
      <Tile id="w-approve" href="/app/work?show=approvals" label="Drafts to approve" value={approve} sub={approve ? "Checked and ready" : "None waiting"} />
      <Tile id="w-stuck" href="/app/work" label="Stuck" value={stuck} red={!!stuck} sub="Near the due date, waiting for papers or checks" />
      <div className="week-tile week-people">
        <Link className="week-label" href="/app/people">
          Busiest people
        </Link>{" "}
        {!busiest ? (
          <span className="week-sub">Could not load this just now</span>
        ) : busiest.length ? (
          <ol>
            {busiest.map((person) => (
              <li key={person.id}>
                <span className="grow">{personName(person.email)}</span>
                <span>{plural(person.returns, "return", "returns")}</span>
              </li>
            ))}
          </ol>
        ) : (
          <span className="week-sub">No returns open in your team this week</span>
        )}
      </div>
    </>
  ) : role === "front_desk" ? (
    <>
      <Tile id="w-reply" href="/app/inbox?when=week&status=reply" label="Waiting for a reply" value={mail?.waiting ?? 0} sub="Emails this week" />
      <Tile id="w-answered" href="/app/inbox?when=week&status=answered" label="Answered by InboxCA" value={mail?.answered ?? 0} sub="Emails this week" />
      <Tile id="w-papers" href="/app/clients?show=missing" label="Waiting on clients" value={range.waiting} sub={`${range.waiting === 1 ? "client" : "clients"} asked for papers`} />
    </>
  ) : (
    <>
      <Tile id="w-mine" href="/app/calendar?view=week" label="Your returns this week" value={range.filed} of={range.due} sub={range.due ? "filed" : "None due this week"} />
      <Tile id="w-papers" href="/app/clients?show=missing" label="Waiting on clients" value={range.waiting} sub={`${range.waiting === 1 ? "client" : "clients"} asked for papers`} />
      <Tile id="w-answered" href="/app/inbox?when=week&status=answered" label="Answered by InboxCA" value={mail?.answered ?? 0} sub="Emails this week" />
    </>
  );
  return (
    <Card id="t-week" title="This week" Icon={CalendarDays} kind="week" className="today-week">
      <div className="week-tiles">{tiles}</div>
    </Card>
  );
}

// With nothing due, its words alone say so, not a big 0 of 0.
function Tile({ id, href, label, value, of, sub, red = false }: { id: string; href: string; label: string; value: number; of?: number; sub: string; red?: boolean }) {
  const none = of === 0 && !value;
  return (
    <Press href={href} className={`week-tile${red ? " is-red" : ""}${none ? " is-none" : ""}`} lift>
      <span className="week-label">{label}</span>{" "}
      {!none && (
        <span className="week-big">
          <Count id={id} value={value} />
          {of !== undefined && <small> of {of.toLocaleString("en-IN")}</small>}
        </span>
      )}{" "}
      <span className="week-sub">{sub}</span>
    </Press>
  );
}

// A calm empty state: a small drawing in tint colours and one line.
function Calm({ title, line }: { title: string; line: string }) {
  return (
    <div className="today-calm">
      <svg viewBox="0 0 64 48" aria-hidden>
        <rect x="8" y="10" width="40" height="30" rx="8" className="calm-back" />
        <rect x="16" y="6" width="40" height="30" rx="8" className="calm-front" />
        <path d="M28 21l5 5 9-10" className="calm-tick" />
        <circle cx="6" cy="8" r="2" className="calm-dot" />
        <circle cx="60" cy="42" r="2.5" className="calm-dot" />
      </svg>
      <span>
        <strong>{title}</strong>
        <span className="sub">{line}</span>
      </span>
    </div>
  );
}

// The shape of a card while its data comes.
function CardSkeleton({ title, rows }: { title: string; rows: number }) {
  return (
    <section className="app-card" aria-busy="true" aria-label={`Loading ${title}`}>
      <header className="app-card-head">
        <span className="skel skel-tile" />
        <h2 className="skel-title">{title}</h2>
      </header>
      <div className="card-skel">
        {Array.from({ length: rows }, (_, row) => <span key={row} className="skel" />)}
      </div>
    </section>
  );
}

// Someone signed in who is not in a firm now, in the sign in card (layout.tsx): the office
// connection or this PC waiting, the office or its hours keeping them out, their invites, or no
// firm yet. A short title, one line, at most one action, and Sign out.
function NoFirm({ closed, invites, deviceStatus, connectionWaiting, pcKey }: { closed: { firm_name: string; hours: unknown; reason: string; away: boolean } | null | undefined; invites: { firm_id: string; firm_name: string; role: string }[]; deviceStatus: "waiting" | "refused" | null; connectionWaiting: boolean; pcKey: "needed" | "ready" | null }) {
  const gate = (title: string, line: React.ReactNode, action?: React.ReactNode) => (
    <>
      <h1>{title}</h1>
      {line && <p className="auth-lead">{line}</p>}
      {action}
      <form action={signOut} className="auth-form">
        <button className="text-button" type="submit">
          Sign out
        </button>
      </form>
    </>
  );
  if (connectionWaiting)
    return gate(
      "Waiting for the office connection",
      pcKey === "ready" ? "This PC stays in the office, so its key can confirm the new connection. The owner is told." : "Ask the owner or a deputy to confirm this connection as your office.",
      pcKey === "ready" && (
        <div className="auth-form">
          <PcKey mode="confirm" button="btn" />
        </div>
      ),
    );
  if (closed?.reason === "office" && deviceStatus)
    return deviceStatus === "waiting"
      ? gate("This PC is waiting for approval", "Ask the owner to approve it in Settings, then try again.", (
          <div className="auth-form">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a fresh load, so once approved the app's own frame replaces this card */}
            <a className="btn" href="/app">
              Try again
            </a>
          </div>
        ))
      : gate("This PC was refused", "Ask the owner if this PC should be allowed.");
  if (closed?.reason === "office")
    return gate(
      "Use InboxCA from the office",
      `${closed.firm_name} lets staff use InboxCA only in the office, on the office internet connection. If you are in the office now, ask the owner to confirm this connection.`,
      closed.away && (
        <form action={askAwayDevice} className="auth-form">
          <Pending className="btn">Ask to use this device away from the office</Pending>
          <p className="auth-small">The owner may allow it for some days, to view only.</p>
        </form>
      ),
    );
  const hours = closed && describeHours(closed.hours as Hours);
  return gate(
    closed ? `${closed.firm_name} is closed now` : invites.length ? "Join your firm" : "No firm yet",
    closed ? (hours ? `Your firm uses InboxCA during office hours: ${hours}, India time.` : "Your firm has no office hours set. Ask the owner.") : !invites.length && "Ask your firm's owner to invite you.",
    invites.length
      ? invites.map((invite) => (
          <form key={invite.firm_id} action={joinFirm} className="auth-form">
            <input type="hidden" name="firm" value={invite.firm_id} />
            <p className="auth-lead">
              <strong>{invite.firm_name}</strong> has invited you as {roleNames[invite.role]}.
            </p>
            <Pending className="btn">Join {invite.firm_name}</Pending>
          </form>
        ))
      : !closed && (
          <p className="auth-small">
            Setting up InboxCA for your own firm? <Link href="/sign-up">Set up your firm</Link>
          </p>
        ),
  );
}
