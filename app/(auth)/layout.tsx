import type { Metadata } from "next";
import { AuthFrame } from "@/components/site/auth-frame";

export const metadata: Metadata = {
  title: "Sign in | InboxCA",
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
