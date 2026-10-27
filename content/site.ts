// Page copy. Every fact follows PLAN.md.
import { extraPerson, rupees } from "./plans";

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
    "How do I start?",
    "Sign up on this website with your firm's name and your work email. Choose your plan and pay, then connect your firm's email, link your OneDrive or Dropbox and upload your client list. Nothing is installed, and help is one message away.",
  ],
  [
    "How do I pay?",
    `Monthly or yearly, by UPI, card or AutoPay. Cancel within 14 days of your first plan payment and get it back in full. One more person or more AI is ${rupees(extraPerson)} a month each, and a one time setup fee is shown before you pay.`,
  ],
  [
    "Do my own files count towards storage?",
    "No. They stay in your own drive. InboxCA storage is only its working space for your client list and the figures it reads. At 80% of your plan you hear about it, with the plan that fits.",
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

