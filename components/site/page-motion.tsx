"use client";
import { useEffect } from "react";
import { useAnimate } from "motion/react-mini";

export function PageMotion() {
  const [, animate] = useAnimate();
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frames = new Set<number>();
    const observer = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        animate(target, { opacity: [0.55, 1], transform: ["translateY(16px)", "translateY(0px)"] }, { duration: 0.45, ease: [0.23, 1, 0.32, 1] });
        target.querySelectorAll<HTMLElement>("[data-count]").forEach(node => {
          const value = Number(node.dataset.count), start = performance.now();
          const count = (now: number) => {
            const progress = Math.min((now - start) / 800, 1);
            node.textContent = String(Math.round(value * (1 - Math.pow(1 - progress, 3))));
            if (progress < 1) frames.add(requestAnimationFrame(count));
          };
          frames.add(requestAnimationFrame(count));
        });
        observer.unobserve(target);
      }
    }, { threshold: 0.12 });
    document.querySelectorAll("[data-reveal]").forEach(el => observer.observe(el));
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const pointer = (e: PointerEvent) => {
      if (!fine.matches) return;
      const card = (e.target as Element).closest<HTMLElement>("[data-spotlight]");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--pointer-x", `${e.clientX - rect.left}px`);
      card.style.setProperty("--pointer-y", `${e.clientY - rect.top}px`);
    };
    document.addEventListener("pointermove", pointer, { passive: true });
    return () => { observer.disconnect(); frames.forEach(cancelAnimationFrame); document.removeEventListener("pointermove", pointer); };
  }, [animate]);
  return null;
}
