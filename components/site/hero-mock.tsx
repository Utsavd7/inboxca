"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Check, FileText, Folder, Mail, Send } from "lucide-react";
import { PreviewWindow } from "./product-screen";
const emails = [
  "Purchase bills for September",
  "Sales register attached",
  "Bank statement",
  "ITR acknowledgement request",
  "GST challan request",
  "Papers for this month",
];
const actions = [
  [Mail, "Read the email"],
  [Folder, "Save in the client folder"],
  [Send, "Reply from your firm’s email"],
] as const;
export function HeroMock() {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [phase, setPhase] = useState(0);
  const [count, setCount] = useState(emails.length);
  const elapsed = useRef(0);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || paused) return;
    let frame = 0,
      last = 0,
      visible = false;
    const tick = (now: number) => {
      if (last && visible && !document.hidden)
        elapsed.current += Math.min(now - last, 100);
      last = now;
      const t = elapsed.current % 18000;
      setPhase(t < 2500 ? 0 : t < 5000 ? 1 : t < 7500 ? 2 : 3);
      setCount(Math.max(0, emails.length - Math.floor(t / 1250)));
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [paused, reduced]);
  const done = reduced || phase === 3;
  return (
    <figure className="hero-figure">
      <div
        ref={ref}
        className={`hero-mock ${done ? "is-done" : ""} ${paused ? "is-paused" : ""}`}
      >
        <PreviewWindow
          title="Your firm’s email"
          detail={
            <span className="queue-count mono">
              {reduced ? 0 : count} to sort
            </span>
          }
        >
          <div className="hero-workspace" aria-hidden="true">
            <div className="email-queue">
              {emails.map((email, i) => (
                <div
                  className={`queue-row ${i >= count ? "sorted" : ""}`}
                  key={email}
                >
                  <span className="queue-avatar mono">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>Sample client</strong>
                    <small>{email}</small>
                  </span>
                  <Check size={15} className="queue-check" aria-hidden />
                </div>
              ))}
            </div>
            <div className="activity-pane">
              <div className="activity-paper">
                <FileText size={28} />
                <strong>Purchase bills.pdf</strong>
                <span className="mono">Client attachment</span>
              </div>
              <div className="activity-path">
                {actions.map(([Icon, label], i) => (
                  <div key={label} className={phase >= i ? "complete" : ""}>
                    <span>
                      {phase >= i ? <Check size={15} /> : <Icon size={15} />}
                    </span>
                    <p>{label}</p>
                  </div>
                ))}
              </div>
              <div className="activity-drive">
                <Folder size={17} />
                <span>
                  In your own
                  <br />
                  OneDrive or Dropbox
                </span>
              </div>
            </div>
          </div>
          <div className="hero-finished" aria-hidden={!done}>
            <span className="finished-icon">
              <Check size={26} aria-hidden />
            </span>
            <p className="finished-title">Nothing pending.</p>
            <p>Less chasing. More doing.</p>
            <div className="finished-path mono">
              <span>
                <Check size={14} aria-hidden />
                Read
              </span>
              <span>
                <Check size={14} aria-hidden />
                Saved
              </span>
              <span>
                <Check size={14} aria-hidden />
                Replied
              </span>
            </div>
          </div>
        </PreviewWindow>
        <span className="sr-only">
          Illustration of emails being read, papers saved and routine replies
          sent. It ends with nothing pending.
        </span>
      </div>
      <figcaption>
        <span className="sample mono">Illustration · sample data</span>
        <button
          className="mock-pause"
          onClick={() => setPaused(!paused)}
          disabled={reduced}
          aria-label={
            paused ? "Play inbox illustration" : "Pause inbox illustration"
          }
        >
          {paused ? (
            <Play size={14} aria-hidden />
          ) : (
            <Pause size={14} aria-hidden />
          )}
          <span>{reduced ? "Still preview" : paused ? "Play" : "Pause"}</span>
        </button>
      </figcaption>
    </figure>
  );
}
