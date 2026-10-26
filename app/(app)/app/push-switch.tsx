"use client";
import { useState } from "react";
import { savePushSubscription } from "@/app/(app)/actions";

// Turns on notices in this browser on this computer (PLAN.md 5.17.3), off until the person
// asks: the website's service worker, the browser's permission, and a subscription only the
// server keeps. InboxCA is used on laptops (user, 26 Oct 2026), so the words say computer.
export function PushSwitch({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<"idle" | "on" | "blocked" | "unsupported">("idle");
  const turnOn = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    const registration = await navigator.serviceWorker.register("/sw.js");
    if ((await Notification.requestPermission()) !== "granted") return setState("blocked");
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await savePushSubscription(JSON.stringify(subscription));
    setState("on");
  };
  if (state === "on") return <span className="hint">Notices are on for this computer.</span>;
  return (
    <span className="form-row">
      <button className="b b-secondary b-small" type="button" onClick={turnOn}>
        Show a notice on this computer when someone needs your approval
      </button>
      {state === "blocked" && <span className="hint">The browser blocked notices. Allow notifications for InboxCA in the browser&apos;s settings, then try again.</span>}
      {state === "unsupported" && <span className="hint">This browser cannot show notices. Try another browser on this computer.</span>}
    </span>
  );
}
