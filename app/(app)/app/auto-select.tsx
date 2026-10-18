"use client";
import type { ComponentProps } from "react";

// A select that saves as soon as a new value is picked, by pressing its form's hidden
// button with the value `save`, so a row needs no Save button of its own.
export function AutoSelect({ save, ...props }: ComponentProps<"select"> & { save: string }) {
  return (
    <select
      {...props}
      className="cell-select"
      onChange={(event) => {
        const form = event.currentTarget.form;
        form?.requestSubmit(form.querySelector<HTMLButtonElement>(`button[value="${save}"]`));
      }}
    />
  );
}
