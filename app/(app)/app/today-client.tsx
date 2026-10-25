"use client";
import { m, useReducedMotion } from "motion/react";
import { useEffect } from "react";

// The moment the last setup step is done: a burst of brand coloured dots, shown once (a
// cookie hides the card from then on). With less motion asked for, no burst.
const dots = Array.from({ length: 14 }, (_, at) => ({ angle: (at / 14) * Math.PI * 2, far: 34 + (at % 3) * 12, hue: at % 3 }));
export function Celebrate() {
  const reduce = useReducedMotion();
  useEffect(() => {
    document.cookie = `setup_done=1; path=/app; max-age=${31_536_000}; samesite=lax`;
  }, []);
  if (reduce) return null;
  return (
    <span className="burst" aria-hidden>
      {dots.map(({ angle, far, hue }, at) => (
        <m.span
          key={at}
          className={`burst-dot h${hue}`}
          initial={{ opacity: 1, x: 0, y: 0, scale: 0.4 }}
          animate={{ opacity: 0, x: Math.cos(angle) * far, y: Math.sin(angle) * far, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 + (at % 4) * 0.02 }}
        />
      ))}
    </span>
  );
}
