// Privacy policy, terms and refund policy. Drafted from PLAN.md (D5, D6, D33, D36,
// sections 5.14.1 and 8). InboxCA is in development and takes no payments yet, so each
// page says how things will work. A lawyer must review all three before the pilot.
import { analyticsToken } from "@/src/lib/site";

export const legalUpdated = "27 Oct 2026";
export const legalNote =
  "InboxCA is in development. This page says how things will work when it opens, and a lawyer will review it before the first firm joins.";

export const privacySections = [
  {
    id: "who",
    title: "Who we are",
    points: [
      "InboxCA is a product by Orelu, a business based in India and run by Utsav Doshi and Ria Chheda.",
      "This policy covers this website, and it explains how InboxCA is built to handle a firm's data.",
    ],
  },
  {
    id: "website",
    title: "What this website collects",
    points: [
      analyticsToken
        ? "The website's pages set no cookies and show no advertising. It counts visits without cookies and without knowing who you are."
        : "Nothing by itself. The website's pages set no cookies and have no advertising, tracking or analytics.",
      "Signing up or signing in sets only the cookies that keep you signed in, remember the plan you chose and remember how you set up the app's screens.",
      "If you sign up, you give us your firm's name, your work email and your firm's state.",
      "Once your firm uses InboxCA, it also keeps your team's work emails and sign in records, the computers and office internet connections your firm approves, the record of who did what, and, for billing, the owner's mobile number and the firm's address and GSTIN.",
      "We use those details to run your firm's account and to email you sign in codes. We do not sell them or pass them on.",
      "Ask us at any time and we will delete them.",
    ],
  },
  {
    id: "product",
    title: "Your clients' data in InboxCA",
    points: [
      "Your firm decides what happens to its clients' data. InboxCA only follows your firm's instructions, under a signed data processing agreement.",
      "Client files stay in your firm's own OneDrive or Dropbox.",
      "InboxCA keeps your client list, your records and the figures read from files, so that it can do its work.",
      "InboxCA does not keep email subjects or email text, portal passwords, OTPs, card details or full Aadhaar numbers.",
    ],
  },
  {
    id: "use",
    title: "What the data is used for",
    points: [
      "Only the work your firm asks for: sorting emails, filing papers, replying, reminding and preparing forms.",
      "Never advertising, and never training AI.",
      "It is never sold.",
    ],
  },
  {
    id: "share",
    title: "Who else handles it",
    points: [
      "Only the services InboxCA runs on, each under its own agreement. They are listed in the security policy.",
      "The AI service receives only the email or paper being worked on, and must keep nothing.",
      "We give data to an authority only when the law requires it.",
    ],
  },
  {
    id: "keep",
    title: "How long it is kept",
    points: [
      "Your files stay in your drive for as long as your firm keeps them.",
      "A file passing through InboxCA is removed within 24 hours, or within 7 days if your drive cannot be reached.",
      "Safety copies of deleted or changed files are kept for 30 days.",
      "The record of who did what is kept for 12 to 36 months, as your firm chooses.",
      "When a firm leaves, InboxCA's own records for it are removed and its backups expire within 35 days. The files stay in the firm's drive.",
    ],
  },
  {
    id: "where",
    title: "Where it is kept",
    points: [
      "Records are kept in a database in Mumbai, India.",
      "InboxCA's temporary files and safety copies are held outside India, and they are encrypted.",
      "Your files are wherever your drive provider keeps them.",
    ],
  },
  {
    id: "rights",
    title: "Your rights",
    points: [
      "You can ask to see, correct or delete the personal data we hold about you.",
      "If you are a client of a CA firm, ask your firm first. It decides what happens to your data, and InboxCA helps it answer.",
      "If we do not settle a complaint, you can take it to the Data Protection Board of India.",
    ],
  },
  {
    id: "changes",
    title: "Changes to this policy",
    points: [
      "When this policy changes, the date at the top changes. Firms using InboxCA are told by email before a change that affects them.",
    ],
  },
] as const;

