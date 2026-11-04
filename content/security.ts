// Security policy copy. Every point follows PLAN.md section 8 and decisions D6, D13,
// D18, D19 and D36. InboxCA is in development, so this describes how it is being
// built. It is reviewed again with the terms and privacy notice before the pilot.
import { analyticsToken } from "@/src/lib/site";

export const securityUpdated = "4 Nov 2026";

// How files from clients are checked (owner, 3 Nov 2026): the same words on the security page,
// in the privacy notice and the DPA, and on the website. The provider quotes are their own help
// pages' wording, read on 3 Nov 2026, and say no more than those pages say.
export const clientFiles = [
  "Clients send papers to your firm's own email address. Your email provider checks attachments as its own policy says, before InboxCA reads the mailbox.",
  "Gmail says: \"Attachments in Gmail messages you send and receive are automatically scanned for viruses.\" (support.google.com/mail/answer/25760)",
  "Microsoft 365 says: \"In all organizations with cloud mailboxes, anti-malware protection for email is on by default.\" (learn.microsoft.com/en-us/defender-office-365/anti-malware-protection-about)",
  "Zoho Mail says: \"An anti-virus scanner automatically scans all the incoming emails and processes them to bounce any email with malicious attachments or files.\" (zoho.com/mail/help/secure-attachment-policy.html)",
  "InboxCA accepts only these kinds of file: PDF, pictures, Excel, CSV, XML, JSON, plain text, Word (.docx) and ZIP. It refuses programs, scripts, shortcuts, web pages and Office files with macros, by their name and by their first bytes, and a ZIP inside a ZIP.",
  "A file behind a sharing link (Google Drive, Dropbox or OneDrive) was not checked by your email provider. InboxCA reads and names it, then it waits for a person in your firm to save it. A private link or a folder link is not opened: the client is asked for the file attached.",
] as const;

