"use client";
import { useEffect, useRef, useState } from "react";
import { animate } from "motion/react";
import { useReduced } from "./use-reduced";

// A figure that rolls to its new value instead of jumping.
export function Rolling({
  value,
  format,
}: {
  value: number;
  format: (value: number) => string;
}) {
  const reduced = useReduced();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: reduced ? 0 : 0.6,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (next) => {
        from.current = next;
        setShown(Math.round(next));
      },
    });
    return () => controls.stop();
  }, [value, reduced]);
  return <span className="num">{format(shown)}</span>;
}
