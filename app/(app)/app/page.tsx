import { CalendarDays, ListChecks, Rocket, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { askAwayDevice, joinFirm } from "@/app/(app)/actions";
import { PcKey } from "./pc-key";
import { canManageClients } from "@/src/lib/clients";
import { todayInIndia } from "@/src/lib/calendar";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { personName, roleNames } from "@/src/lib/roles";
import { isLead } from "@/src/lib/work/today";
import { OfficePanel } from "./office-panel";
import { ComputerWaits, NewComputers } from "./new-computers";
import { GovLine } from "./gov-line";
import { DroppedNotice, PortalDrop } from "./portal-drop";
import { Count, Presence, Press } from "./motion";
import { Pending } from "./pending";
import { attention, weekFor, workFor } from "./work-data";
import { WorkRows } from "./work-rows";
import { Card, PageHead, SidePanel, Toast } from "./ui";
import { StartPlan, type PlanAsk } from "./settings/billing";
import { WarmLink } from "./ui-client";
import "./today.css";

// Today shows this many of the person's list; See all opens the rest.
const SHOWN = 7;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

type Params = { dropped?: string; error?: string; asked?: string; panel?: string } & PlanAsk;
type Context = Parameters<typeof workFor>[0];

// Today, one screen for each person whatever the firm's size (PLAN.md "Today by role"): a
// greeting with how many things need them, at most two lines about the firm's email, drive,
// setup or the government, their list (at most 7, most urgent first, See all for the rest) and
// this week in a few numbers, each opening its list. The owner and partners see the firm, a
// manager their team and what waits for their approval, staff and front desk their own
// clients. Every query starts at once and each part shows as soon as its data is in.
export default async function AppHome({ searchParams }: { searchParams: Promise<Params> }) {
  const { dropped, error, asked, panel, ...plan } = await searchParams;
  const { supabase, userId, membership, deviceStatus, connectionWaiting, pcKey, ownerDevice } = await currentMember();
  if (ownerDevice) return <ComputerWaits state={ownerDevice} codes={!!((await supabase.auth.getClaims()).data?.claims.app_metadata as { recovery?: string[] } | undefined)?.recovery?.length} error={error} />;
  if (!membership) {
    const [{ data: invites }, { data: closedFirms }] = await Promise.all([supabase.rpc("my_invites"), supabase.rpc("closed_firms")]);
    const closed = closedFirms?.[0];
    if (closed?.reason === "session") redirect("/auth/sign-out?reason=session");
    return <NoFirm closed={closed} invites={invites ?? []} deviceStatus={deviceStatus} connectionWaiting={connectionWaiting} pcKey={pcKey} />;
  }
  // Signed up, payments set up, nothing paid yet: the plan and AutoPay come first (5.14.1).
  if (membership.billing === "start") return (
    <div className="today">
      <PageHead title={`Welcome to InboxCA, ${personName(membership.email)}`} sub={membership.role === "owner" ? "One last step: choose your plan and set up AutoPay. Your firm starts as soon as the first payment is in." : "Your firm starts once its owner chooses a plan."} />
      {membership.role === "owner" && <StartPlan supabase={supabase} firmId={membership.firmId} ask={plan} />}
    </div>
  );
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
              {greeting}, {personName(membership.email)}.
            </strong>{" "}
            {new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}.{" "}
            <Suspense fallback={<span className="greet-wait">Looking at what needs you</span>}>
              <Things work={work} />
            </Suspense>
          </p>
        }
        actions={
          <>
            {portal && (
              <Link className="b b-secondary" href="/app?panel=portal" scroll={false}>
                Add portal files
              </Link>
            )}
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
      {error && todayErrors[error] && (
        <p className="alert" role="alert">
          {todayErrors[error]}
        </p>
      )}
      <Suspense fallback={null}>
        <NewComputers error={error} />
      </Suspense>
      <Suspense fallback={null}>
        <OfficePanel compact />
      </Suspense>
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
// working, setup still to do, what is new from the government.
async function Attention({ ctx }: { ctx: Context }) {
  const { lines, setup, owner } = await attention(ctx);
  return (
    <>
      {lines.includes("mail") && (
        <div className="today-line" role="alert">
          <TriangleAlert size={16} aria-hidden />
          <span className="grow">Connect your firm&apos;s email again. Replies wait until it is connected.</span>
          <Link className="b b-secondary b-small" href="/app/settings#mailbox">
            Reconnect email
          </Link>
        </div>
      )}
      {lines.includes("drive") && (
        <div className="today-line" role="alert">
          <TriangleAlert size={16} aria-hidden />
          <span className="grow">InboxCA cannot reach your drive. New files wait up to 7 days.</span>
          {owner && (
            <Link className="b b-secondary b-small" href="/app/settings?group=email#drive">
              Open drive settings
            </Link>
          )}
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

function Tile({ id, href, label, value, of, sub, red = false }: { id: string; href: string; label: string; value: number; of?: number; sub: string; red?: boolean }) {
  return (
    <Press href={href} className={`week-tile${red ? " is-red" : ""}`} lift>
      <span className="week-label">{label}</span>{" "}
      <span className="week-big">
        <Count id={id} value={value} />
        {of !== undefined && <small> of {of.toLocaleString("en-IN")}</small>}
      </span>{" "}
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

// Someone signed in who is not in a firm yet: their invites, or the firm being closed.
function NoFirm({ closed, invites, deviceStatus, connectionWaiting, pcKey }: { closed: { firm_name: string; hours: unknown; reason: string; away: boolean } | null | undefined; invites: { firm_id: string; firm_name: string; role: string }[]; deviceStatus: "waiting" | "refused" | null; connectionWaiting: boolean; pcKey: "needed" | "ready" | null }) {
  if (connectionWaiting)
    return (
      <>
        <PageHead title="Waiting for your firm to confirm the office internet connection" sub={pcKey === "ready" ? "This PC stays in the office, so its key can confirm the new connection. The owner is told." : "Ask the owner or a deputy to confirm this connection."} />
        {pcKey === "ready" && <PcKey mode="confirm" />}
      </>
    );
  if (closed?.reason === "office" && deviceStatus)
    return (
      <PageHead
        title={deviceStatus === "waiting" ? "This PC is waiting for your firm's approval." : "Your firm refused this PC."}
        sub={deviceStatus === "waiting" ? "Ask the owner to approve it in Settings. You can try again after that." : "Ask the owner if this PC should be allowed."}
      />
    );
  if (closed?.reason === "office")
    return (
      <>
        <PageHead
          title="Use InboxCA from your office."
          sub={`${closed.firm_name} lets staff use InboxCA only in the office, on the office internet connection. If you are in the office now, ask the owner to confirm this connection.`}
        />
        {closed.away && (
          <form action={askAwayDevice} className="form-row">
            <Pending className="b b-secondary">Ask to use this device away from the office</Pending>
            <span className="hint">The owner may allow it for some days, to view only.</span>
          </form>
        )}
      </>
    );
  return (
    <>
      <PageHead
        title={closed ? `${closed.firm_name} is closed now.` : invites.length ? "Welcome to InboxCA." : "You are not part of a firm yet."}
        sub={
          closed
            ? describeHours(closed.hours as Hours)
              ? `Your firm uses InboxCA during office hours: ${describeHours(closed.hours as Hours)}, India time.`
              : "Your firm has no office hours set. Ask the owner."
            : invites.length
              ? "Join your firm to start."
              : "Ask your firm's owner to invite you."
        }
      />
      {!!invites.length && (
        <section className="panel" aria-labelledby="invites">
          <h2 id="invites">Invites</h2>
          <ul className="rows">
            {invites.map((invite) => (
              <li key={invite.firm_id}>
                <span className="grow">
                  <strong>{invite.firm_name}</strong> has invited you as {roleNames[invite.role]}.
                </span>
                <form action={joinFirm}>
                  <input type="hidden" name="firm" value={invite.firm_id} />
                  <Pending className="b b-primary" type="submit">
                    Join {invite.firm_name}
                  </Pending>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
