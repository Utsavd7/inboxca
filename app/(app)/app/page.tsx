import { Check } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { joinFirm } from "@/app/(app)/actions";
import { calendarViews, todayInIndia } from "@/src/lib/calendar";
import { describeHours, type Hours } from "@/src/lib/hours";
import { currentMember } from "@/src/lib/member";
import { roleNames } from "@/src/lib/roles";

// The signed in start page, kept plain for people who are not technical: what needs them
// today, each count opening the list to act on, and for the owner the few setup steps
// left, one button each. Everything else runs by itself. The full dashboard comes in M10.
export default async function AppHome() {
  const { supabase, membership } = await currentMember();
  const { data: invites } = await supabase.rpc("my_invites");
  const closed = membership ? null : (await supabase.rpc("closed_firms")).data?.[0];
  if (closed?.reason === "session") redirect("/auth/sign-out?reason=session");
  const today = todayInIndia();
  const count = (query: PromiseLike<{ count: number | null }>) => Promise.resolve(query).then((result) => result.count ?? 0);
  const tasks = () => supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "filed");
  const [waiting, overdue, week, accounts, clients, services, people] = membership
    ? await Promise.all([
        count(supabase.from("requests").select("id", { count: "exact", head: true }).eq("kind", "team_reply").eq("status", "pending")),
        count(tasks().lte("due_on", calendarViews.overdue.window(today).to)),
        count(tasks().gte("due_on", today).lte("due_on", calendarViews.week.window(today).to)),
        supabase.from("connected_accounts").select("kind").then((result) => result.data?.map((row) => row.kind) ?? []),
        count(supabase.from("clients").select("id", { count: "exact", head: true })),
        count(supabase.from("client_registrations").select("id", { count: "exact", head: true }).filter("services", "neq", "{}")),
        count(supabase.from("firm_members").select("user_id", { count: "exact", head: true })),
      ])
    : [];
  const steps = [
    { done: accounts?.includes("mail"), text: "Connect the firm's email", href: "/app/settings#mailbox", action: "Connect email" },
    { done: accounts?.includes("drive"), text: "Link the firm's drive, where client files are saved", href: "/app/settings#drive", action: "Link drive" },
    { done: !!clients, text: "Add your clients, or import your Excel list", href: "/app/clients", action: "Add clients" },
    { done: !!services, text: "Tick what you file for each client, so due dates appear", href: "/app/clients", action: "Open clients" },
    { done: (people ?? 0) > 1, text: "Invite your team", href: "/app/people", action: "Invite" },
  ];
  const next = steps.find((step) => !step.done);

  return (
    <>
      {membership ? (
        <h1>
          {membership.firmName}
          <span className="app-role">You are signed in as {roleNames[membership.role]}.</span>
        </h1>
      ) : closed ? (
        <h1>
          {closed.firm_name} is closed now.
          <span className="app-role">
            {describeHours(closed.hours as Hours)
              ? `Your firm uses InboxCA during office hours: ${describeHours(closed.hours as Hours)}, India time.`
              : "Your firm has no office hours set. Ask the owner."}
          </span>
        </h1>
      ) : invites?.length ? (
        <h1>
          Welcome to InboxCA.
          <span className="app-role">Join your firm to start.</span>
        </h1>
      ) : (
        <h1>
          You are not part of a firm yet.
          <span className="app-role">Ask your firm&apos;s owner to invite you.</span>
        </h1>
      )}
      {membership && (
        <section className="app-card" aria-labelledby="today">
          <h2 id="today">Needs you today</h2>
          <div className="app-tiles">
            {[
              [waiting, "emails waiting for a reply", "/app/inbox"],
              [overdue, "returns overdue", "/app/calendar?view=overdue"],
              [week, "returns due in 7 days", "/app/calendar?view=week"],
            ].map(([number, label, href]) => (
              <Link key={String(href)} className="app-tile" href={String(href)}>
                <strong className="num">{number}</strong>
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {membership?.role === "owner" && next && (
        <section className="app-card" aria-labelledby="start">
          <h2 id="start">Get started</h2>
          <p className="app-note">A few steps, once. After that InboxCA sorts mail, files papers and keeps the due dates by itself.</p>
          <ol className="app-steps">
            {steps.map((step) => (
              <li key={step.text} className={step.done ? "is-done" : undefined}>
                {step.done ? <Check size={16} aria-label="Done" /> : <span className="app-step-dot" aria-hidden />}
                <span>{step.text}</span>
                {step === next && (
                  <Link className="btn" href={step.href}>
                    {step.action}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {!!invites?.length && (
        <section className="app-card" aria-labelledby="invites">
          <h2 id="invites">Invites</h2>
          <ul className="app-list">
            {invites.map((invite) => (
              <li key={invite.firm_id}>
                <span>
                  <strong>{invite.firm_name}</strong> has invited you as {roleNames[invite.role]}.
                </span>
                <form action={joinFirm}>
                  <input type="hidden" name="firm" value={invite.firm_id} />
                  <button className="btn" type="submit">
                    Join {invite.firm_name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
