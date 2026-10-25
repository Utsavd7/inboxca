"use client";
import { usePathname } from "next/navigation";
import { ViewTransition } from "react";

// Each page settles in when you move to it (the old one fades out, the new one rises), so the
// change of page is felt; a tab or a filter on the same page changes in place.
export function PageIn({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition key={usePathname()} enter="page-in" exit="page-out" default="none">
      <div className="page-in">{children}</div>
    </ViewTransition>
  );
}
