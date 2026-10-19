"use client";
import { useEffect, useState } from "react";
import { askMoreTime, stayLater } from "@/app/(app)/actions";

// Office hours end for this person at `at` (PLAN.md 5.17.4 #14, #15): 10 minutes before, a
// warning with one more hour (once a day) or a question to the owner for longer; at closing
// the page reloads, and the server shows the firm as closed.
export function ClosingWatch({ at, close, extended }: { at: number; close: string; extended: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      if (Date.now() >= at) window.location.reload();
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 20_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [at]);
  if (!now || at - now > 10 * 60_000) return null;
  return (
    <div className="alert closing" role="alert">
      <span>InboxCA closes for you at {close}. Finish what you are doing.</span>
      {!extended && (
        <form action={stayLater}>
          <button className="b b-secondary b-small">Stay 1 more hour</button>
        </form>
      )}
      <form action={askMoreTime} className="form-row">
        <select name="hours" aria-label="How much more time" defaultValue="2">
          <option value="1">1 more hour</option>
          <option value="2">2 more hours</option>
          <option value="3">3 more hours</option>
        </select>
        <button className="b b-ghost b-small">Ask the owner</button>
      </form>
    </div>
  );
}
