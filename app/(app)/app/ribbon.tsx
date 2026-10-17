"use client";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

export type RibbonDay = { date: string; due: number; filed: number; names: string[] };

// This month's filing days at a glance: a bar for every day that has returns due, its
// filed part in green and the rest in blue, or red once the day has passed. Hover or focus
// a day to see what falls due; click it to open that day in the Calendar.
export function Ribbon({ month, days, today, lastDay }: { month: string; days: RibbonDay[]; today: string; lastDay: number }) {
  const still = useReducedMotion();
  const [shown, setShown] = useState<RibbonDay | null>(null);
  const byDay = new Map(days.map((day) => [Number(day.date.slice(8, 10)), day]));
  const most = Math.max(1, ...days.map((day) => day.due));
  const todayNumber = today.startsWith(month) ? Number(today.slice(8, 10)) : 0;
  const pending = days.filter((day) => day.date >= today).reduce((sum, day) => sum + day.due - day.filed, 0);

  return (
    <section className="ribbon" aria-labelledby="ribbon-title">
      <div className="ribbon-head">
        <h2 id="ribbon-title">{new Date(`${month}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" })}</h2>
        <p className="ribbon-note" aria-live="polite">
          {shown
            ? `${Number(shown.date.slice(8, 10))} ${new Date(`${shown.date}T00:00:00`).toLocaleString("en-IN", { month: "short" })}: ${shown.names.join(", ")}. ${shown.filed} of ${shown.due} filed.`
            : pending
              ? `${pending} returns still to file this month. Point at a day to see what falls due.`
              : "Nothing left to file this month."}
        </p>
      </div>
      <ol className="ribbon-days">
        {Array.from({ length: lastDay }, (_, index) => {
          const number = index + 1;
          const day = byDay.get(number);
          const date = `${month}-${String(number).padStart(2, "0")}`;
          const past = date < today;
          const open = day ? day.due - day.filed : 0;
          return (
            <li key={number} className={`${number === todayNumber ? "is-today" : ""}${day ? " has-due" : ""}`}>
              {day ? (
                <Link
                  href={`/app/calendar?day=${date}`}
                  aria-label={`${number}: ${day.names.join(", ")}, ${day.filed} of ${day.due} filed`}
                  onMouseEnter={() => setShown(day)}
                  onMouseLeave={() => setShown(null)}
                  onFocus={() => setShown(day)}
                  onBlur={() => setShown(null)}
                >
                  <span className="ribbon-count num">{open || ""}</span>
                  <span className="ribbon-bar">
                    <motion.span
                      className={`ribbon-fill${past && open ? " is-late" : ""}`}
                      style={{ height: `${Math.max(14, (day.due / most) * 100)}%` }}
                      initial={still ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ delay: 0.15 + index * 0.012, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <span className="ribbon-done" style={{ height: `${(day.filed / day.due) * 100}%` }} />
                    </motion.span>
                  </span>
                  <span className="ribbon-date num">{number}</span>
                </Link>
              ) : (
                <span className="ribbon-empty">
                  <span className="ribbon-count" />
                  <span className="ribbon-bar" />
                  <span className="ribbon-date num">{number}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
