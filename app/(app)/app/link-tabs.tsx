import Link from "next/link";
import { Indicator } from "./motion";

type Item = { href: string; label: string; count?: number; current: boolean };

// Tabs and segmented filters made of links, so each view has its own address and works
// without JavaScript. The current one's line (tabs) or thumb (pills) glides from the last one.
export function LinkTabs({ items, kind = "tabs", label }: { items: Item[]; kind?: "tabs" | "pills"; label: string }) {
  const name = `${kind}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <nav className={kind} aria-label={label}>
      {items.map(({ href, label: text, count, current }) => (
        <Link key={href} href={href} aria-current={current ? "page" : undefined} scroll={false}>
          {current && <Indicator id={name} className={kind === "tabs" ? "tab-line" : "tab-thumb"} />}
          <span>{text}</span>
          {count !== undefined && <small>{count}</small>}
        </Link>
      ))}
    </nav>
  );
}
