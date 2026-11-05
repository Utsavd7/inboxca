"use client";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useReduced } from "./use-reduced";

// "One time setup fee" in the plan note opens a small card on what the fee pays for (PLAN.md D5,
// 5.16; app/(app)/app/import). It floats over the page, so nothing below moves. Escape, a click
// elsewhere or tabbing past it closes it; focus goes into the card and back to the button.
export function SetupFee({ plan, fee }: { plan: string; fee: string }) {
  const id = useId();
  const reduced = useReduced();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    card.current?.focus();
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
  return (
    <span
      ref={box}
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button type="button" className="setup-fee" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        One time setup fee
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={card}
            id={id}
            role="region"
            aria-label="What the setup fee pays for"
            tabIndex={-1}
            className="setup-card"
            initial={reduced ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <strong>What the setup fee pays for</strong>
            <ul>
              <li>Bringing in your old papers at the start. In Add old files you tick the folders already in your drive; InboxCA matches each to a client, names every file and files it by year, client and type of work, once you have seen where each one goes.</li>
              <li>It is worked out from one month of your plan&apos;s AI credits. For {plan} it is {fee}.</li>
              <li>It is charged once, with your first payment, and returned if you cancel within 14 days, before your old files start to be brought in.</li>
            </ul>
            <Link href="/help/setup-fee">More in Help</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
