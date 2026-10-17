"use client";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

type Item = { href: string; label: string; count?: number; current: boolean };

// Tabs and segmented filters made of links, so each view has its own address and works
// without JavaScript; the marker slides to the chosen one.
export function LinkTabs({ items, id, kind = "tabs", label }: { items: Item[]; id: string; kind?: "tabs" | "segment"; label: string }) {
  const still = useReducedMotion();
  const transition = still ? { duration: 0 } : { type: "spring" as const, stiffness: 520, damping: 42 };
  return (
    <nav className={kind} aria-label={label}>
      {items.map(({ href, label: text, count, current }) => (
        <Link key={href} href={href} aria-current={current ? "page" : undefined} scroll={false}>
          {current && kind === "segment" && <motion.span className="segment-here" layoutId={id} transition={transition} />}
          <span>
            {text}
            {count !== undefined && <small>{count}</small>}
          </span>
          {current && kind === "tabs" && <motion.span className="tab-line" layoutId={id} transition={transition} />}
        </Link>
      ))}
    </nav>
  );
}
