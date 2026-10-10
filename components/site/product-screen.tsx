"use client";
import { useEffect } from "react";
import { useAnimate } from "motion/react-mini";
import { Logo } from "./logo";
import { filmScreens } from "@/content/film";

export function ProductScreen({ step, animate = true }: { step: number; animate?: boolean }) {
  const [scope, run] = useAnimate<HTMLDivElement>();
  useEffect(() => {
    const pane = scope.current;
    if (!animate || !pane || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      run(pane, { opacity: [0.8, 1], transform: ["translateX(12px)", "translateX(0px)"] }, { duration: 0.3, ease: [0.23, 1, 0.32, 1] });
      pane.querySelectorAll(".tag, .fold, .chk, .fig, .done, [data-film=reply], [data-film=bubble]").forEach((el, i) => {
        run(el, { opacity: [0, 1], transform: ["translateY(12px)", "translateY(0px)"] }, { duration: 0.35, delay: i * 0.06, ease: [0.23, 1, 0.32, 1] });
      });
      observer.disconnect();
    }, { threshold: 0.2 });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [step, animate, scope, run]);
  return <figure className="product-figure"><div className="product-screen"><div className="win-head"><Logo /><span className="date mono">10 Oct 2026</span></div><div className="film-pane" ref={scope} key={step} dangerouslySetInnerHTML={{ __html: filmScreens[step] }} /></div><figcaption className="sample mono">Illustration · sample data</figcaption></figure>;
}
