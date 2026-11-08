"use client";
import type { ComponentProps } from "react";

// A preset is a starting point: choosing one fills the signing in limits of the same form with
// its own, to change before the one Save.
export function PresetRadio({ idle, india, ...props }: ComponentProps<"input"> & { idle: number; india: boolean }) {
  return (
    <input
      {...props}
      type="radio"
      onChange={(event) => {
        const fields = event.currentTarget.form?.elements;
        const minutes = fields?.namedItem("idle_minutes"), only = fields?.namedItem("india_only");
        if (minutes instanceof HTMLSelectElement) minutes.value = String(idle);
        if (only instanceof HTMLInputElement) only.checked = india;
      }}
    />
  );
}
