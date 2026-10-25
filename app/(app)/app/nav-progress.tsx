"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

// Code that moves on by itself (a shortcut, the search, j and k in the Inbox) calls this first.
const GOING = "inboxca:going";
export const going = (href: string) => window.dispatchEvent(new CustomEvent(GOING, { detail: href }));

// The thin bar along the top of the stage while the next page loads (layout.tsx). It starts
// 120 ms after a link is followed or a search is sent, so a quick change never shows it, creeps
// towards the end, then fills and fades once the new page is in. It never takes a click.
export function NavProgress() {
  const bar = useRef<HTMLDivElement>(null);
  const arrived = useRef(() => {});
  const path = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    const el = bar.current!;
    const timers = { wait: 0, creep: 0, end: 0 };
    let at = 0;
    const here = () => location.pathname + location.search;
    let shown = here();
    const set = (to: number) => (el.style.transform = `scaleX(${to})`);
    const clear = () => {
      clearTimeout(timers.wait);
      clearInterval(timers.creep);
      clearTimeout(timers.end);
    };
    const finish = () => {
      clear();
      if (el.dataset.state !== "run") return;
      el.dataset.state = "done";
      set(1);
      timers.end = window.setTimeout(() => delete el.dataset.state, 360);
    };
    // Only a move to another address in this app: never a download, a new tab, or the page
    // already shown.
    const start = (to: string) => {
      const url = new URL(to, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/app/files/") || url.pathname + url.search === shown) return;
      clear();
      delete el.dataset.state;
      set(0);
      timers.wait = window.setTimeout(() => {
        el.dataset.state = "run";
        set((at = 0.12));
        timers.creep = window.setInterval(() => set((at += (0.9 - at) * 0.1)), 240);
        timers.end = window.setTimeout(finish, 10_000);
      }, 120);
    };
    arrived.current = () => {
      shown = here();
      finish();
    };
    // A link counts when Next follows it (it stops the browser's own); a form when it asks for
    // a page.
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link instanceof HTMLAnchorElement && event.defaultPrevented && !link.target && !link.hasAttribute("download")) start(link.href);
    };
    const submit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement;
      const button = event.submitter as HTMLButtonElement | null;
      if ((button?.formMethod || form.method) !== "get" || form.target) return;
      const url = new URL(button?.getAttribute("formaction") ?? form.getAttribute("action") ?? "", location.href);
      url.search = new URLSearchParams(new FormData(form, button) as unknown as Record<string, string>).toString();
      start(url.href);
    };
    const push = (event: Event) => start((event as CustomEvent<string>).detail);
    const back = () => start(location.href);
    window.addEventListener("click", click);
    window.addEventListener("submit", submit);
    window.addEventListener(GOING, push);
    window.addEventListener("popstate", back);
    return () => {
      clear();
      window.removeEventListener("click", click);
      window.removeEventListener("submit", submit);
      window.removeEventListener(GOING, push);
      window.removeEventListener("popstate", back);
    };
  }, []);
  useEffect(() => arrived.current(), [path, query]);
  return <div ref={bar} className="nav-bar" aria-hidden />;
}
