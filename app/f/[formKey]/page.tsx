import type { Metadata } from "next";
import { LeadForm } from "@/app/(app)/app/leads/lead-form";
import { FirmFoot, LinkEnded, PublicPage } from "@/app/public-link";
import { sendEnquiry } from "./actions";
import { formFirm, formStamp } from "./firm";

export const metadata: Metadata = { title: "Send an enquiry", robots: { index: false, follow: false } };

// The firm's enquiry form (PLAN.md 5.12): a link the firm shares on its website, in email or
// on WhatsApp. No sign in. The time it opened is signed with the firm's key, so the form can
// tell a person from a bot without a paid captcha.
export default async function EnquiryForm({ params, searchParams }: { params: Promise<{ formKey: string }>; searchParams: Promise<{ sent?: string }> }) {
  const [{ formKey }, { sent }] = await Promise.all([params, searchParams]);
  const firm = await formFirm(formKey);
  if (!firm) return <LinkEnded />;
  const started = await formStamp(firm.id);
  return (
    <PublicPage
      firm={firm.name}
      shared
      band={
        <>
          <h1>{sent ? `Thank you. ${firm.name} will reply soon.` : `How can ${firm.name} help?`}</h1>
          <p className="public-for">{sent ? "Your enquiry has reached the team." : "Tell us a little about the work. We reply by email."}</p>
        </>
      }
    >
      {sent ? (
        <section className="public-card public-thanks" aria-label="Enquiry sent">
          <span className="public-big-tick" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
            </svg>
          </span>
          <h2>Enquiry sent</h2>
          <p>{firm.name} will email you back. You can close this page.</p>
        </section>
      ) : (
        <LeadForm action={sendEnquiry} hidden={{ key: formKey, started }} submit="Send enquiry" busy="Sending" open />
      )}
      <FirmFoot firmId={firm.id} name={firm.name} />
    </PublicPage>
  );
}
