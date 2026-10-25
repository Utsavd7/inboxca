"use client";
import { useEffect } from "react";

// Esc closes the open side panel, as its Close link does, but not while the field in use has
// been changed, so an unsent email or a half filled form is never lost.
export function PanelEscape() {
  useEffect(() => {
    const changed = new WeakSet<EventTarget>();
    const mark = (event: Event) => event.target && changed.add(event.target);
    const close = (event: KeyboardEvent) => {
      const field = document.activeElement;
      if (event.key !== "Escape" || (field?.matches("textarea, select, input:not([type=checkbox], [type=radio])") && changed.has(field))) return;
      document.querySelector<HTMLAnchorElement>(".side-panel-head a")?.click();
    };
    window.addEventListener("input", mark, true);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("input", mark, true);
      window.removeEventListener("keydown", close);
    };
  }, []);
  return null;
}
