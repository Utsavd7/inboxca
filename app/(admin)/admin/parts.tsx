"use client";
import { Activity, CalendarCheck, Building2, FileStack, IndianRupee, KeyRound, Mail, Network, RotateCcw, ScanSearch, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, use, useState } from "react";
import { useFormStatus } from "react-dom";

const pages = [
  { href: "/admin", name: "Today's changes", Icon: ScanSearch },
  { href: "/admin/firms", name: "Firms", Icon: Building2 },
  { href: "/admin/billing", name: "Billing", Icon: IndianRupee },
  { href: "/admin/ai", name: "AI use", Icon: Sparkles },
  { href: "/admin/mailboxes", name: "Mailboxes", Icon: Mail },
  { href: "/admin/jobs", name: "Failed jobs", Icon: RotateCcw },
  { href: "/admin/due-dates", name: "Due dates", Icon: CalendarCheck },
  { href: "/admin/forms", name: "Form versions", Icon: FileStack },
  { href: "/admin/status", name: "Status", Icon: Activity },
  { href: "/admin/office", name: "Office connections", Icon: Network },
  { href: "/admin/admins", name: "Admins", Icon: KeyRound },
];

// The menu, with how many things wait on each page beside it (layout.tsx). The counts arrive
// when ready, so the menu never waits for them.
export function AdminNav({ waiting }: { waiting: Promise<Record<string, number>> }) {
  const path = usePathname();
  return pages.map(({ href, name, Icon }) => (
    <Link key={href} href={href} aria-current={path === href || href === "/admin/firms" && path.startsWith(`${href}/`) ? "page" : undefined}>
      <Icon size={16} aria-hidden />
      <span>{name}</span>
      <Suspense fallback={null}>
        <Waiting href={href} waiting={waiting} />
      </Suspense>
    </Link>
  ));
}

function Waiting({ href, waiting }: { href: string; waiting: Promise<Record<string, number>> }) {
  const count = use(waiting)[href];
  return count ? <span className="rail-count" aria-label={`${count} waiting`}>{count}</span> : null;
}

// A row's one button, busy while its action runs. With confirm, the first press (once the
// form's fields are valid) says what will happen, and only "Yes" runs it; Cancel or Esc keeps
// things as they were.
export function Submit({ children, confirm, name, value }: { children: string; confirm?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  const [asking, setAsking] = useState(false);
  if (confirm && !asking) {
    return (
      <button className="b b-secondary" type="submit" onClick={(event) => { event.preventDefault(); if (event.currentTarget.form?.reportValidity()) setAsking(true); }}>
        {children}
      </button>
    );
  }
  return (
    <span className="admin-confirm" onKeyDown={(event) => event.key === "Escape" && !pending && setAsking(false)}>
      {asking && <span className="sub" role="status">{confirm}</span>}
      <button className="b b-secondary" type="submit" name={name} value={value} disabled={pending} autoFocus={asking}>
        {pending ? "Working" : asking ? `Yes, ${children[0].toLowerCase()}${children.slice(1)}` : children}
      </button>
      {asking && <button className="b b-ghost" type="button" disabled={pending} onClick={() => setAsking(false)}>Cancel</button>}
    </span>
  );
}

// A long list's place, a page of rows at a time (admin.ts PAGE), as the Clients list does it.
export function Pager({ page, size, total, label }: { page: number; size: number; total: number; label: string }) {
  const path = usePathname();
  const query = useSearchParams();
  const at = (n: number) => `${path}?${new URLSearchParams({ ...Object.fromEntries(query), page: String(n) })}`;
  if (total <= size) return null;
  return (
    <nav className="pager admin-pager" aria-label={label}>
      <p>Showing {((page - 1) * size + 1).toLocaleString("en-IN")} to {Math.min(page * size, total).toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</p>
      <span>
        {page > 1 && <Link className="b b-secondary" href={at(page - 1)}>Previous</Link>}
        {page * size < total && <Link className="b b-secondary" href={at(page + 1)}>Next</Link>}
      </span>
    </nav>
  );
}
