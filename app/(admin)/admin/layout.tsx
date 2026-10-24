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
  const { email } = await currentAdmin();
  return (
    <div className="ui admin">
      <aside className="rail">
        <div className="rail-firm">
          <Avatar name="Orelu admin" square />
          <strong>Orelu admin</strong>
        </div>
        <nav className="rail-nav" aria-label="Admin">
          <AdminNav />
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
