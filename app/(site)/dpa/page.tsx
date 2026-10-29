import type { Metadata } from "next";
import { dpaSections, dpaUpdated, legalNote } from "@/content/legal";
import { Policy } from "@/components/site/policy";

export const metadata: Metadata = {
  title: "Data processing agreement | InboxCA",
  description: "How InboxCA handles your clients' data on your firm's instructions.",
};

export default function Page() {
  return (
    <Policy
      title="Data processing agreement"
      lead="How Orelu processes your clients' data on your firm's instructions. Your firm accepts it at sign up."
      updated={dpaUpdated}
      note={legalNote}
      sections={dpaSections}
      contactTitle="Contact"
      contactText="We read every message."
    />
  );
}
