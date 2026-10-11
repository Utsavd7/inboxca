"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { SHOW_PLANS } from "@/content/plans";

const links = [
  ["how-it-works", "How it works"],
  ["control", "Security"],
  ...(SHOW_PLANS ? [["plans", "Plans"]] : []),
  ["questions", "Questions"],
];

// On the home page the links jump within the page. Elsewhere they lead back to it.
export function Nav({ home = true }: { home?: boolean }) {
  const base = home ? "" : "/";
  const [active, setActive] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const scroll = () => {
      setScrolled(window.scrollY > 24);
      let current = "";
      for (const [id] of links) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.4)
          current = id;
      }
      setActive(current);
    };
    scroll();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, []);
  // The phone menu closes on Escape.
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      {/* Whatever scrolls up behind the bar blurs gradually, strongest at the very top. */}
      <div className="top-blur" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <header className="nav-shell">
      <div className={`nav ${scrolled ? "is-scrolled" : ""}`}>
        <a href={home ? "#top" : "/"} aria-label="InboxCA home">
          <Logo />
        </a>
        <nav aria-label="Main navigation">
          {links.map(([id, label]) => (
            <a
              key={id}
              href={`${base}#${id}`}
              aria-current={active === id ? "location" : undefined}
            >
              {active === id && (
                <motion.span
                  layoutId="nav-active"
                  className="nav-active"
                  transition={{ type: "spring", duration: 0.55, bounce: 0.16 }}
                />
              )}
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <a
          className="btn btn-small"
          href={`${base}#invite`}
          data-open-dialog="invite"
          aria-haspopup="dialog"
        >
          Ask for an invite
        </a>
        <button
          type="button"
          className="nav-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="nav-panel"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            id="nav-panel"
            className="nav-panel"
            aria-label="Menu"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          >
            {links.map(([id, label]) => (
              <a key={id} href={`${base}#${id}`} onClick={() => setOpen(false)}>
                {label}
              </a>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
      </header>
    </>
  );
}
