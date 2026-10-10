"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Check } from "lucide-react";
import { inboxRows } from "@/content/film";
export function HeroMock() {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [phase, setPhase] = useState(0);
  const [count, setCount] = useState(248);
  const elapsed = useRef(0);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    change(); query.addEventListener("change", change); return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || paused) return;
    let frame = 0, last = 0, visible = false;
    const tick = (now: number) => {
      if (last && visible && !document.hidden) elapsed.current += Math.min(now - last, 100);
      last = now;
      const t = elapsed.current % 20000;
      setPhase(t < 3000 ? 0 : t < 6000 ? 1 : 2);
      setCount(t < 3000 ? Math.round(12 + 236 * t / 3000) : t < 6000 ? Math.round(248 * (1 - (t - 3000) / 3000)) : 0);
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.2 });
    observer.observe(el); frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [paused, reduced]);
  const done = reduced || phase === 2;
  return <figure className="hero-figure">
    <div ref={ref} className={`hero-mock ${done ? "is-done" : ""}`}>
      <div className="mock-topline"><span className="mono">Your firm’s inbox</span><span className="window-dots" aria-hidden="true"><i /><i /><i /></span></div>
      <div className="hero-inbox" aria-hidden="true"><div className="mail-head"><span className="mail-title">Inbox</span><span className="badge mono"><span>{reduced ? 0 : count}</span> unread</span></div>
        <div className={`inbox-rows ${phase === 0 ? "filling" : phase === 1 ? "clearing" : ""}`} dangerouslySetInnerHTML={{ __html: inboxRows }} />
      </div>
      <div className="hero-payoff ledger" aria-hidden={!done}><span className="mono">Inbox · unread</span><div className="payoff-number mono">{reduced ? 0 : count}<span className="done-tick"><Check aria-hidden="true" /></span></div><div className="payoff-words">Nothing<br /><span>pending.</span></div></div>
      <span className="sr-only">Illustration of client emails being sorted. The inbox ends with nothing pending.</span>
    </div>
    <figcaption><span className="sample mono">Illustration · sample data</span><button className="mock-pause" onClick={() => setPaused(!paused)} disabled={reduced} aria-label={paused ? "Play inbox illustration" : "Pause inbox illustration"}>{paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}<span>{paused ? "Play" : "Pause"}</span></button></figcaption>
  </figure>;
}
