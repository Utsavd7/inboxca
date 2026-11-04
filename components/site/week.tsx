"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { Check } from "lucide-react";
import { weekScenes } from "@/content/site";
import { Fill } from "./demo";
import { Logo } from "./logo";

const ease = [0.16, 1, 0.3, 1] as const;

// Three sample days on the Today screen, on the same stage as the demo. Invented firms and
// figures; the asterisk leads to the note that says so.
export function Week() {
  const [pick, setPick] = useState(0);
  const [when, title, rows] = weekScenes[pick];
  return (
    <div className="week">
      <div className="week-rail">
        <p className="week-kicker">Pick a day</p>
        <div className="week-days" role="group" aria-label="Choose a day">
          {weekScenes.map(([date, name], index) => (
            <button key={name} type="button" aria-pressed={pick === index} onClick={() => setPick(index)}>
              {pick === index && <motion.span layoutId="week-pick" className="demo-active" transition={{ duration: 0.45, ease }} />}
              <span>
                <strong>{name}</strong>
                <small className="num">{date}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="week-stage">
        <div className="stage-bar">
          <Logo />
          <span>
            Today
            <Link className="star" href="/security#website" aria-label="About the sample data on this page">
              *
            </Link>
          </span>
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={when}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease }}
          >
            <p className="week-title">
              {title}
              <span className="num">{when}</span>
            </p>
            <ul className="week-rows" aria-label={`Sample day, ${when}`}>
              {rows.map(([what, state, done]) => (
                <li key={what}>
                  <span>{what}</span>
                  <span className={`chip ${done ? "chip-done" : ""}`}>
                    {done && <Check size={14} strokeWidth={3} aria-hidden />}
                    {state}
                  </span>
                </li>
              ))}
            </ul>
            <p className="scene-note week-note">Routine work goes out by itself. Anything unusual waits here for your team.</p>
            <Fill />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