export const termsSections = [
  {
    id: "about",
    title: "About these terms",
    points: [
      "InboxCA is a product by Orelu. These terms cover this website.",
      "The full terms for firms that use InboxCA will be published here before the first firm joins.",
    ],
  },
  {
    id: "website",
    title: "This website",
    points: [
      "InboxCA is in development. The website describes what it is being built to do.",
      "The screens are illustrations, and the firms, names and figures in them are sample data.",
      "Prices are estimates, before GST. They are not an offer and may change before InboxCA opens.",
    ],
  },
  {
    id: "firms",
    title: "What firms will agree to",
    points: [
      "One login is for one person.",
      "Your firm owns its files and its clients' data. InboxCA works on them only as your firm instructs.",
      "InboxCA prepares forms. Your team checks every figure and files every return. InboxCA gives no tax advice.",
      "You connect your own mailbox and drive, and you can disconnect them at any time.",
      "Plans are paid monthly or yearly through Cashfree AutoPay. The refund policy explains the 14 day money back.",
    ],
  },
  {
    id: "drive",
    title: "Drive access",
    points: [
      "When you connect your drive, InboxCA may read the files in the folders you choose and every file it saves; make folders, and rename and move folders and files to keep them in order; save files from client emails and the forms it fills; and read figures from your files to fill GST and income tax forms for your team to check.",
      "InboxCA will not delete a file without your approval, share anything outside your firm, open folders you did not choose, or use your files to train AI.",
      "Your firm stays the owner of its files. Your firm is responsible for its drive account and its provider's charges.",
      "You can take this access back at any time in InboxCA's settings or at your drive provider. The files stay in your drive.",
    ],
  },
  {
    id: "use",
    title: "Fair use",
    points: [
      "Do not try to break into this website, overload it or copy it in bulk.",
      "Do not use it to mislead anyone about InboxCA or Orelu.",
    ],
  },
  {
    id: "names",
    title: "Names and logos",
    points: [
      "InboxCA, the InboxCA logo and Orelu belong to Orelu.",
      "Other companies' names and logos belong to their owners. They are shown only to say what InboxCA is built to work with, and do not mean a partnership.",
    ],
  },
  {
    id: "responsibility",
    title: "Our responsibility",
    points: [
      "We work to keep this website correct, but it is offered as it is, without a promise that every detail is right or that it is always available.",
      "Nothing here takes away a right you have under Indian law.",
    ],
  },
  {
    id: "law",
    title: "Law",
    points: ["These terms follow the laws of India."],
  },
] as const;

export const refundSections = [
  {
    id: "guarantee",
    title: "Money back in 14 days",
    points: [
      "Cancel within 14 days of your first plan payment and you get that payment back in full, whether you paid monthly or yearly.",
      "You do it yourself from Settings, Billing. Nobody needs to approve it.",
      "It applies once for each firm.",
      "The one time setup fee is not returned once your old files have started to be brought in. AI credits you bought and used are not returned.",
    ],
  },
  {
    id: "cancel",
    title: "Cancelling later",
    points: [
      "You can cancel at any time. Cancelling stops the next renewal, and you keep your plan until the period you paid for ends.",
      "After the first 14 days there is no part refund for the time left in a period.",
      "Your files are in your own drive, so they stay with you.",
    ],
  },
  {
    id: "failed",
    title: "If a payment fails",
    points: [
      "For 7 days nothing changes while the payment is tried again.",
      "From then until day 30 your firm can view everything but not make changes.",
      "After day 30 the account is paused. InboxCA keeps your records for 30 more days so that you can come back.",
    ],
  },
  {
    id: "paid",
    title: "How a refund is paid",
    points: [
      "Through Cashfree, to the same card, UPI or bank account that paid.",
      "It usually arrives within 5 to 7 working days.",
    ],
  },
  {
    id: "plans",
    title: "Changing plans",
    points: [
      "Moving to a bigger plan applies at once, and you pay only for the days left in your period.",
      "Moving to a smaller plan applies at your next renewal.",
      "Extra people and extra AI are paid for first, then added.",
    ],
  },
] as const;

// A placeholder until the real data processing agreement is published. Sign up records
// this date as the DPA version a firm accepted.
export const dpaUpdated = "25 Oct 2026";
export const dpaSections = [
  {
    id: "draft",
    title: "Not published yet",
    points: [
      "The data processing agreement between your firm and InboxCA will be published on this page before the first firm joins.",
    ],
  },
] as const;
