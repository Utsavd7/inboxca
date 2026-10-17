"use client";
import { CalendarDays, House, Inbox, Settings, Users, UsersRound } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The sidebar's links, by role: staff and front desk see their work; managers and
// partners also see the firm's people; the owner also sees Settings. The current page is
// marked for sight and for screen readers.
export function NavLinks({ role, waiting }: { role: string; waiting: number }) {
  const path = usePathname();
  const links = [
    { href: "/app", name: "Home", Icon: House },
    { href: "/app/inbox", name: "Inbox", Icon: Inbox, count: waiting },
    { href: "/app/clients", name: "Clients", Icon: UsersRound },
    { href: "/app/calendar", name: "Calendar", Icon: CalendarDays },
    ...(["owner", "partner", "manager"].includes(role) ? [{ href: "/app/people", name: "People", Icon: Users }] : []),
    ...(role === "owner" ? [{ href: "/app/settings", name: "Settings", Icon: Settings }] : []),
  ];
  return links.map(({ href, name, Icon, count }) => {
    const current = path === href || (href !== "/app" && path.startsWith(`${href}/`));
    return (
      <Link key={href} href={href} aria-current={current ? "page" : undefined}>
        {current && <motion.span className="app-nav-mark" layoutId="app-nav-mark" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
        <Icon size={17} aria-hidden />
        {name}
        {!!count && (
          <span className="app-count" aria-label={`${count} waiting`}>
            {count}
          </span>
        )}
      </Link>
    );
  });
}
