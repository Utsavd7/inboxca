"use client";
import { Activity, CalendarCheck, Building2, FileStack, IndianRupee, KeyRound, Mail, Network, RotateCcw, ScanSearch } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";

const pages = [
  { href: "/admin", name: "Today's changes", Icon: ScanSearch },
  { href: "/admin/firms", name: "Firms", Icon: Building2 },
  { href: "/admin/billing", name: "Billing", Icon: IndianRupee },
  { href: "/admin/mailboxes", name: "Mailboxes", Icon: Mail },
  { href: "/admin/jobs", name: "Failed jobs", Icon: RotateCcw },
  { href: "/admin/due-dates", name: "Due dates", Icon: CalendarCheck },
  { href: "/admin/forms", name: "Form versions", Icon: FileStack },
  { href: "/admin/status", name: "Status", Icon: Activity },
  { href: "/admin/office", name: "Office connections", Icon: Network },
  { href: "/admin/admins", name: "Admins", Icon: KeyRound },
];

export function AdminNav() {
  const path = usePathname();
  return pages.map(({ href, name, Icon }) => (
    <Link key={href} href={href} aria-current={path === href || href === "/admin/firms" && path.startsWith(`${href}/`) ? "page" : undefined}>
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
