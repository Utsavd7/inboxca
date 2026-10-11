"use client";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { SHOW_PLANS } from "@/content/plans";
const links = [
  ["how-it-works", "How it works"],
  ["control", "You stay in control"],
  ...(SHOW_PLANS ? [["plans", "Plans"]] : []),
  ["coming-next", "Coming next"],
  ["questions", "Questions"],
];
export function Header() {
  const [compact, setCompact] = useState(false);
  const [active, setActive] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const scroll = () => {
      setCompact(window.scrollY > 40);
      let current = "";
      for (const [id] of links) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 180) current = id;
      }
      setActive(current);
    };
    scroll();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      <div className="header-space" aria-hidden="true" />
      <header className={`site-header ${compact ? "compact" : ""}`}>
        <div className="header-inner">
          <a href="#top" aria-label="InboxCA home">
            <Logo />
          </a>
          <nav
            aria-label="Main navigation"
            id="site-nav"
            className={open ? "nav-open" : ""}
          >
            {links.map(([id, text]) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={active === id ? "location" : undefined}
                onClick={() => setOpen(false)}
              >
                {text}
              </a>
            ))}
          </nav>
          <a
            className="action header-invite"
            href="#invite"
            data-open-dialog="invite"
            aria-haspopup="dialog"
          >
            Ask for an invite
          </a>
          <button
            className="menu-toggle"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="site-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
      </header>
    </>
  );
}
