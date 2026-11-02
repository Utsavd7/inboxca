"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { Check } from "lucide-react";
import { weekScenes } from "@/content/site";

const ease = [0.23, 1, 0.32, 1] as const;
const spring = { type: "spring", duration: 0.55, bounce: 0.16 } as const;

// Three sample days on the Today screen, under the demo. Invented firms and figures; the
// asterisk leads to the note that says so.
export function Week() {
  const [pick, setPick] = useState(0);
  const [when, , rows] = weekScenes[pick];
  return (
    <div className="week">
      <div className="week-head">
        <p className="week-label">
          A sample week on the Today screen
          <Link className="star" href="/security#website" aria-label="About the sample data on this page">
            *
          </Link>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={when}
              className="num week-when"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {when}
            </motion.span>
          </AnimatePresence>
        </p>
        <div className="segment segment-light" role="group" aria-label="Choose a day">
          {weekScenes.map(([, title], index) => (
            <button key={title} type="button" aria-pressed={pick === index} onClick={() => setPick(index)}>
              {pick === index && <motion.span layoutId="week-pick" className="segment-pick" transition={spring} />}
              <span>{title}</span>
            </button>
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.ul
          key={when}
          className="week-rows"
          aria-label={`Sample day, ${when}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease }}
        >
          {rows.map(([what, state, done]) => (
            <li key={what}>
              <span>{what}</span>
              <span className={`chip ${done ? "chip-done" : ""}`}>
                {done && <Check size={14} strokeWidth={3} aria-hidden />}
                {state}
              </span>
            </li>
          ))}
        </motion.ul>
      </AnimatePresence>
    </div>
  );
}
