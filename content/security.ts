// Security policy copy. Every point follows PLAN.md section 8 and decisions D6, D13,
// D18, D19 and D36. InboxCA is in development, so this describes how it is being
// built. A lawyer reviews it with the terms and privacy notice before the pilot.
import { analyticsToken } from "@/src/lib/site";

export const securityUpdated = "11 Oct 2026";

export const securitySections = [
  {
    id: "where",
    title: "Where your data lives",
    points: [
      "Your client files stay in your firm's own OneDrive or Dropbox. InboxCA does not keep them.",
      "A file passes through InboxCA only while it is checked and filed. That is at most 24 hours, or up to 7 days if your drive cannot be reached.",
      "Your client list, your records and the figures read from files are kept in a database in Mumbai, India.",
      "InboxCA's temporary files and safety copies are held outside India, and they are encrypted.",
    ],
  },
  {
    id: "never",
    title: "What is never kept",
    points: [
      "Email subjects and email text. Your emails stay in your own mailbox.",
      "Portal passwords and OTPs. InboxCA never logs in to the GST or income tax portal.",
      "Card and bank details. Payments go through Razorpay, a licensed payment company.",
      "Full Aadhaar numbers. Only the last 4 digits are shown.",
    ],
  },
  {
    id: "encryption",
    title: "Encryption",
    points: [
      "Everything that travels between you, InboxCA and its services is encrypted (TLS 1.2 or newer).",
      "Each firm has its own encryption key. The master key sits in a key vault in Mumbai and never leaves it.",
      "PAN, GSTIN, phone numbers, email addresses, bank details and the figures read from your files are encrypted with your firm's key (AES 256).",
      "Files in your drive are protected by your drive provider's own encryption and by your own account, so that you can always open them yourself.",
    ],
  },
  {
    id: "access",
    title: "Who can open what",
    points: [
      "Every sign in needs two proofs. Staff at an approved office PC use the code sent to their own email; you, your deputies and anyone outside the office also use a code from a phone app. One login is for one person.",
      "Staff can view files but cannot change, share or delete the originals. The owner decides what each role may do.",
      "With the office only switch, staff can sign in only on PCs you approved, on your office internet, in your office hours.",
      "Every view, download, share and delete request is recorded. The record is kept for 12 to 36 months and nobody can edit it or delete it early, the owner included.",
      "A deleted file waits 30 days before it is gone, and InboxCA keeps its own locked copy for those 30 days.",
      "Orelu's own team cannot open your data. Support needs a session that you approve, that ends by itself and that is recorded.",
    ],
  },
  {
    id: "ai",
    title: "How AI is used",
    points: [
      "AI is the last step, not the first. Rules and fixed readers handle what they can, and AI is used only for what is left.",
      "Only the email or paper being worked on is sent to the AI service, never another client's data.",
      "The AI service must agree to keep nothing and to train on nothing. If that agreement is not in place for a firm, AI stays off for that firm.",
      "No figure reaches a form until your team has checked it.",
    ],
  },
  {
    id: "checks",
    title: "Before any firm's real data",
    points: [
      "An outside security firm tests InboxCA for weaknesses, and again every year.",
      "Restoring from backup and changing the encryption keys are both rehearsed.",
      "A lawyer reviews the terms, the privacy notice and the data processing agreement.",
      "Critical weaknesses are fixed within 7 days of being found, and serious ones within 30.",
    ],
  },
  {
    id: "incidents",
    title: "If something goes wrong",
    points: [
      "Your firm is told within 24 hours: what happened, which data, and what to do.",
      "Incidents that must be reported go to CERT-In within 6 hours.",
      "The database is backed up every 6 hours, so at most 6 hours of records could be lost. Your files are in your own drive and are backed up by your drive provider.",
    ],
  },
  {
    id: "law",
    title: "The law we build to",
    points: [
      "The Digital Personal Data Protection Act 2023 and its Rules of 2025.",
      "The Information Technology Act 2000 and the CERT-In directions of April 2022.",
      "The Reserve Bank's rules for card and AutoPay payments, through Razorpay.",
      "For your clients' data, your firm decides and InboxCA only follows your instructions, under a signed data processing agreement.",
    ],
  },
  {
    id: "services",
    title: "Services InboxCA runs on",
    points: [
      "Supabase, in Mumbai: the database and sign in.",
      "Cloudflare: the website and the app.",
      "Amazon Web Services, in Mumbai: the key vault, file checks and system email.",
      "Backblaze: InboxCA's encrypted temporary files, safety copies and backups.",
      "OpenAI: AI, with nothing kept.",
      "Razorpay: plan payments. Sentry: error reports, with personal details removed.",
      "Your own mailbox (Google, Microsoft or Zoho) and your own drive (Microsoft or Dropbox).",
    ],
  },
  {
    id: "website",
    title: "About this website",
    points: [
      "* InboxCA is in development. The screens on this website are illustrations, and the firms, names and figures in them are sample data.",
      analyticsToken
        ? "This website sets no cookies. It counts visits without cookies and without knowing who you are."
        : "This website sets no cookies and has no tracking or analytics.",
      "Other companies' names and logos belong to their owners. They are shown only to say what InboxCA is built to work with, and do not mean a partnership.",
      "The invite form opens a draft in your own email app. Nothing is sent until you send it.",
    ],
  },
] as const;
