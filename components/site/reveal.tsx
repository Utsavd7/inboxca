"use client";
import { MotionConfig } from "motion/react";

// Honours the visitor's reduced motion setting for every animation below it. Sections rise
// in with the scroll in CSS (.reveal), so nothing is hidden before a script runs.
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
