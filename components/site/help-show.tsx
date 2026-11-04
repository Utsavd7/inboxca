"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, ChevronRight, FolderOpen, House, Inbox, Pause, Play, Scale, Settings, Users, UsersRound } from "lucide-react";
import { Logo } from "./logo";
import { useReduced } from "./use-reduced";

// The app's sidebar, in its own order and with its own icons (app/(app)/app/nav-links.tsx).
const pages = { Today: House, Inbox, Clients: UsersRound, Documents: FolderOpen, Calendar: CalendarDays, Notices: Scale, People: Users, Settings } as const;
export type Page = keyof typeof pages;
// The sidebar page lit up (none outside the app), the screen's name and its part.
export type Screen = readonly [page: Page | null, title: string, part?: string];
export type Frame = { at: number; screen: Screen; body: ReactNode };

const FRAME_MS = 4000;
const ease = [0.23, 1, 0.32, 1] as const;

// An article's steps (or its points, when it has none) beside a small InboxCA window that plays
// them: each frame lights the item it shows (at), and a click on an item shows its frame. It
// plays while in view and stops only on Pause. With reduced motion it shows the still frame
// and lights nothing until an item is chosen. The frames and the rest of the article are
// rendered on the server.
export function HelpShow({ frames, still, items, kind, children }: { frames: readonly Frame[]; still: number; items: readonly string[]; kind: "steps" | "points"; children: ReactNode }) {
  const reduced = useReduced();
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [seen, setSeen] = useState(false);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const shown = step ?? (reduced ? still : 0);
  const lit = reduced && step === null ? -1 : frames[shown].at;
  const running = playing && seen && !reduced;
  const show = (next: number) => {
    setStep(next);
    setBeat(beat + 1);
  };
  const [page, title, part] = frames[shown].screen;
  const List = kind === "steps" ? "ol" : "ul";

  return (
    <div className="help-body">
      <figure className="hs" ref={root} aria-label="A picture of this in InboxCA, with sample data">
        <div className="hs-window" aria-hidden>
          <div className="hs-bar">
            <Logo markOnly />
            <strong>{title}</strong>
            {part && (
              <>
                <ChevronRight size={13} />
                <span>{part}</span>
              </>
            )}
          </div>
          <div className={`hs-main${page ? "" : " is-outside"}`}>
            {page && (
              <span className="hs-rail">
                {Object.entries(pages).map(([name, Icon]) => (
                  <span key={name}>
                    {name === page && <motion.span layoutId="hs-rail" className="hs-rail-pick" transition={{ duration: 0.45, ease }} />}
                    <Icon size={15} />
                  </span>
                ))}
              </span>
            )}
            <div className="hs-view">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={`${shown}-${beat}`} className="hs-frame" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.22, ease }}>
                  {frames[shown].body}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
        <figcaption className="hs-foot">
          <span className="hs-dots" aria-hidden>
            {frames.map((_, index) => (
              <span key={index} className={index < shown ? "is-past" : undefined}>
                {index === shown && !reduced && (
                  <span
                    key={beat}
                    className="hs-fill"
                    style={{ animationDuration: `${FRAME_MS}ms`, animationPlayState: running ? "running" : "paused" }}
                    onAnimationEnd={() => show((shown + 1) % frames.length)}
                  />
                )}
              </span>
            ))}
          </span>
          <Link className="hs-sample" href="/security#website">
            Sample data
          </Link>
          {!reduced && (
            <button type="button" className="demo-play" onClick={() => setPlaying(!playing)}>
              {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
              {playing ? "Pause" : "Play"}
            </button>
          )}
        </figcaption>
      </figure>
      <div className="help-text">
        <section className="help-part" aria-labelledby={kind}>
          <h2 id={kind}>{kind === "steps" ? "Steps" : "In short"}</h2>
          <List className={kind === "steps" ? "help-steps" : "help-points"}>
            {items.map((item, index) => {
              const frame = frames.findIndex((one) => one.at === index);
              return (
                <li key={item} className={index === lit ? "is-lit" : undefined}>
                  {frame < 0 ? (
                    item
                  ) : (
                    <button type="button" className="hs-item" aria-current={index === lit ? "step" : undefined} onClick={() => show(frame)}>
                      {index === lit && <motion.span layoutId="hs-lit" className="hs-lit" transition={{ duration: 0.45, ease }} />}
                      <span>{item}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </List>
        </section>
        {children}
      </div>
    </div>
  );
}
