import { BellOff, CalendarDays, KeyRound, ListChecks, Rocket, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { askAwayDevice, joinFirm, manageClient } from "@/app/(app)/actions";
import { signOut } from "@/app/(auth)/actions";
import { PcKey } from "./pc-key";
import { canManageClients } from "@/src/lib/clients";
import { todayInIndia } from "@/src/lib/calendar";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { roleNames } from "@/src/lib/roles";
import { isLead, pickShown, todayGroups } from "@/src/lib/work/today";
import { OfficePanel } from "./office-panel";
import { ComputerWaits, problems } from "./new-computers";
import { GovLine } from "./gov-line";
import { DroppedNotice, PortalDrop } from "./portal-drop";
import { Count, Hold, Presence, Press } from "./motion";
import { Pending } from "./pending";
import { attention, queueSteps, stepQueue, weekFor, workFor, type QueueStep } from "./work-data";
import { WorkRows } from "./work-rows";
import { Card, PageHead, SidePanel, Toast } from "./ui";
import { PlanFit } from "./settings/billing";
import { WarmLink } from "./ui-client";
import "./today.css";

// Today shows this many of the person's list, so it fits a 1280 by 760 laptop; See all opens the rest.
const SHOWN = 6;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

type Params = { dropped?: string; error?: string; asked?: string; panel?: string; done?: string };
type Context = Parameters<typeof workFor>[0];

// Today, one screen for each person whatever the firm's size (PLAN.md "Today by role"): a
// greeting with how many things need them, at most two lines about the firm (Attention), their
// list in four groups (late, due this week, waiting on clients, the rest; at most 6 rows in all,
// See all for the rest) and one card of a few numbers with the returns by step, each opening its
// list. The owner and partners see the firm, a manager their team and what waits for their
// approval, staff and front desk their own clients. Every query starts at once and each part
// shows as soon as its data is in.
export default async function AppHome({ searchParams }: { searchParams: Promise<Params> }) {
  const { dropped, error, asked, panel, done } = await searchParams;
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
  // Front desk keeps to emails and papers, so has no returns by step.
  const queue = membership.role === "front_desk" ? null : stepQueue(ctx).catch(() => null);
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
      {done && <TodoDone id={done} ctx={ctx} />}
      {error && (todayErrors[error] ?? problems[error]) && (
        <p className="alert" role="alert">
          {todayErrors[error] ?? problems[error]}
        </p>
      )}
      <Suspense fallback={null}>
        <Attention ctx={ctx} />
      </Suspense>

      <div className="today-grid">
        <Suspense fallback={<Hold shown=".today-list"><CardSkeleton title="Your list" rows={5} /></Hold>}>
          <YourList work={work} ctx={ctx} />
        </Suspense>
        <Suspense fallback={<Hold shown=".today-week"><CardSkeleton title={isLead(membership.role) ? "This month" : "This week"} rows={3} /></Hold>}>
          <Numbers week={week} role={membership.role} queue={queue} />
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

// A to-do just marked done on the list, with its Undo.
async function TodoDone({ id, ctx }: { id: string; ctx: Context }) {
  const { data: todo } = /^[0-9a-f-]{36}$/.test(id) ? await ctx.supabase.from("tasks").select("client_id, details").eq("firm_id", ctx.membership.firmId).eq("id", id).eq("kind", "todo").eq("status", "closed").maybeSingle() : { data: null };
  if (!todo) return null;
  return (
    <Toast
      undo={
        <form action={manageClient}>
          <input type="hidden" name="client" value={todo.client_id} />
          <input type="hidden" name="todo" value={id} />
          <input type="hidden" name="from" value="today" />
          <Pending className="b" name="intent" value="todo-undo">Undo</Pending>
        </form>
      }
    >
      Done: {(todo.details as { title?: string }).title}.
    </Toast>
  );
}

// The greeting's end: how many things need this person.
async function Things({ work }: { work: ReturnType<typeof workFor> }) {
  const { total, failed } = await work;
  return <span>{total ? `${plural(total, "thing needs", "things need")} you.` : failed ? "Some of your list could not load." : "Nothing needs you today."}</span>;
}

// At most two lines above the list (work-data.ts attention): the firm's email or drive not
// working, this office PC to set up, setup still to do, client reminders held, what is new from
// the government; then, while there is room, who was kept out of the office today and the plan's fit.
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
      {lines.includes("held") && (
        <div className="today-line" role="region" aria-label="Client reminders">
          <BellOff size={16} aria-hidden />
          <span className="grow">
            <strong>Client reminders are paused</strong> for due dates not yet checked.
          </span>
          <Link className="b b-secondary b-small" href="/app/settings?group=reminders#due-dates">Confirm due dates</Link>
        </div>
      )}
      {lines.includes("gov") && <GovLine />}
      {room > 0 && (office ?? plan)}
      {room > 1 && office && plan}
    </>
  );
}

