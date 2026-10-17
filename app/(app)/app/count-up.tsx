"use client";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

// A number that counts up once when the page opens, so a change since the last visit is
// noticed; still for anyone who has asked their computer for less motion.
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const still = useReducedMotion();
  useEffect(() => {
    if (still || !ref.current || !value) return;
    const node = ref.current;
    const controls = animate(0, value, { duration: 0.7, ease: [0.23, 1, 0.32, 1], onUpdate: (n) => (node.textContent = String(Math.round(n))) });
    return () => controls.stop();
  }, [value, still]);
  return (
    <span ref={ref} className="tabular">
      {value}
    </span>
  );
}
