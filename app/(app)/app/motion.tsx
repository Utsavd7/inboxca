"use client";
import { AnimatePresence, LazyMotion, MotionConfig, animate, domMax, m, useReducedMotion, type HTMLMotionProps } from "motion/react";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from "react";

// The app's motion, in a few small pieces every page can reuse (Motion, from "motion/react").
// The shell wraps everything in <MotionRoot>, so:
// - only m.* components are used (LazyMotion strict), and what must show at once (rows fading
//   up, numbers counting, rings drawing) starts in CSS, before any script. The features are
//   domMax, not the smaller domAnimation: the sliding indicators and gliding rows need layout
//   animation. They load with the page, not later: a later load changes the motion context
//   while streamed parts are still arriving, and React then draws those parts a second time;
// - anyone who asks their computer for less motion gets none (MotionConfig reducedMotion="user");
// - the springs below are the only timings, so every screen moves the same way.
// Route changes stay on React's ViewTransition (page-in.tsx). The pieces:
//   <Press href?>  a link (with href) or a button that presses in (scale .97); lift also
//                  raises it 2 px under the pointer. Plain .b buttons press in with CSS already.
//   <Lift>         a block (a card, a tile) that rises 2 px under the pointer.
//   <Indicator>    the one marker of the current item (sidebar, tabs, pills): render it inside
//                  the current item only, with the same id in every item; it glides between them.
//   <Presence>     wraps a conditional, {open && <SidePanel ... />}, so it animates out as well
//                  as in. SidePanel brings its own motion.
//   <List>, <Item> a list whose rows glide when one moves or leaves, and whose new rows fade in.
//                  Give each row a key. Row in ui.tsx is already an Item.
//   <Count>        a number: counts up once (CSS, before any script), then springs to new values.
//   <Draw>         an SVG path or circle that draws itself once (rings, sparklines).

// Critically damped by default (no bounce); panels and toasts get a touch of spring.
export const spring = { type: "spring", duration: 0.32, bounce: 0 } as const;
export const springSoft = { type: "spring", duration: 0.45, bounce: 0.12 } as const;
export const quick = { type: "spring", duration: 0.18, bounce: 0 } as const;

export function MotionRoot({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user" transition={spring}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

const MLink = m.create(Link);
type PressProps = { href?: string; scroll?: boolean; lift?: boolean; className?: string; title?: string; "aria-label"?: string; disabled?: boolean; onClick?: () => void; children: React.ReactNode };
export function Press({ href, scroll, lift = false, ...rest }: PressProps) {
  const feel = { whileTap: { scale: 0.97 }, ...(lift && { whileHover: { y: -2 } }), transition: quick };
  return href !== undefined ? <MLink href={href} scroll={scroll} {...feel} {...rest} /> : <m.button type="button" {...feel} {...rest} />;
}

export function Lift({ className, children, ...rest }: HTMLMotionProps<"div">) {
  return (
    <m.div className={className} whileHover={{ y: -2 }} transition={quick} {...rest}>
      {children}
    </m.div>
  );
}

export function Indicator({ id, className }: { id: string; className: string }) {
  return <m.span layoutId={id} className={className} transition={spring} aria-hidden />;
}

export function Presence({ children }: { children: React.ReactNode }) {
  return <AnimatePresence initial={false}>{children}</AnimatePresence>;
}

// The side panel's own motion (ui.tsx SidePanel): the page dims, the panel springs in from the
// right and leaves the same way.
export function PanelMotion({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <>
      <m.div className="side-backdrop" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <m.section
        className="side-panel"
        role="dialog"
        aria-labelledby={labelledBy}
        initial={{ opacity: 0, x: 48 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 48, transition: { duration: 0.18 } }}
        transition={springSoft}
      >
        {children}
      </m.section>
    </>
  );
}

// A toast (ui.tsx Toast): springs up from the bottom, then leaves downwards after five seconds.
export function ToastMotion({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShown(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <AnimatePresence>
      {shown && (
        <m.div className="toast" role="status" initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, transition: { duration: 0.18 } }} transition={springSoft}>
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}

// Rows fade up on the page's first showing with CSS (.stagger: 25 ms apart for the first
// twelve), so they show before any script runs. After that Motion takes over: a new row fades
// in, and the others glide when one moves or leaves.
const InList = createContext(false);
export function List({ className = "", label, children }: { className?: string; label?: string; children: React.ReactNode }) {
  return (
    <ul className={`${className} stagger`} aria-label={label}>
      <InList value>
        <AnimatePresence mode="popLayout" initial={false}>
          {children}
        </AnimatePresence>
      </InList>
    </ul>
  );
}
export function Item({ className, children }: { className?: string; children: React.ReactNode }) {
  const inList = useContext(InList);
  return (
    <m.li
      className={className}
      layout={inList ? "position" : undefined}
      initial={inList ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={spring}
    >
      {children}
    </m.li>
  );
}

export function Count({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || shown.current === value) return;
    const from = shown.current;
    shown.current = value;
    el.classList.remove("count-up");
    if (reduce) {
      el.textContent = value.toLocaleString("en-IN");
      return;
    }
    const run = animate(from, value, { ...spring, onUpdate: (now) => (el.textContent = Math.round(now).toLocaleString("en-IN")) });
    return () => run.stop();
  }, [value, reduce]);
  return (
    <>
      {value < 1000 ? (
        <span ref={ref} className="count-up" style={{ "--n": value } as CSSProperties} aria-hidden />
      ) : (
        <span ref={ref} aria-hidden>
          {value.toLocaleString("en-IN")}
        </span>
      )}
      <span className="sr-only">{value.toLocaleString("en-IN")}</span>
    </>
  );
}

// Drawn by its path length in CSS (app.css .draw), so it draws at first paint, script or not.
type DrawProps = { className?: string; progress?: number } & ({ d: string } | { cx: number; cy: number; r: number });
export function Draw({ className = "", progress = 1, ...shape }: DrawProps) {
  const feel = { className: `draw ${className}`, pathLength: 1, style: { "--p": progress } as CSSProperties };
  return "d" in shape ? <path d={shape.d} {...feel} /> : <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...feel} />;
}