export const securitySections = [
  {
    id: "where",
    title: "Where your data lives",
    points: [
      "Your client files stay in your firm's own OneDrive or Dropbox. InboxCA does not keep them.",
      "InboxCA can read the drive you connect, and touches only the folders you choose and its own InboxCA folder. Connect a drive kept for your firm.",
      "A file passes through InboxCA only while it is checked and filed. That is at most 24 hours, or up to 7 days if your drive cannot be reached.",
      "Your client list, your records and the figures read from files will be kept in a Supabase database. Its region is chosen at launch, and India is planned.",
      "InboxCA's temporary files and safety copies are planned for Backblaze B2, which is outside India. They are encrypted.",
      "InboxCA also keeps the text read from each file, encrypted with your firm's key in InboxCA's own store, planned for Backblaze B2, so it can search the file and read its figures again without opening it. The text is removed when the file is removed.",
    ],
  },
  {
    id: "files",
    title: "Files from clients",
    points: clientFiles,
  },
  {
    id: "never",
    title: "What is never kept",
    points: [
      "Email subjects and email text. Your emails stay in your own mailbox.",
      "Portal passwords and OTPs. InboxCA never logs in to the GST or income tax portal.",
      "Card and bank details. Payments go through Cashfree's own checkout.",
      "Aadhaar numbers. InboxCA does not ask for them, and a 12 digit number found in a paper is masked in InboxCA's logs.",
      "Two things are kept, encrypted with your firm's key: a password your team types to open a locked PDF, so the file opens again, and an AI reply draft, until its email is answered or marked done and at most until the email is 7 days old.",
    ],
  },
  {
    id: "encryption",
    title: "Encryption",
    points: [
      "Everything that travels between you, InboxCA and its services is encrypted (TLS 1.2 or newer).",
      "Each firm has its own encryption key. The master key sits in a key vault (AWS KMS, planned for the Mumbai region) and never leaves it.",
      "PAN, GSTIN, phone numbers, email addresses, bank details and the figures read from your files are encrypted with your firm's key (AES 256).",
      "Files in your drive are protected by your drive provider's own encryption and by your own account, so that you can always open them yourself.",
    ],
  },
  {
    id: "access",
    title: "Who can open what",
    points: [
      "Every sign in needs two proofs. Staff at an approved office PC use the code sent to their own email; you, your deputies and anyone outside the office also use a code from a phone app. One login is for one person.",
      "The owner's login works only on computers the owner approved. A new computer waits for the owner's OK, and a lost one can be removed, which signs it out.",
      "An approved computer is known by a random cookie in its browser, kept only as a digest and tied to the person. Beside it InboxCA keeps only a short name, such as Chrome on Windows, so you can tell computers apart.",
      "Staff can view files but cannot change, share or delete the originals. The owner decides what each role may do.",
      "With the office only switch, staff can sign in only on PCs you approved, on your office internet, in your office hours.",
      "Every view, download, share and delete request is recorded. The record is kept for 36 months and nobody can edit it or delete it early, the owner included.",
      "A deleted file waits 30 days before it is gone, and InboxCA keeps its own locked copy for those 30 days.",
      "InboxCA checks its folder in your drive once a day. If the folder is shared or has a link, if files are missing, if the drive is nearly full, or if it cannot be reached, the owner is told.",
      "Orelu's own team cannot open your data. Support needs a session that you approve, that ends by itself and that is recorded.",
    ],
  },
  {
    id: "ai",
    title: "How AI is used",
    points: [
      "AI is the last step, not the first. Rules and fixed readers handle what they can, and AI is used only for what is left.",
      "Only the email being worked on and that one client's own records are sent to the AI service, never the papers themselves and never another client's data.",
      "The AI service must agree to keep nothing and to train on nothing. Until that agreement is in place, AI stays off.",
      "No figure reaches a form until your team has checked it.",
    ],
  },
  {
    id: "checks",
    title: "Before any firm's real data",
    points: [
      "An outside security firm tests InboxCA for weaknesses, and again every year.",
      "Restoring from backup and changing the encryption keys are both rehearsed.",
      "The terms, the privacy notice and the data processing agreement are reviewed again.",
      "Critical weaknesses are fixed within 7 days of being found, and serious ones within 30.",
    ],
  },
  {
    id: "incidents",
    title: "If something goes wrong",
    points: [
      "Your firm is told within 24 hours: what happened, which data, and what to do.",
      "Incidents that must be reported go to CERT-In within 6 hours.",
      "From May 2027, when section 8(6) of the DPDP Act starts, Orelu reports to the Data Protection Board of India where Orelu is the data fiduciary; for your clients' data your firm reports, with what Orelu gives it.",
      "The database is backed up every 6 hours, so at most 6 hours of records could be lost. Your files are in your own drive and are backed up by your drive provider.",
    ],
  },
  {
    id: "law",
    title: "The law we build to",
    points: [
      "The Information Technology Act 2000, its 2011 rules on sensitive personal data, and the CERT-In directions of April 2022.",
      "The Digital Personal Data Protection Act 2023 and its Rules of 2025, most of which start in May 2027.",
      "The Reserve Bank's rules for card and AutoPay payments, through Cashfree.",
      "For your clients' data, your firm decides and InboxCA only follows your instructions, under the data processing agreement your firm accepts at sign up.",
    ],
  },
  {
    id: "services",
    title: "Services InboxCA will run on",
    points: [
      "Decided on 29 Oct 2026 and planned for launch; this list is updated when each one is live.",
      "Supabase: the database and sign in. Region chosen at launch, India planned.",
      "DigitalOcean, in Bangalore: the server that runs the website and the app.",
      "Amazon Web Services: the key vault (KMS, Mumbai region planned) and, later, system email (SES). Resend sends system email until then.",
      "Backblaze B2: InboxCA's encrypted temporary files, safety copies, the text read from files and backups.",
      "OpenAI: AI, which receives only the email being worked on and that client's own records.",
      "Cashfree: plan payments. Sentry: error reports, with personal details removed.",
      "Your own mailbox (Google, Microsoft or Zoho) and your own drive (Microsoft or Dropbox).",
    ],
  },
  {
    id: "website",
    title: "About this website",
    points: [
      "* The screens on this website are illustrations, and the firms, names and figures in them are sample data.",
      analyticsToken
        ? "This website's pages set no cookies. It counts visits without cookies and without knowing who you are. Signing up or signing in sets only the cookies that keep you signed in and remember your choices."
        : "This website's pages set no cookies and have no tracking or analytics. Signing up or signing in sets only the cookies that keep you signed in and remember your choices.",
      "Other companies' names and logos belong to their owners. They are shown only to say what InboxCA is built to work with, and do not mean a partnership.",
    ],
  },
] as const;
