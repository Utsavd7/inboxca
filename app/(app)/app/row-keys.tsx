"use client";
import { useEffect } from "react";
import { typing } from "./command";

// j and k move through a table's rows and Enter opens the row's link, never required. Each
// row's first link is the one it opens; another list names its rows and the button to focus.
export function RowKeys({ rows = ".stage-body table tbody tr", target = "a" }: { rows?: string; target?: string }) {
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || (event.key !== "j" && event.key !== "k")) return;
      const links = [...document.querySelectorAll(rows)].map((row) => row.querySelector<HTMLElement>(target)).filter((link) => link !== null);
      const at = links.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      links[event.key === "j" ? Math.min(links.length - 1, at + 1) : Math.max(0, at - 1)]?.focus();
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [rows, target]);
  return null;
}
