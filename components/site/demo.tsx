"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  BellRing,
  Check,
  FileText,
  Folder,
  Paperclip,
  Pause,
  Play,
} from "lucide-react";
import { demoSteps } from "@/content/site";
import { Logo } from "./logo";
import { useReduced } from "./use-reduced";

// One fictional email followed through the five jobs. Every screen is an illustration;
// the asterisk beside the date leads to the note that says so.
const STEP_MS = 4200;
const ease = [0.23, 1, 0.32, 1] as const;
const spring = { type: "spring", duration: 0.6, bounce: 0.14 } as const;
const list = {
  hidden: {},
  show: { transition: { staggerChildren: 0.17, delayChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

function Done({ children }: { children: React.ReactNode }) {
  return (
    <span className="chip chip-done">
      <Check size={14} strokeWidth={3} aria-hidden />
      {children}
    </span>
  );
}

function Email() {
  return (
    <div className="card mail">
      <div className="mail-from">
        <span className="avatar">PT</span>
        <span>
          <strong>Patel Textiles</strong>
          <small>accounts@pateltextiles.example</small>
        </span>
        <span className="num mail-time">10:42</span>
      </div>
      <p className="mail-subject">Purchase bills for September</p>
      <p className="mail-body">
        Please find attached our purchase bills for September. The bank
        statement will follow.
      </p>
      <span className="attachment">
        <Paperclip size={15} aria-hidden />
        <span className="num">IMG_2291.pdf</span>
      </span>
    </div>
  );
}

function ReadScene() {
  return (
    <motion.div className="scene" variants={list} initial="hidden" animate="show">
      <motion.div variants={item} className="scan-wrap">
        <Email />
        <span className="scan" aria-hidden />
      </motion.div>
      <motion.div variants={item} className="tags">
        <span className="tags-label">InboxCA read this as</span>
        <motion.span variants={item} className="chip">
          Client: Patel Textiles
        </motion.span>
        <motion.span variants={item} className="chip">
          GST data
        </motion.span>
        <motion.span variants={item} className="chip">
          <span className="num">September 2026</span>
        </motion.span>
        <motion.span variants={item}>
          <Done>Sorted</Done>
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

function FileScene() {
  return (
    <motion.div className="scene" variants={list} initial="hidden" animate="show">
      <motion.div variants={item} className="card rename">
        <span className="rename-old num">IMG_2291.pdf</span>
        <span className="rename-arrow" aria-hidden>
          becomes
        </span>
        <span className="rename-new num">
          Patel Textiles - Purchase bills - Sep 2026.pdf
        </span>
      </motion.div>
      <motion.div variants={item} className="card tree">
        {["Your OneDrive", "GST", "FY 2026-27", "Patel Textiles"].map(
          (name, depth) => (
            <motion.div
              key={name}
              variants={item}
              className="tree-row"
              style={{ paddingLeft: depth * 22 }}
            >
              <Folder size={17} aria-hidden />
              <span className={depth === 2 ? "num" : undefined}>{name}</span>
            </motion.div>
          ),
        )}
        <motion.div
          variants={item}
          className="tree-row tree-file"
          style={{ paddingLeft: 4 * 22 }}
        >
          <FileText size={17} aria-hidden />
          <span className="num">Purchase bills - Sep 2026.pdf</span>
          <Done>Saved</Done>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

const reply =
  "Received, thank you. We still need your bank statement for September.";

function ReplyScene() {
  const reduced = useReduced();
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let id: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      id = setInterval(
        () => setTyped((n) => (n >= reply.length ? n : n + 1)),
        20,
      );
    }, 450);
    return () => {
      clearTimeout(start);
      clearInterval(id);
    };
  }, [reduced]);
  const shown = reduced ? reply.length : typed;
  const done = shown >= reply.length;
  return (
    <motion.div className="scene" variants={list} initial="hidden" animate="show">
      <motion.div variants={item} className="card compose">
        <div className="compose-line">
          <span>To</span>
          <strong>Patel Textiles</strong>
        </div>
        <div className="compose-line">
          <span>From</span>
          <strong>Your firm&apos;s own email address</strong>
        </div>
        <p className="compose-body" aria-label={reply}>
          <span aria-hidden>{reply.slice(0, shown)}</span>
          {!done && <span className="caret" aria-hidden />}
        </p>
        <div className="compose-foot">
          <span className={`sent ${done ? "is-on" : ""}`}>
            <Done>
              Sent <span className="num">10:43</span>
            </Done>
          </span>
          <small>Written and sent by InboxCA</small>
        </div>
      </motion.div>
      <motion.p variants={item} className="scene-note">
        A request it cannot answer goes to your team, not to the client.
      </motion.p>
    </motion.div>
  );
}

function RemindScene() {
  return (
    <motion.div className="scene" variants={list} initial="hidden" animate="show">
      <motion.div variants={item} className="card checklist">
        <p className="card-title">
          Patel Textiles, GST for <span className="num">September 2026</span>
        </p>
        {[
          ["Sales register", "Received"],
          ["Purchase bills", "Received today"],
        ].map(([paper, state]) => (
          <motion.div key={paper} variants={item} className="check-row">
            <span className="tick-box is-done">
              <Check size={14} strokeWidth={3} aria-hidden />
            </span>
            <span>{paper}</span>
            <small>{state}</small>
          </motion.div>
        ))}
        <motion.div variants={item} className="check-row is-missing">
          <span className="tick-box" />
          <span>Bank statement</span>
          <span className="chip">
            <BellRing size={14} aria-hidden />
            Reminder on <span className="num">14 Oct</span>
          </span>
        </motion.div>
      </motion.div>
      <motion.p variants={item} className="scene-note">
        If the bank statement arrives first, the reminder is skipped.
      </motion.p>
    </motion.div>
  );
}

function FormScene({
  approved,
  approve,
}: {
  approved: boolean;
  approve: () => void;
}) {
  return (
    <motion.div className="scene" variants={list} initial="hidden" animate="show">
      <motion.div variants={item} className="card form">
        <div className="form-head">
          <p className="card-title">
            GSTR-3B, <span className="num">September 2026</span>
          </p>
          <span className={`chip ${approved ? "chip-done" : ""}`}>
            {approved ? "Approved" : "Ready to check"}
          </span>
        </div>
        {[
          ["Outward taxable supplies", "₹18,42,300"],
          ["Input tax credit", "₹2,11,640"],
          ["Tax payable", "₹1,19,974"],
        ].map(([label, figure]) => (
          <motion.div key={label} variants={item} className="figure-row">
            <span>{label}</span>
            <span className="num">{figure}</span>
          </motion.div>
        ))}
        <motion.div variants={item} className="form-foot">
          <button
            type="button"
            className={`approve ${approved ? "is-approved" : ""}`}
            onClick={approve}
            disabled={approved}
          >
            {approved && <Check size={17} strokeWidth={3} aria-hidden />}
            {approved ? "Approved" : "Approve"}
          </button>
          <small>
            {approved
              ? "Now your team files it on the portal."
              : "Try it. Nothing is filed without this click."}
          </small>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export function Demo() {
  const reduced = useReduced();
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [beat, setBeat] = useState(0);
  const [seen, setSeen] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setSeen(entry.isIntersecting),
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // On a phone the steps sit in a row; keep the current one in view without moving the page.
  useEffect(() => {
    const tab = root.current?.querySelector<HTMLElement>(`#demo-tab-${step}`);
    const strip = tab?.parentElement;
    if (!tab || !strip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({
      left: tab.offsetLeft - (strip.clientWidth - tab.clientWidth) / 2,
      behavior: "smooth",
    });
  }, [step]);

  // Only the Pause button stops it. Hovering or clicking inside does not.
  const running = playing && seen && !reduced;
  const go = (next: number) => {
    setStep(next);
    setApproved(false);
  };
  const keys = (event: React.KeyboardEvent) => {
    const move =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (!move) return;
    event.preventDefault();
    const next = (step + move + demoSteps.length) % demoSteps.length;
    go(next);
    root.current
      ?.querySelector<HTMLButtonElement>(`#demo-tab-${next}`)
      ?.focus();
  };

  return (
    <div className="demo" ref={root}>
      <div className="demo-frame">
        <div className="demo-rail">
          <div
            className="demo-tabs"
            role="tablist"
            aria-label="What InboxCA does with one email"
            aria-orientation="vertical"
            onKeyDown={keys}
          >
            {demoSteps.map(([title, line], index) => {
              const selected = index === step;
              return (
                <button
                  key={title}
                  type="button"
                  role="tab"
                  id={`demo-tab-${index}`}
                  aria-selected={selected}
                  aria-controls="demo-stage"
                  tabIndex={selected ? 0 : -1}
                  className="demo-tab"
                  onClick={() => go(index)}
                >
                  <span className="demo-n num">{index + 1}</span>
                  <span>
                    <strong>{title}</strong>
                    <span className="demo-line">
                      <span>{line}</span>
                    </span>
                  </span>
                  {selected && (
                    <motion.span
                      layoutId="demo-active"
                      className="demo-active"
                      transition={spring}
                    >
                      {!reduced && (
                        <span
                          key={`${step}-${beat}`}
                          className="demo-bar"
                          style={{
                            animationDuration: `${STEP_MS}ms`,
                            animationPlayState: running ? "running" : "paused",
                          }}
                          onAnimationEnd={() =>
                            go((step + 1) % demoSteps.length)
                          }
                        />
                      )}
                    </motion.span>
                  )}
                </button>
              );
            })}
          </div>
          {!reduced && (
            <button
              type="button"
              className="demo-play"
              onClick={() => setPlaying(!playing)}
            >
              {playing ? (
                <Pause size={15} aria-hidden />
              ) : (
                <Play size={15} aria-hidden />
              )}
              {playing ? "Pause" : "Play"}
            </button>
          )}
        </div>
        <div
          className="demo-stage"
          id="demo-stage"
          role="tabpanel"
          aria-labelledby={`demo-tab-${step}`}
        >
          <div className="stage-bar">
            <Logo />
            <span className="num">
              10 Oct 2026
              <Link
                className="star"
                href="/security#website"
                aria-label="About the sample data on this page"
              >
                *
              </Link>
            </span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              className="scene-shell"
              initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
              transition={{ duration: 0.36, ease }}
            >
              {step === 0 && <ReadScene />}
              {step === 1 && <FileScene />}
              {step === 2 && <ReplyScene />}
              {step === 3 && <RemindScene />}
              {step === 4 && (
                <FormScene
                  approved={approved}
                  approve={() => {
                    // Start this step's timer again so the approved form is seen.
                    setApproved(true);
                    setBeat(beat + 1);
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
