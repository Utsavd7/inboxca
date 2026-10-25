"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";

// A submit button that answers at once: while its form saves, every button in it is disabled,
// so a second click sends nothing, and the one pressed spins (app.css) and keeps its words, or
// says busy when given.
export function Pending({ busy, children, ...props }: ComponentProps<"button"> & { busy?: string }) {
  const { pending } = useFormStatus();
  const button = useRef<HTMLButtonElement>(null);
  const [pressed, setPressed] = useState(false);
  // The pressed one is the form's submitter; a form sent by script counts its first button.
  useEffect(() => {
    const form = button.current?.form;
    const mark = (event: SubmitEvent) => setPressed((event.submitter ?? form?.querySelector('button:not([type="button"], [type="reset"])')) === button.current);
    form?.addEventListener("submit", mark);
    return () => form?.removeEventListener("submit", mark);
  }, []);
  const mine = pending && pressed;
  return (
    <button ref={button} {...props} disabled={pending || props.disabled} aria-busy={mine || undefined}>
      {mine && busy ? busy : children}
    </button>
  );
}
