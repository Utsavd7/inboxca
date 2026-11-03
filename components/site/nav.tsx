"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { SHOW_PLANS } from "@/content/plans";
import { policies } from "@/content/site";
import { contactEmail } from "@/src/lib/site";

const ease = [0.16, 1, 0.3, 1] as const;

const links = [
  ["how-it-works", "How it works"],
  ["control", "Security"],
  ...(SHOW_PLANS ? [["plans", "Plans"]] : []),
  ["questions", "Questions"],
];

// The policy pages in a small menu. A mouse opens it by hovering; a click, a tap or Enter
// opens it too. Escape, a click elsewhere or tabbing past it closes it.
function PoliciesMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      box.current?.querySelector("button")?.focus();
    };
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", away);
    };
  }, [open]);
  function hover(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return;
    hovered.current = event.type === "pointerenter";
    setOpen(hovered.current);
  }
  return (
    <div
      className="nav-drop"
      ref={box}
      onPointerEnter={hover}
      onPointerLeave={hover}
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="nav-drop-button"
        aria-expanded={open}
        aria-controls="nav-policies"
        onClick={() => setOpen(hovered.current || !open)}
      >
        Policies
        <ChevronDown size={15} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id="nav-policies"
            className="nav-drop-panel"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.24, ease }}
          >
            <ul>
              {policies.map(([href, label, line]) => (
                <li key={href}>
                  <a href={href}>
                    <strong>{label}</strong>
                    <span>{line}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p>
              A question? Write to <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
                  transition={{ type: "spring", duration: 0.55, bounce: 0 }}
                />
              )}
              <span>{label}</span>
            </a>
          ))}
          <PoliciesMenu />
        </nav>
        <a className="nav-sign-in" href="/sign-in">
          Sign in
        </a>
        <a className="btn btn-small" href="/sign-up">
          Get started
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
            transition={{ duration: 0.3, ease }}
          >
            {links.map(([id, label]) => (
              <a key={id} href={`${base}#${id}`} onClick={() => setOpen(false)}>
                {label}
              </a>
            ))}
            <p className="nav-panel-label">Policies</p>
            <div className="nav-panel-small">
              {policies.map(([href, label]) => (
                <a key={href} href={href}>
                  {label}
                </a>
              ))}
            </div>
            <a href="/sign-in">Sign in</a>
          </motion.nav>
        )}
      </AnimatePresence>
      </header>
    </>
  );
}