// Your list: what fits of everything that needs this person, in its four groups, one from each
// group first; each group says how many it has, and they add up to the count beside the title.
async function YourList({ work, ctx }: { work: ReturnType<typeof workFor>; ctx: Context }) {
  const { items, total, failed } = await work;
  const today = todayInIndia();
  const groups = pickShown(items, today, SHOWN);
  // The late clients beyond those read are late too.
  groups[0].count += total - items.length;
  const shown = groups.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <Card
      id="t-list"
      title="Your list"
      Icon={ListChecks}
      kind="approve"
      // The same number as the greeting at every moment, so it does not count up.
      count={total ? total.toLocaleString("en-IN") : null}
      countTone={groups[0].count ? "late" : "blue"}
      className="today-list"
      end={
        total > shown && (
          <WarmLink className="b b-ghost b-small" href="/app/work">
            See all {total.toLocaleString("en-IN")}
          </WarmLink>
        )
      }
    >
      {failed && <NotLoaded />}
      {shown ? (
        groups.map(({ group, count, items }) =>
          items.length ? (
            <section key={group} className={`today-group is-${group}`} aria-labelledby={`g-${group}`}>
              <h3 id={`g-${group}`}>
                {todayGroups[group]} <span>{count.toLocaleString("en-IN")}</span>
              </h3>
              <WorkRows name={`today-${group}`} items={items} today={today} membership={ctx.membership} />
            </section>
          ) : null,
        )
      ) : (
        !failed && <Calm title="You are all caught up" line="Nothing waits for you. New work for your clients shows here first." />
      )}
    </Card>
  );
}

// At most three numbers for the person's role, each opening its list: returns filed of those
// due (the firm's this month for the owner and partners, their own this week for anyone else),
// clients late, and clients asked for papers not all in; then the returns late or due in 30 days
// by the step they wait at (work-data.ts stepQueue), each opening that step on the Calendar.
// Front desk keeps to emails and papers, so sees only who has papers to send.
async function Numbers({ week, role, queue }: { week: ReturnType<typeof weekFor>; role: string; queue: Promise<Awaited<ReturnType<typeof stepQueue>> | null> | null }) {
  const { range, late } = await week;
  const lead = isLead(role);
  return (
    <Card id="t-week" title={lead ? "This month" : "This week"} Icon={CalendarDays} kind="week" className="today-week">
      {range ? (
        <div className="week-tiles">
          {role !== "front_desk" && (
            <>
              <Tile id="w-filed" href={`/app/calendar?view=${lead ? "month" : "week"}`} label="Returns filed" value={range.filed} of={range.due} />
              <Tile id="w-late" href="/app/work?show=late" label="Late clients" value={late} red={!!late} />
            </>
          )}
          <Tile id="w-papers" href="/app/clients?show=missing" label="Waiting on clients" value={range.waiting} />
        </div>
      ) : (
        <NotLoaded />
      )}
      {queue && (
        <Suspense fallback={<div className="card-skel"><span className="skel" /></div>}>
          <ByStep queue={queue} />
        </Suspense>
      )}
    </Card>
  );
}

// The five steps as one strip: a bar of how the returns spread over them, and each step's count.
async function ByStep({ queue }: { queue: Promise<Awaited<ReturnType<typeof stepQueue>> | null> }) {
  const steps = await queue;
  if (!steps) return <NotLoaded />;
  const keys = Object.keys(queueSteps) as QueueStep[];
  return (
    <nav className="step-strip" aria-label="Work by step">
      <span className="step-bar" aria-hidden>
        {keys.map((key) => <i key={key} className={`s-${key}`} style={{ flexGrow: steps.groups[key].length }} />)}
      </span>
      {keys.map((key) => (
        <Press key={key} href={`/app/calendar?step=${key}`} className="step-count" aria-label={`${queueSteps[key]}: ${steps.groups[key].length}`}>
          <strong>
            <Count id={`s-${key}`} value={steps.groups[key].length} />
          </strong>
          <span>{queueSteps[key]}</span>
        </Press>
      ))}
    </nav>
  );
}

// With nothing due, its words alone say so, not a big 0 of 0.
function Tile({ id, href, label, value, of, red = false }: { id: string; href: string; label: string; value: number; of?: number; red?: boolean }) {
  const none = of === 0 && !value;
  return (
    <Press href={href} className={`week-tile${red ? " is-red" : ""}${none ? " is-none" : ""}`} lift>
      <span className="week-big">
        {none ? (
          "None due"
        ) : (
          <>
            <Count id={id} value={value} />
            {of !== undefined && <small> of {of.toLocaleString("en-IN")}</small>}
          </>
        )}
      </span>{" "}
      <span className="week-label">{label}</span>
    </Press>
  );
}

// A card whose list could not be read (work-data.ts logs why), never shown as nothing to do.
function NotLoaded() {
  return (
    <p className="alert" role="alert">
      Could not load this. <Link href="/app">Try again</Link>
    </p>
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
