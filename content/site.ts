// Page copy. Every fact follows PLAN.md and the code it names.
import { extraPerson, rupees } from "./plans";

// Three sample days on the Today screen, shown under the demo: [when, title, rows as
// [what, state, done]]. Invented firms and figures; every state is one the product shows
// (work-data.ts, src/jobs/reminders.ts, worker/gstr3b.ts, src/lib/itr-fields.ts, notices).
export const weekScenes = [
  [
    "17 Oct 2026",
    "GSTR-3B week",
    [
      ["12 GSTR-3B drafts for September, filled from GSTR-1 tables and GSTR-2B", "Ready to check", false],
      ["Purchase bills matched with GSTR-2B for 9 clients", "Matched", true],
      ["3 clients still owe a bank statement, each reminded once this morning", "Waiting", false],
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
// src/lib/itr-fields.ts, src/lib/tax-papers.ts, app/(app)/app/notices). Nothing planned is listed.
export const coverage =
  "Today it prepares GSTR-1 and GSTR-3B, with GSTR-2B credit, and ITR-1 to ITR-4; reads Form 16 and Form No. 130, Form 26AS and Form No. 168, AIS and TIS; and keeps a notice tracker.";

// The old way against InboxCA, no rival named. Each right hand cell is checked against the
// code: drive.ts and folders, reminders.ts, datasets.ts (the source page of a figure),
// control cards and security.ts (passwords, view only staff, office only).
export const oldWay = [
  ["Where client papers live", "Personal WhatsApp chats, inboxes and desktops", "Your firm's own OneDrive or Dropbox, by year, client and work"],
  ["Who reminds clients", "Someone on your team, when they remember", "InboxCA, one email a client a day, only for what is missing"],
  ["How figures reach the return", "Retyped from PDFs and Excel", "Read into the official form; every figure opens the page it came from"],
  ["Who holds portal passwords", "A shared sheet, or the software", "Nobody but your team. InboxCA never asks for them"],
  ["What staff can do with files", "Anything, from anywhere", "View only. Originals cannot be changed or deleted, and office only if you choose"],
  ["Who files the return", "Your team", "Still your team, after a yes or no check of every figure"],
] as const;

// The five jobs shown in the demo, in the order they happen to one email.
export const demoSteps = [
  [
    "Reads the email",
    "Every email from a client is read and sorted the moment it arrives.",
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
  ["TaxPower GST", "taxpower.webp", 28, 28, "TaxPower GST"],
  ["KDK Spectrum", "kdk.webp", 28, 28, "KDK Spectrum"],
] as const;

// PLAN.md D3, D6, D18, D19, D21, D36. What the cards above already answer (emails kept, where
// files live, portal passwords) is not asked again here.
export const questions = [
  [
    "How are my files arranged?",
    "In your firm's own OneDrive or Dropbox, by year, then client, then work: FY 2026-27, Patel Textiles, GST. Each file is named like Patel Textiles - Purchase bills - Sep 2026.pdf. You can change the folder order in Settings.",
  ],
  [
    "Does it work with my current software?",
    "Yes. It reads Tally exports, every sheet of an Excel or OpenOffice workbook, old Excel files, Word files and PDFs. Scans and phone photos are read too, so you can search them by their words. It prepares files that TaxPower GST and KDK Spectrum can import. There is no live connection to Tally.",
  ],
  [
    "Does InboxCA file returns?",
    "No. It prepares the form. Your team checks every figure and files with its own OTP or digital signature. Each open ITR shows which of Form 16 or Form No. 130, Form 26AS or Form No. 168 and AIS are still needed, and adding the file ticks it off.",
  ],
  [
    "What if a government form changes?",
    "A new version with the same fields goes live by itself. One whose layout changed is checked and tested by us first.",
  ],
  [
    "What if someone deletes a file?",
    "Staff can view files but cannot change or delete the originals. A deleted file waits 30 days before it is gone, so it can be brought back.",
  ],
  ["Is there WhatsApp?", "Email only for now. WhatsApp is planned for later."],
  [
    "How do clients send us papers?",
    "By email to your firm's own address, as they do today, so your email provider checks attachments as its own policy says before InboxCA reads the mailbox. InboxCA accepts only PDF, pictures, Excel, CSV, XML, JSON, Word and ZIP files and refuses programs and macro files. A file behind a sharing link waits for a person in your firm. The security page quotes each provider's own words.",
  ],
  [
    "What does InboxCA not do?",
    "It does not file on the GST or income tax portal, and it never asks for a portal password or OTP. It has no WhatsApp yet. It does not raise your firm's own invoices to clients. Your team files, and your billing stays where it is.",
  ],
  [
    "How do I start?",
    "Sign up on this website with your firm's name and your work email. Choose your plan and pay, then connect your firm's email, link your OneDrive or Dropbox and upload your client list. Nothing is installed, and help is one message away.",
  ],
  [
    "Is there a free trial?",
    "No. Your firm's mailbox and drive are connected only after the first payment, so there is nothing to try half way. Instead, cancel within 14 days of your first payment, from Settings, Billing, and the whole payment comes back, monthly or yearly. Once for each firm.",
  ],
  [
    "How do I pay?",
    `Monthly or yearly through Cashfree, by UPI AutoPay, card or bank mandate. InboxCA keeps no card or bank details. You approve one AutoPay limit of at most twice your plan price, so a plan change or GST starting needs no new approval, and Orelu never takes more than that without asking. Every payment gets a numbered receipt by email, a tax invoice once Orelu is GST registered. One more person is ${rupees(extraPerson)} a month, and a one time setup fee, when there is one, is shown before you pay.`,
  ],
  [
    "Does my client count change the price?",
    "No. Clients are unlimited on every plan, and the suits about figure is only a guide. Your plan follows two meters: returns due in the year and InboxCA storage. At 80% you hear about it, with the plan that fits. If your firm passes its plan, InboxCA moves it to the plan that fits and takes the difference, with an email 3 days before.",
  ],
  [
    "What counts as a return?",
    "Every due item in your firm's calendar from 1 April to 31 March: each GSTR-1, GSTR-3B, ITR and other filing due for a client counts as one. Paid monthly, your plan gives a twelfth of the year's returns each month, and what you do not use carries forward to March. Paid yearly, you get the whole year at once.",
  ],
  [
    "Which AI use costs no credits?",
    "Official formats are read by fixed readers, not AI: GSTR-2B and GSTR-2A files, Form 26AS text, Form 16 and Form No. 130. A repeated question answered from the day's cache costs nothing, and a call that fails costs nothing. AI is used only for what rules cannot read.",
  ],
  [
    "Do my own files count towards storage?",
    "No. They stay in your own drive. InboxCA storage is only its working space for your client list and the figures it reads. At 80% of your plan you hear about it, with the plan that fits.",
  ],
  [
    "What if a payment fails?",
    "For 7 days nothing changes while it is tried again. From then until day 30 your firm can view everything but not make changes. After day 30 the account is paused, and InboxCA keeps your records for 30 more days so that you can come back.",
  ],
  [
    "What happens after I cancel?",
    "Cancelling stops the next renewal and your plan runs to the end of the period you paid for. Your files are already in your own drive. For 30 days after closing you can still sign in and download your client list, returns, notices and activity record as one ZIP from Settings, Your data.",
  ],
] as const;

// How a firm starts, shown under the plans. The order is the product's: the plan is paid
// before the firm's email and drive are connected.
export const startSteps = [
  ["Sign up", "Your firm's name and your work email. A code by email signs you in."],
  ["Choose your plan and pay", "Monthly or yearly, by UPI, card or AutoPay, with 14 day money back."],
  ["Connect email and drive", "Your firm's Gmail, Outlook or Zoho Mail, and your OneDrive or Dropbox."],
] as const;

// Shown beside every start button. From the business plan: the first plan payment
// comes back in full if the firm cancels within 14 days.
export const guarantee = "14 day money back when you join";

// The two people behind Orelu, with the titles they use.
export const makers = [
  ["Utsav Doshi", "Founder, CEO and CTO"],
  ["Ria Chheda", "Cofounder and CMO"],
] as const;

