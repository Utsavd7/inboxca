import type { Metadata } from "next";
import { securitySections, securityUpdated } from "@/content/security";
import { Policy } from "@/components/site/policy";

export const metadata: Metadata = {
  title: "Security policy | InboxCA",
  description:
    "How InboxCA is built to keep a CA firm's data safe: where data lives, what is never kept, encryption, access and AI.",
};

export default function Page() {
  return (
    <Policy
      title="Security policy"
      lead="CA firms hold PAN, Aadhaar, bank and income papers. This is how InboxCA is built to keep them safe."
      updated={securityUpdated}
      note="InboxCA is in development, so this page describes how it is being built. It will be reviewed again before the first firm uses it with real data."
      sections={securitySections}
      contactTitle="Report a security problem"
      contactText="Please include what you saw and how to see it again."
    />
  );
}
