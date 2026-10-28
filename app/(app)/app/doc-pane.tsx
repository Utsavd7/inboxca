"use client";
import { Maximize2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { typing } from "./command";
import { paperPath, tabHistory } from "./shell";

// The tab's history entries that showed a paper beside a page, so closing goes back past
// every paper opened since (and past a sheet chosen in one) to the page they were opened from.
const panes = new Set<string>();
// What had the keyboard when the pane opened, to give it back when the pane closes.
let opener: HTMLElement | null = null;
// The width last chosen by dragging or with the arrow keys, kept for the rest of the visit.
let width = 0;

// A paper beside the page it was opened from (@doc), which stays on the left, narrower and
// still in use. The app's grid gives the pane its column, which eases open so the pane slides
// in from the right; Close, Esc or Back ease it shut and go back to the page as it was, with
// no reload. Its left edge can be dragged, or moved with the arrow keys, to make it wider.
export function DocPane({ name, full, chips, actions, children }: { name: React.ReactNode; full?: string; chips?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const title = useId();
  const pane = useRef<HTMLElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [share, setShare] = useState(() => (width ? Math.round((100 * width) / (innerWidth - 64)) : 52));

  useEffect(() => {
    if (paperPath.test(location.pathname)) panes.add(tabHistory().here?.key ?? "");
  });
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest(".doc-pane")) opener = active;
    pane.current?.focus({ preventScroll: true });
    // The page's own link to this paper stays marked while it is open (doc-pane.css).
    const links = document.querySelectorAll(`.stage a[href="${location.pathname}"], .stage [data-paper="${location.pathname.split("/")[3]}"]`);
    links.forEach((link) => link.setAttribute("data-open", ""));
    return () => {
      links.forEach((link) => link.removeAttribute("data-open"));
      setTimeout(() => {
        if (!document.querySelector(".doc-pane") && document.activeElement === document.body && opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, []);

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    const { here, behind } = tabHistory();
    let steps = 1;
    while (behind[steps - 1] && panes.has(behind[steps - 1].key)) steps++;
    // A folder chosen beside the paper moved the address on without it: stay there.
    const go = () => (!paperPath.test(location.pathname) ? router.push(location.pathname + location.search, { scroll: false }) : here ? history.go(-steps) : router.back());
    setTimeout(go, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !typing(event.target) && !document.querySelector("[role=dialog], [role=menu]")) close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // The pane's width, kept on the app's frame for the rest of the visit, as its share of the
  // room beside the sidebar's icons (52% at first, doc-pane.css); the page keeps 420 px.
  const size = (wanted: number) => {
    width = Math.round(Math.min(Math.max(wanted, 520), innerWidth - 64 - 420));
    pane.current?.closest<HTMLElement>(".ui")?.style.setProperty("--doc-w", `${width}px`);
    setShare(Math.round((100 * width) / (innerWidth - 64)));
  };
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const edge = event.currentTarget;
    edge.setPointerCapture(event.pointerId);
    setDragging(true);
    const move = (at: PointerEvent) => size(innerWidth - at.clientX);
    const stop = () => {
      setDragging(false);
      edge.removeEventListener("pointermove", move);
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("lostpointercapture", stop, { once: true });
  };

  return (
    <aside ref={pane} className={`doc-pane${leaving ? " is-leaving" : ""}${dragging ? " is-dragging" : ""}`} aria-labelledby={title} tabIndex={-1} inert={leaving}>
      <div
        className="doc-edge"
        role="separator"
        aria-orientation="vertical"
        aria-label="Width of the paper"
        aria-valuenow={share}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={drag}
        onKeyDown={(event) => {
          const by = { ArrowLeft: 40, ArrowRight: -40 }[event.key];
          if (!by) return;
          event.preventDefault();
          // From the width last chosen, not the one drawn, which is still easing to it.
          size((width || (pane.current?.offsetWidth ?? 0)) + by);
        }}
      />
      <div className="doc-card">
        <header className="doc-head">
          <div className="doc-title">
            <h2 id={title}>{name}</h2>
            <button type="button" className="b b-ghost b-icon" aria-label="Close" title="Close (Esc)" onClick={close}>
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="doc-bar">
            <div className="doc-chips">{chips}</div>
            <div className="doc-actions">
              {actions}
              {/* Its own page loads afresh: a link inside InboxCA would open it here again. */}
              {full && (
                <a className="b b-ghost b-small" href={full}>
                  <Maximize2 size={14} aria-hidden />
                  Open full page
                </a>
              )}
            </div>
          </div>
        </header>
        <div className="doc-body">{children}</div>
      </div>
    </aside>
  );
}
