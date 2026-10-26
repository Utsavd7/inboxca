"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";

// A submit button that answers at once: while its form saves, every button in it is disabled,
// so a second click sends nothing, and the one pressed spins (app.css) and keeps its words, or
// says busy when given.
export function Pending(all: ComponentProps<"button"> & { busy?: string }) {
  const { busy, children, ...props } = all;
  const { pending: saving } = useFormStatus();
  const button = useRef<HTMLButtonElement>(null);
  const [pressed, setPressed] = useState(false);
  // A button outside its form (form=) gets no status from it, so it counts as saving from its
  // own press until the server draws the page again, which gives it new props.
  const [sentWith, setSentWith] = useState<object>();
  // The pressed one is the form's submitter; a form sent by script counts its first button.
  useEffect(() => {
    const form = button.current?.form;
    const mark = (event: SubmitEvent) => {
      const mine = (event.submitter ?? form?.querySelector('button:not([type="button"], [type="reset"])')) === button.current;
      setPressed(mine);
      if (mine && !form?.contains(button.current)) setSentWith(all);
    };
    form?.addEventListener("submit", mark);
    return () => form?.removeEventListener("submit", mark);
  }, [all]);
  const pending = saving || sentWith === all;
  const mine = pending && pressed;
  return (
    <button ref={button} {...props} disabled={pending || props.disabled} aria-busy={mine || undefined}>
      {mine && busy ? busy : children}
    </button>
  );
}
