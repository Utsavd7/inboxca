"use client";
import { CalendarCheck, Building2, KeyRound, Mail, RotateCcw, ScanSearch } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";

const pages = [
  { href: "/admin", name: "Today's changes", Icon: ScanSearch },
  { href: "/admin/firms", name: "Firms", Icon: Building2 },
  { href: "/admin/mailboxes", name: "Mailboxes", Icon: Mail },
  { href: "/admin/jobs", name: "Failed jobs", Icon: RotateCcw },
  { href: "/admin/due-dates", name: "Due dates", Icon: CalendarCheck },
  { href: "/admin/admins", name: "Admins", Icon: KeyRound },
];

export function AdminNav() {
  const path = usePathname();
  return pages.map(({ href, name, Icon }) => (
    <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
      <Icon size={16} aria-hidden />
      <span>{name}</span>
    </Link>
  ));
}

// A row's one button, busy while its action runs.
export function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className="b b-secondary" type="submit" disabled={pending}>
      {pending ? "Working" : children}
    </button>
  );
}
