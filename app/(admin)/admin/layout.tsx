import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Avatar } from "@/app/(app)/app/ui";
import "@/app/(app)/app/app.css";
import "./admin.css";
import { currentAdmin } from "./admin";
import { AdminNav } from "./parts";

export const metadata: Metadata = {
  title: "Orelu admin",
  robots: { index: false, follow: false },
};

// Orelu's own console, apart from any firm: firm health across Orelu, never client data.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email, supabase } = await currentAdmin();
  // What waits on each page, beside its menu item: forms changes to review, firm pairs that may
  // be one firm, mailboxes and drives to connect again, failed jobs, and due date rules a CA has
  // not checked yet.
  const waiting = Promise.all([
    supabase.rpc("admin_watch"),
    supabase.rpc("admin_split_firms"),
    supabase.rpc("admin_accounts", undefined, { count: "exact", head: true }).neq("status", "connected"),
    supabase.rpc("admin_failed_jobs", undefined, { count: "exact", head: true }),
    supabase.from("compliance_types").select("code", { count: "exact", head: true }).is("verified_on", null),
  ]).then(([watch, splits, accounts, jobs, rules]) => ({
    "/admin": ((watch.data as { changes?: { status: string }[] } | null)?.changes ?? []).filter((change) => change.status === "draft").length,
    "/admin/firms": ((splits.data as { checked?: object }[] | null) ?? []).filter((split) => !split.checked).length,
    "/admin/mailboxes": accounts.count ?? 0,
    "/admin/jobs": jobs.count ?? 0,
    "/admin/due-dates": rules.count ?? 0,
  }));
  return (
    <div className="ui admin">
      <aside className="rail">
        <div className="rail-firm">
          <Avatar name="Orelu admin" square />
          <strong>Orelu admin</strong>
        </div>
        <nav className="rail-nav" aria-label="Admin">
          <AdminNav waiting={waiting} />
        </nav>
        <div className="rail-me rail-foot">
          <Avatar name={email || "?"} />
          <span>
            <strong title={email}>{email}</strong>
            <small>Orelu admin</small>
          </span>
          <form action={signOut}>
            <button className="b b-ghost b-icon" type="submit" aria-label="Sign out" title="Sign out">
              <LogOut size={16} aria-hidden />
            </button>
          </form>
        </div>
      </aside>
      <main className="stage">
        <div className="stage-body">{children}</div>
      </main>
    </div>
  );
}
