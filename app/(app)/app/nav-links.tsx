"use client";
import { FolderOpen, House, Inbox, Settings, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ViewTransition } from "react";
import { pagesFor } from "@/src/lib/roles";

const icons: Record<string, typeof House> = { Today: House, Inbox, Clients: UsersRound, Documents: FolderOpen, People: Users, Settings };

// The menu's links; the current page is marked for sight and for screen readers, and its pill
// slides from the page before.
export function NavLinks({ role, waiting, place }: { role: string; waiting: number; place: "main" | "foot" }) {
  const path = usePathname();
  return pagesFor(role).filter((page) => page.place === place).map(({ href, name }) => {
    const Icon = icons[name];
    const current = path === href || (href !== "/app" && path.startsWith(`${href}/`));
    return (
      <Link key={href} href={href} aria-current={current ? "page" : undefined}>
        {current && (
          <ViewTransition name="rail-pill" share="rail-pill" default="none">
            <span className="rail-pill" aria-hidden />
          </ViewTransition>
        )}
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
