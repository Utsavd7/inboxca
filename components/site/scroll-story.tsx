"use client";
import { useEffect, useRef, useState } from "react";
import { steps } from "@/content/site";
import { ProductScreen } from "./product-screen";
export default function ScrollStory() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ active: 0, animate: true });
  const { active, animate: shouldAnimate } = state;
  const visited = useRef(new Set<number>());
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const index = Number((entry.target as HTMLElement).dataset.step);
        const fresh = !visited.current.has(index);
        visited.current.add(index);
        setState(previous => previous.active === index ? previous : { active: index, animate: fresh });
      }
    }, { rootMargin: "-25% 0px -45% 0px", threshold: 0 });
    el.querySelectorAll("[data-step]").forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return <div className="story-grid" ref={ref}>
    <div className="story-copy">{steps.map(([title, body], i) => <article className={`story-step ${active === i ? "step-active" : ""}`} data-step={i} key={title}><span className="step-number mono">0{i + 1}</span><h3>{title}</h3><p>{body}</p><div className="mobile-screen"><ProductScreen step={i} /></div></article>)}</div>
    <div className="story-pinned"><div className="story-window"><div className="story-rail"><span className="mono">0{active + 1} / 05</span><div className="rail-segments">{steps.map((_, i) => <button type="button" className={i <= active ? "filled" : ""} key={i} aria-label={steps[i][0]} aria-current={i === active ? "step" : undefined} onClick={() => ref.current?.querySelector(`[data-step="${i}"]`)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })} />)}</div></div><ProductScreen step={active} animate={shouldAnimate} /></div></div>
  </div>;
}
