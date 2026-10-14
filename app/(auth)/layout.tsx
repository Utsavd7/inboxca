import type { Metadata } from "next";
import { Logo } from "@/components/site/logo";

export const metadata: Metadata = {
  title: "Sign in | InboxCA",
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Logo />
        {children}
      </div>
    </main>
  );
}
