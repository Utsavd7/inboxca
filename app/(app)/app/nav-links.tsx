"use client";
import { CalendarDays, FileWarning, House, Inbox, Settings, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { pagesFor } from "@/src/lib/roles";

const icons: Record<string, typeof House> = { Home: House, Inbox, Clients: UsersRound, Calendar: CalendarDays, Notices: FileWarning, People: Users, Settings };

// The rail's links; the current page is marked for sight and for screen readers.
export function NavLinks({ role, waiting }: { role: string; waiting: number }) {
  const path = usePathname();
  return pagesFor(role).map(({ href, name }) => {
    const Icon = icons[name];
    const current = path === href || (href !== "/app" && path.startsWith(`${href}/`));
    return (
      <Link key={href} href={href} aria-current={current ? "page" : undefined}>
        <Icon size={16} aria-hidden />
        <span>{name}</span>
        {name === "Inbox" && !!waiting && (
          <span className="rail-count" aria-label={`${waiting} waiting`}>
            {waiting}
          </span>
        )}
      </Link>
    );
  });
}
