"use client";
import { CalendarDays, FolderOpen, Handshake, House, Inbox, Scale, Settings, Users, UsersRound } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState } from "react";
import { pagesFor } from "@/src/lib/roles";
import { Indicator } from "./motion";

const icons: Record<string, typeof House> = { Today: House, Inbox, Clients: UsersRound, Documents: FolderOpen, Calendar: CalendarDays, Notices: Scale, Leads: Handshake, People: Users, Settings };

// The sidebar's links; the current page is marked for sight and for screen readers, and its
// tint glides from the page before (motion.tsx Indicator). A link fetches its page as soon as
// the pointer rests on it, and shows a small spinner from the click until the page is in. The
// Inbox count arrives when ready, so the sidebar never waits for it.
export function NavLinks({ role, waiting, place }: { role: string; waiting?: Promise<number>; place: "main" | "workspace" }) {
  const path = usePathname();
  return pagesFor(role).filter((page) => page.place === place).map(({ href, name }) => (
    <NavLink key={href} href={href} name={name} current={path === href || (href !== "/app" && path.startsWith(`${href}/`))} waiting={name === "Inbox" ? waiting : undefined} />
  ));
}

function NavLink({ href, name, current, waiting }: { href: string; name: string; current: boolean; waiting?: Promise<number> }) {
  const [warm, setWarm] = useState(false);
  const Icon = icons[name];
  return (
    <Link href={href} className="side-item" data-tip={name} aria-current={current ? "page" : undefined} prefetch={warm || null} onMouseEnter={() => setWarm(true)} onFocus={() => setWarm(true)}>
      {current && <Indicator id="side-pill" className="side-pill" />}
      <Icon size={18} aria-hidden />
      <span className="side-text">{name}</span>
      <Going />
      {waiting && (
        <Suspense fallback={null}>
          <Waiting count={waiting} />
        </Suspense>
      )}
    </Link>
  );
}

function Going() {
  return useLinkStatus().pending ? <span className="side-going" aria-hidden /> : null;
}

function Waiting({ count }: { count: Promise<number> }) {
  const waiting = use(count);
  return waiting ? (
    <span className="rail-count" aria-label={`${waiting} waiting`}>
      {waiting}
    </span>
  ) : null;
}
