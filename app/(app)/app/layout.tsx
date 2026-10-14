import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/site/logo";
import { signOut } from "@/app/(auth)/actions";
import { currentMember } from "@/src/lib/member";

export const metadata: Metadata = {
  title: "InboxCA",
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { membership } = await currentMember();
  return (
    <div className="app-page">
      <header className="app-bar">
        <Logo />
        <nav className="app-nav" aria-label="InboxCA">
          <Link href="/app">Home</Link>
          <Link href="/app/people">People</Link>
          {membership?.role === "owner" && <Link href="/app/settings">Settings</Link>}
          <form action={signOut}>
            <button className="btn btn-quiet" type="submit">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="app-body">{children}</main>
    </div>
  );
}
