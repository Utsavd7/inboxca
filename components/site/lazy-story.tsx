"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { steps } from "@/content/site";
const ScrollStory = dynamic(() => import("./scroll-story"));
export function LazyStory() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "900px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="lazy-story">
      {near ? (
        <ScrollStory />
      ) : (
        <div className="story-fallback">
          {steps.map(([title, body], i) => (
            <article key={title}>
              <span className="mono">0{i + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
