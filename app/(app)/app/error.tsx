"use client";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Empty, PageHead } from "./ui";

// A page in the app that failed to open: a plain line, Try again, and the way back to Today,
// inside the usual sidebar. What went wrong stays in the server log, never on the screen.
export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <PageHead title="This page did not open" sub="InboxCA could not open this page just now. Nothing was changed." />
      <div style={{ marginTop: "var(--s5)" }}>
        <Empty Icon={TriangleAlert} title="Try again in a minute">
          <span>If it still does not open, go to Today and try again later.</span>
          <button className="b b-primary" type="button" onClick={() => retry()}>
            Try again
          </button>
          <Link className="b b-secondary" href="/app">
            Go to Today
          </Link>
        </Empty>
      </div>
    </>
  );
}
