"use client";
import { useState } from "react";
import { savePushSubscription } from "@/app/(app)/actions";

// Turns on notices in this browser (PLAN.md 5.17.3), from Settings, off until pressed: the
// website's service worker, the browser's permission, and a subscription only the server keeps.
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
  if (state === "on") return <p className="hint">Notices are on for this computer.</p>;
  return (
    <span className="form-row">
      <button className="b b-secondary" type="button" onClick={turnOn}>
        Turn on notices on this computer
      </button>
      {state === "blocked" && <span className="hint">The browser blocked them. Allow notifications for InboxCA in its settings, then try again.</span>}
      {state === "unsupported" && <span className="hint">This browser cannot show notices. Open InboxCA in Chrome or Edge to turn them on.</span>}
    </span>
  );
}
