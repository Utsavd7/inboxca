"use client";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

// A submit button that answers at once: while its form saves it is disabled and says so.
export function Pending({ busy = "Saving", children, ...props }: ComponentProps<"button"> & { busy?: string }) {
  const { pending, data } = useFormStatus();
  // Only the pressed button says it is busy when a form has several.
  const mine = pending && (!props.name || data?.get(props.name) === props.value);
  return (
    <button {...props} disabled={pending || props.disabled} aria-busy={mine || undefined}>
      {mine ? busy : children}
    </button>
  );
}
