"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The app bar's links, with the current page marked for sight and for screen readers.
export function NavLinks({ owner }: { owner: boolean }) {
  const path = usePathname();
  const links = [["/app", "Home"], ["/app/clients", "Clients"], ["/app/inbox", "Inbox"], ["/app/calendar", "Calendar"], ["/app/people", "People"], ...(owner ? [["/app/settings", "Settings"]] : [])];
  return links.map(([href, name]) => (
    <Link key={href} href={href} aria-current={path === href || (href !== "/app" && path.startsWith(`${href}/`)) ? "page" : undefined}>
      {name}
    </Link>
  ));
}
