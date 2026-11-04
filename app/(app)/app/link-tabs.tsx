import Link from "next/link";
import { Count, Indicator } from "./motion";

type Item = { href: string; label: string; count?: number; current: boolean };

// Tabs and segmented filters made of links, so each view has its own address and works
// without JavaScript. The current one's line (tabs) or thumb (pills) glides from the last one;
// the counts count up as the page first shows.
export function LinkTabs({ items, kind = "tabs", label }: { items: Item[]; kind?: "tabs" | "pills"; label: string }) {
  // Named for its page too, so moving to another page with a nav of the same name does not fly
  // the line or thumb across from the page before.
  const name = `${kind}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${items[0]?.href.split("?")[0]}`;
  return (
    <nav className={kind} aria-label={label}>
      {items.map(({ href, label: text, count, current }) => (
        <Link key={href} href={href} aria-current={current ? "page" : undefined} scroll={false}>
          {current && <Indicator id={name} className={kind === "tabs" ? "tab-line" : "tab-thumb"} />}
          <span>{text}</span>
          {count !== undefined && (
            <small>
              <Count id={href} value={count} />
            </small>
          )}
        </Link>
      ))}
    </nav>
  );
}
