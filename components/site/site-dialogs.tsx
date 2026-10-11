"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const InviteDialog = dynamic(() => import("./dialog-contents"));

// Any element with data-open-dialog="invite" opens the invite form.
// Without JavaScript the same links jump to the contact details at #invite.
export function SiteDialogs() {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const el = (event.target as Element).closest<HTMLElement>(
        "[data-open-dialog]",
      );
      if (!el) return;
      event.preventDefault();
      setTrigger(el);
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  return (
    trigger && <InviteDialog trigger={trigger} close={() => setTrigger(null)} />
  );
}
