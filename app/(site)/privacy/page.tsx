import type { Metadata } from "next";
import { privacySections, legalNote, legalUpdated } from "@/content/legal";
import { Policy } from "@/components/site/policy";

export const metadata: Metadata = {
  title: "Privacy policy | InboxCA",
  description: "What InboxCA and this website collect, what they never keep, and your rights.",
};

export default function Page() {
  return (
    <Policy
      title="Privacy policy"
      lead="What this website collects, how InboxCA is built to handle a firm's data, and your rights."
      updated={legalUpdated}
      note={legalNote}
      sections={privacySections}
      contactTitle="Questions and complaints"
      contactText="Utsav Doshi and Ria Chheda answer privacy questions, rights requests and complaints: acknowledged within 48 hours, answered within 30 days."
    />
  );
}
