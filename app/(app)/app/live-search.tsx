"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";

// A list's search box that filters while typing: a quarter second after the last key it puts
// its form's fields in the address in place (the page's other choices kept, back to the first
// page, or what reset names), and the server filters as it does on Enter, which still works
// without JavaScript. The box stays the same element, so the focus and the caret stay put.
export function LiveSearch({ reset = ["page"], ...props }: ComponentProps<"input"> & { reset?: string[] }) {
  const router = useRouter();
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <input
      {...props}
      type="search"
      onChange={(event) => {
        const form = event.currentTarget.form;
        window.clearTimeout(timer.current);
        if (!form) return;
        timer.current = window.setTimeout(() => {
          const fields = [...new FormData(form)].filter((field): field is [string, string] => typeof field[1] === "string");
          const query = new URLSearchParams(location.search);
          for (const name of [...reset, ...fields.map(([name]) => name)]) query.delete(name);
          for (const [name, value] of fields) if (value.trim()) query.append(name, value);
          const path = new URL(form.action, location.href).pathname;
          router.replace(`${path}${query.size ? `?${query}` : ""}`, { scroll: false });
        }, 250);
      }}
    />
  );
}
