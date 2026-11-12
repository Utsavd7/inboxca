"use client";
import { useEffect, useRef, useState } from "react";
import { panKindHint } from "@/src/lib/clients";

// Under Client type: a quiet line while the PAN's 4th letter says another kind (clients.ts).
// Reads its form's PAN box, or the saved PAN when the form has none.
export function PanKindHint({ pan = "" }: { pan?: string }) {
  const line = useRef<HTMLParagraphElement>(null);
  const [hint, setHint] = useState("");
  useEffect(() => {
    const form = line.current?.closest("form");
    if (!form) return;
    const check = () => {
      const fields = new FormData(form);
      setHint(panKindHint(String(fields.get("pan") ?? pan), String(fields.get("kind") ?? "")));
    };
    check();
    form.addEventListener("input", check);
    return () => form.removeEventListener("input", check);
  }, [pan]);
  return <p ref={line} className="hint" role="status" hidden={!hint}>{hint}</p>;
}
