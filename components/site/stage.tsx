"use client";
import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Mail } from "lucide-react";
import { Demo } from "./demo";
import { Week } from "./week";

const views = [
  ["email", "Follow one email", Mail],
  ["week", "See a busy week", CalendarDays],
] as const;
type View = (typeof views)[number][0];

const subscribe = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

// The product on one stage: one email followed through its five jobs, or three sample days.
// A link to #week opens the week; a click on the switch wins until the next such link.
export function Stage() {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => "");
  const [pick, setPick] = useState<{ view: View; hash: string }>();
  const view: View = pick && pick.hash === hash ? pick.view : hash === "#week" ? "week" : "email";
  return (
    <div className="stage">
      <span id="week" className="stage-anchor" aria-hidden />
      <div className="stage-bar-top">
        <div className="segment" role="group" aria-label="What to show">
          {views.map(([key, label, Icon]) => (
            <button key={key} type="button" aria-pressed={view === key} onClick={() => setPick({ view: key, hash })}>
              {view === key && (
                <motion.span layoutId="stage-pick" className="segment-pick" transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} />
              )}
              <span>
                <Icon size={15} aria-hidden />
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={view}
          className="stage-view"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {view === "email" ? <Demo /> : <Week />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
