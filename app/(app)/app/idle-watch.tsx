"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { stillHere } from "@/app/(app)/actions";
import { toastStack } from "./motion";

// The firm's idle limit on this screen: after that many minutes without a click, key or
// scroll, the browser signs out, so an unattended PC shows nothing. A minute before, a note
// at the bottom right says so; any use of the screen, or Stay signed in, starts the count
// again. While the person is active it tells the server, at most once a minute.
export function IdleWatch({ minutes }: { minutes: number }) {
  const [warn, setWarn] = useState(false);
  useEffect(() => {
    let timer = 0;
    let warning = 0;
    let told = 0;
    const active = () => {
      window.clearTimeout(timer);
      window.clearTimeout(warning);
      setWarn(false);
      warning = window.setTimeout(() => setWarn(true), Math.max(0, minutes * 60_000 - 60_000));
      // A full page load on purpose: the sign out route clears this browser's cookies.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      timer = window.setTimeout(() => window.location.assign("/auth/sign-out?reason=idle"), minutes * 60_000);
      if (Date.now() - told > 60_000) {
        told = Date.now();
        void stillHere();
      }
    };
    const events = ["pointerdown", "pointermove", "keydown", "scroll"];
    for (const name of events) window.addEventListener(name, active, { passive: true });
    active();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(warning);
      for (const name of events) window.removeEventListener(name, active);
    };
  }, [minutes]);
  if (!warn) return null;
  // Shown only after the page has loaded, so the toast stack is there to join.
  const note = (
    <div className="toast" role="alert">
      <span>No one has used this screen for a while. InboxCA signs out in about a minute.</span>
      <button className="b" type="button" onClick={() => setWarn(false)}>Stay signed in</button>
    </div>
  );
  const stack = toastStack();
  return stack ? createPortal(note, stack) : note;
}
