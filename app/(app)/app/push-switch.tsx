"use client";
import { useState } from "react";
import { savePushSubscription } from "@/app/(app)/actions";

// Turns on phone notifications in this browser (PLAN.md 5.17.3): the website's service
// worker, the browser's permission, and a subscription only the server keeps.
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
  if (state === "on") return <span className="hint">Notifications are on for this device.</span>;
  return (
    <span className="form-row">
      <button className="b b-secondary b-small" type="button" onClick={turnOn}>
        Turn on notifications on this device
      </button>
      {state === "blocked" && <span className="hint">The browser blocked them. Allow notifications for InboxCA in its settings, then try again.</span>}
      {state === "unsupported" && <span className="hint">This browser cannot show them. On an iPhone, add InboxCA to the home screen first and open it from there.</span>}
    </span>
  );
}
