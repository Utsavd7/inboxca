"use client";
import { useEffect } from "react";

// Esc closes the open side panel, as its Close link does.
export function PanelEscape() {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") document.querySelector<HTMLAnchorElement>(".side-panel-head a")?.click();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return null;
}
