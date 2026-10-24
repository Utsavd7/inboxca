import { SearchX } from "lucide-react";
import Link from "next/link";
import { Empty, PageHead } from "./ui";

// A client, paper or page in the app that is not there, or not this person's to see.
export default function AppNotFound() {
  return (
    <>
      <PageHead title="Page not found" sub="It may have been moved or removed, or the address was copied wrong." />
      <div style={{ marginTop: "var(--s5)" }}>
        <Empty Icon={SearchX} title="Nothing at this address">
          <Link className="b b-primary" href="/app">
            Go to Today
          </Link>
        </Empty>
      </div>
    </>
  );
}
