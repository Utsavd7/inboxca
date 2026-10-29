import type { Metadata } from "next";
import { termsSections, legalNote, legalUpdated } from "@/content/legal";
import { Policy } from "@/components/site/policy";

export const metadata: Metadata = {
  title: "Terms | InboxCA",
  description: "The terms for this website and for firms that use InboxCA.",
};

export default function Page() {
  return (
    <Policy
      title="Terms"
      lead="The terms for this website and for firms that use InboxCA. Your firm accepts them at sign up."
      updated={legalUpdated}
      note={legalNote}
      sections={termsSections}
      contactTitle="Contact"
      contactText="We read every message."
    />
  );
}
