"use client";

// The browser's own print dialog; the page's print styles leave only the working paper.
export function PrintButton() {
  return <button className="b b-primary" type="button" onClick={() => window.print()}>Print</button>;
}
