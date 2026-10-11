"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
const DialogContents = dynamic(() => import("./dialog-contents"));
export function SiteDialogs() {
  const [dialog, setDialog] = useState<{
    kind: "invite" | "film";
    trigger: HTMLElement;
  } | null>(null);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const trigger = (event.target as Element).closest<HTMLElement>(
        "[data-open-dialog]",
      );
      if (!trigger) return;
      event.preventDefault();
      setDialog({
        kind: trigger.dataset.openDialog as "invite" | "film",
        trigger,
      });
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  return (
    dialog && (
      <DialogContents
        kind={dialog.kind}
        trigger={dialog.trigger}
        close={() => setDialog(null)}
      />
    )
  );
}
