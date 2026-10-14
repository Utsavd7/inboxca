"use client";
import { useEffect } from "react";
import { stillHere } from "@/app/(app)/actions";

// The firm's idle limit on this screen: after that many minutes without a click, key or
// scroll, the browser signs out, so an unattended PC shows nothing. While the person is
// active it tells the server, at most once a minute.
export function IdleWatch({ minutes }: { minutes: number }) {
  useEffect(() => {
    let timer = 0;
    let told = 0;
    const active = () => {
      window.clearTimeout(timer);
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
      for (const name of events) window.removeEventListener(name, active);
    };
  }, [minutes]);
  return null;
}
