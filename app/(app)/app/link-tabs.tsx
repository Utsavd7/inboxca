import Link from "next/link";

type Item = { href: string; label: string; count?: number; current: boolean };

// Tabs and segmented filters made of links, so each view has its own address and works
// without JavaScript.
export function LinkTabs({ items, kind = "tabs", label }: { items: Item[]; kind?: "tabs" | "pills"; label: string }) {
  return (
    <nav className={kind} aria-label={label}>
      {items.map(({ href, label: text, count, current }) => (
        <Link key={href} href={href} aria-current={current ? "page" : undefined} scroll={false}>
          {text}
          {count !== undefined && <small>{count}</small>}
        </Link>
      ))}
    </nav>
  );
}
