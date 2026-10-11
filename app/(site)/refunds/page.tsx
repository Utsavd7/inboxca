import type { Metadata } from "next";
import { refundSections, legalNote, legalUpdated } from "@/content/legal";
import { Policy } from "@/components/site/policy";

export const metadata: Metadata = {
  title: "Refunds and cancelling | InboxCA",
  description: "The 14 day money back, cancelling, failed payments and how refunds are paid.",
};

export default function Page() {
  return (
    <Policy
      title="Refunds and cancelling"
      lead="Money back in 14 days, how to cancel, and what happens if a payment fails."
      updated={legalUpdated}
      note={legalNote}
      sections={refundSections}
      contactTitle="Help with a payment"
      contactText="Tell us your firm name and the date of the payment."
    />
  );
}
