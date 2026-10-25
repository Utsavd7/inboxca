"use client";
import { AnimatePresence, LazyMotion, MotionConfig, MotionGlobalConfig, animate, domMax, m, useIsPresent, useReducedMotion, type HTMLMotionProps } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Children, Fragment, cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

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
//                  Give each row a key. Row in ui.tsx is already an Item. In a table:
//                  <List as="tbody"> with <Item as="tr">; a leaving row fades in place first.
//                  Two lists on one page with the same keys need different names. An Item
//                  with a layoutId glides from one List to another (a lead between columns).
//   <Count>        a number: counts up once (CSS, before any script), then springs to new values;
//                  with an id, it does not count up again when a save redraws the page.
//   <Draw>         an SVG path or circle that draws itself once (rings, sparklines).

// Critically damped by default (no bounce); panels and toasts get a touch of spring.
export const spring = { type: "spring", duration: 0.32, bounce: 0 } as const;
export const springSoft = { type: "spring", duration: 0.45, bounce: 0.12 } as const;
export const quick = { type: "spring", duration: 0.18, bounce: 0 } as const;

export function MotionRoot({ children }: { children: React.ReactNode }) {
  // Less motion asked for: Motion's fades stop too, so everything changes at once.
  const reduce = useReducedMotion();
  useEffect(() => {
    MotionGlobalConfig.skipAnimations = !!reduce;
  }, [reduce]);
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
  // A leaving panel takes no clicks and is gone for screen readers at once.
  const present = useIsPresent();
  return (
    <>
      <m.div className="side-backdrop" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <m.section
        className="side-panel"
        role="dialog"
        aria-labelledby={labelledBy}
        aria-hidden={!present || undefined}
        inert={!present}
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
// twelve), so they show before any script runs (rise={false} where they replace an outline
// already shown). After that Motion takes over: a new row fades in, and the others glide when
// one moves or leaves. A table row cannot float out of its table, so it fades in place first.
// After a save the server draws the page afresh, so the rows are new elements: each one that
// was shown just before (by the same key, in the same list) glides from where it was instead
// of fading up again, and only the truly new ones fade up.
const InList = createContext("");
const shownRows = new Map<string, HTMLElement>();
export function List({ as: Tag = "ul", name, className = "", label, rise = true, children }: { as?: "ul" | "tbody"; name?: string; className?: string; label?: string; rise?: boolean; children: React.ReactNode }) {
  const scope = `${usePathname()}|${name ?? label ?? Tag}`;
  return (
    <Tag className={`${className}${rise ? " stagger" : ""}`.trim() || undefined} aria-label={label}>
      <InList value={scope}>
        <AnimatePresence mode={Tag === "tbody" ? "sync" : "popLayout"} initial={false}>
          {Children.map(children, (child) => (isValidElement(child) && typeof child.type !== "string" && child.type !== Fragment ? cloneElement(child as React.ReactElement<{ row?: string }>, { row: String(child.key) }) : child))}
        </AnimatePresence>
      </InList>
    </Tag>
  );
}
type ItemProps = { as?: "li" | "tr"; row?: string; className?: string; title?: string; layoutId?: string; children: React.ReactNode } & React.AriaAttributes & { [data: `data-${string}`]: string | boolean | undefined };
export function Item({ as = "li", row, className, children, ...rest }: ItemProps) {
  const scope = useContext(InList);
  const id = scope && row ? `${scope}|${row}` : "";
  const ref = useRef<HTMLElement>(null);
  // Where this row was on screen in the page just replaced, if it was there.
  const [was] = useState(() => (id && shownRows.get(id)?.isConnected ? shownRows.get(id)!.getBoundingClientRect().top : null));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!id || !el) return;
    shownRows.set(id, el);
    const by = was === null ? 0 : was - el.getBoundingClientRect().top;
    if (Math.abs(by) > 2 && !matchMedia("(prefers-reduced-motion: reduce)").matches) el.animate([{ transform: `translateY(${by}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    return () => {
      if (shownRows.get(id) === el) shownRows.delete(id);
    };
  }, [id, was]);
  const Row = as === "tr" ? m.tr : m.li;
  return (
    <Row
      {...rest}
      ref={ref as React.Ref<never>}
      className={was === null ? className : `${className ?? ""} kept`}
      layout={scope ? "position" : undefined}
      initial={scope ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={spring}
    >
      {children}
    </Row>
  );
}

// Counted up once; a count shown just before the page was drawn afresh (same id) carries on
// from its old value instead of counting up from nothing again.
const shownCounts = new Map<string, number>();
export function Count({ value, id }: { value: number; id?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = `${usePathname()}|${id}`;
  const [was] = useState(() => (id ? shownCounts.get(key) : undefined));
  const shown = useRef(was ?? value);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    if (!id) return;
    shownCounts.set(key, value);
    return () => {
      shownCounts.delete(key);
    };
  }, [id, key, value]);
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
      {value < 1000 && was === undefined ? (
        <span ref={ref} className="count-up" style={{ "--n": value } as CSSProperties} aria-hidden />
      ) : (
        <span ref={ref} aria-hidden>
          {(was ?? value).toLocaleString("en-IN")}
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
