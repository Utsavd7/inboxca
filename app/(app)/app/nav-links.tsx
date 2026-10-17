"use client";
import { CalendarDays, House, Inbox, Settings, Users, UsersRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { pagesFor } from "@/src/lib/roles";

const icons: Record<string, typeof House> = { Home: House, Inbox, Clients: UsersRound, Calendar: CalendarDays, People: Users, Settings };

// The rail's links; the current page is marked for sight and for screen readers, and the
// marker slides to it.
export function NavLinks({ role, waiting }: { role: string; waiting: number }) {
  const path = usePathname();
  const still = useReducedMotion();
  return pagesFor(role).map(({ href, name }) => {
    const Icon = icons[name];
    const current = path === href || (href !== "/app" && path.startsWith(`${href}/`));
    return (
      <Link key={href} href={href} aria-current={current ? "page" : undefined}>
        {current && <motion.span className="rail-here" layoutId="rail-here" transition={still ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }} />}
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
