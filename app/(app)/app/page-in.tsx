"use client";
import { usePathname } from "next/navigation";

// Each page settles in when you move to it, so the change of page is felt; a tab or a
// filter on the same page changes in place.
export function PageIn({ children }: { children: React.ReactNode }) {
  return (
    <div key={usePathname()} className="page-in">
      {children}
    </div>
  );
}
