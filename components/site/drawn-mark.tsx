"use client";
import { motion } from "motion/react";

// The InboxCA mark on a dark ground. The tick lands in the tray when it comes into view.
export function DrawnMark() {
  return (
    <svg
      className="drawn-mark"
      viewBox="0 0 108 100"
      width="69"
      height="64"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="90" height="90" rx="21" fill="#fff" />
      <path
        d="M28 45V60a10 10 0 0 0 10 10H62a10 10 0 0 0 10-10V45"
        fill="none"
        stroke="#0b1f3a"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <motion.path
        d="M100 18L40 41L52 57"
        fill="none"
        stroke="#12905f"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true, amount: 0.8 }}
        transition={{ duration: 0.9, delay: 0.25, ease: [0.23, 1, 0.32, 1] }}
      />
    </svg>
  );
}
