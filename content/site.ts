// Page copy. Every fact follows PLAN.md and the code it names.

// Three sample days on the Today screen, shown under the demo: [when, title, rows as
// [what, state, done]]. Invented firms and figures; every state is one the product shows
// (work-data.ts, src/jobs/reminders.ts, worker/gstr3b.ts, src/lib/itr-fields.ts, src/lib/tds.ts, notices).
export const weekScenes = [
  [
    "17 Oct 2026",
    "GSTR-3B week",
    [
      ["12 GSTR-3B drafts for September, filled from GSTR-1 tables and GSTR-2B", "Ready to check", false],
      ["Purchase bills matched with GSTR-2B for 9 clients", "Matched", true],
      ["5 Form No. 140 statements for Jul to Sep, made from the clients' TDS registers", "Ready to check", false],
    ],
  ],
  [
    "22 Jul 2026",
    "ITR peak",
    [
      ["18 ITR-1 and ITR-4 drafts filled from Form 16, Form 26AS and AIS", "Ready to check", false],
      ["6 clients asked for Form 16 (Form No. 130 from tax year 2026-27), one email each", "Asked", false],
      ["Every figure opens the page it was read from", "Checked", true],
    ],
  ],
  [
    "3 Nov 2026",
    "A notice arrives",
    [
      ["A GST notice in a client's email, read and filed in the client's folder", "Filed", true],
      ["Reply date read from the notice, waiting for a person to confirm it", "Confirm", false],
      ["Nothing goes to the department by itself. Your team replies.", "Your call", false],
    ],
  ],
] as const;

// The forms and papers the code handles today (worker/gstr1.ts, worker/gstr3b.ts,
// src/lib/itr-fields.ts, src/lib/tds.ts, src/lib/tax-papers.ts, app/(app)/app/notices), for the moving strip
// under the hero: [form, what InboxCA does]. Nothing planned is listed.
// The due dates are the calendar's own list (supabase/migrations/20261017100000_calendar.sql).
export const forms = [
  ...["GSTR-1", "GSTR-3B"].map((form) => [form, "Prepared"] as const),
  ["GSTR-2B", "Matched"],
  ...["ITR-1", "ITR-2", "ITR-3", "ITR-4"].map((form) => [form, "Prepared"] as const),
  // TDS and TCS statements (src/lib/tds.ts): Form No. 138 only to December until Protean publishes its Q4 format.
  ...["Form No. 140", "Form No. 138, Apr to Dec", "Form No. 144", "Form No. 143"].map((form) => [form, "Prepared"] as const),
  ...["Form No. 130", "Form 16", "Form No. 168", "Form 26AS", "AIS", "TIS"].map((form) => [form, "Read"] as const),
  ["Notices", "Tracked"],
  ...["GSTR-9", "GSTR-4", "CMP-08", "Advance tax", "Tax audit report", "DIR-3 KYC", "LLP Form 8", "LLP Form 11"].map(
    (form) => [form, "Due date kept"] as const,
  ),
] as const;

// The old way against InboxCA, no rival named: [before, with InboxCA]. Each right hand line is
// checked against the code: drive.ts and folders, reminders.ts, datasets.ts (the source page of
// a figure) and security.ts (no portal passwords).
export const beforeAfter = [
  ["Papers in WhatsApp chats and desktops", "Filed in your own OneDrive or Dropbox"],
  ["Someone chases clients when they remember", "One reminder a day, only for what is missing"],
  ["Figures retyped from PDFs", "Read into the form, each with its source page"],
  ["Portal passwords in a shared sheet", "Never asked. Your team files every return"],
] as const;

// The five jobs shown in the demo, in the order they happen to one email.
export const demoSteps = [
  [
    "Reads the email",
    "Every email from a client is read and sorted within minutes of arriving.",
  ],
  [
    "Files the paper",
    "Attachments go into the client's folder in your own drive, with a clear name.",
  ],
  [
    "Replies to the client",
    "Routine replies go from your firm's own address. Anything unusual goes to your team.",
  ],
  [
    "Reminds for what is missing",
    "Clients are asked only for the papers that have not come in yet.",
  ],
  [
    "Keeps the form ready",
    "Figures are read into the official form. Your team checks, approves and files.",
  ],
] as const;

// What InboxCA is built to work beside (PLAN.md 4.1, D21, D36). Each logo is the
// owner's own file, unchanged but for the pictures, saved at 3 times their shown size:
// [name shown, file in /brand/tools, width, height, text beside it].
// The Zoho Mail file already carries its name, so no text sits beside it.
export const worksWith = [
  ["Gmail", "gmail.svg", 36, 28, "Gmail"],
  ["Outlook", "outlook.svg", 30, 28, "Outlook"],
  ["Zoho Mail", "zoho-mail.svg", 78, 34, ""],
  ["OneDrive", "onedrive.svg", 46, 28, "OneDrive"],
  ["Dropbox", "dropbox.svg", 28, 28, "Dropbox"],
  ["Tally", "tally.webp", 44, 44, "exports"],
  ["Excel", "excel.svg", 27, 28, "Excel, Word and PDF"],
] as const;

// PLAN.md D3, D6, D18, D19, D21, D36. The six a firm asks before it pays; the rest lives on the
// security policy, the terms and the refunds page.
export const questions = [
  [
    "Does InboxCA file returns?",
    "No. It prepares GSTR-1, GSTR-3B, ITR-1 to ITR-4 and TDS and TCS statements. Your team checks every figure, validates TDS and TCS files with Protean's free utility, and files with its own OTP or digital signature.",
  ],
  [
    "How do client papers reach it?",
    "Clients email them to your firm's own address, as they do today. InboxCA files each one into your OneDrive or Dropbox, by year, client and work.",
  ],
  [
    "Does it work with my current software?",
    "Yes. It reads Tally exports, Excel, Word and PDFs, and writes the official GST, ITR, TDS and TCS files that CA software imports. There is no live connection to Tally.",
  ],
  [
    "Does my client count change the price?",
    "No. Clients are unlimited. Your plan follows the returns due in the year and InboxCA storage, and you hear about it at 80%.",
  ],
  [
    "Is there a free trial?",
    "No. Instead, cancel within 14 days of your first payment and the whole payment comes back, apart from the setup fee once your old files are being brought in, and AI top up credits already used. Once for each firm.",
  ],
  [
    "What happens if I cancel?",
    "Your plan runs to the end of the period you paid for. A week later your firm can only view, after day 30 it closes, and the owner has 30 more days to download your records as one ZIP. Your files are already in your own drive.",
  ],
] as const;

// The policy pages, for the menu in the header and the footer: [path, name, what it covers].
export const policies = [
  ["/security", "Security policy", "Where your data lives and who can see it"],
  ["/privacy", "Privacy policy", "What InboxCA keeps about you, and why"],
  ["/terms", "Terms", "The agreement for using InboxCA"],
  ["/refunds", "Refunds and cancelling", "14 day money back, and how to cancel"],
  ["/dpa", "Data processing agreement", "What your firm accepts at sign up"],
] as const;

// Shown beside every start button. From the business plan: the first plan payment
// comes back in full if the firm cancels within 14 days.
export const guarantee = "14 day money back when you join";

// The two people behind Orelu, with the titles they use.
export const makers = [
  ["Utsav Doshi", "Founder, CEO and CTO"],
  ["Ria Chheda", "Cofounder and CMO"],
] as const;

