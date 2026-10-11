// Page copy. Every fact follows PLAN.md. Nothing here says the product is live.

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
// owner's own file, unchanged: [name shown, file in /brand/tools, width, height, text beside it].
// The Zoho Mail file already carries its name, so no text sits beside it.
export const worksWith = [
  ["Gmail", "gmail.svg", 36, 28, "Gmail"],
  ["Outlook", "outlook.svg", 30, 28, "Outlook"],
  ["Zoho Mail", "zoho-mail.svg", 78, 34, ""],
  ["OneDrive", "onedrive.svg", 46, 28, "OneDrive"],
  ["Dropbox", "dropbox.svg", 28, 28, "Dropbox"],
  ["Tally", "tally.png", 44, 44, "exports"],
  ["Excel", "excel.svg", 27, 28, "Excel and PDF"],
  ["TaxPower GST", "taxpower.png", 28, 28, "TaxPower GST"],
  ["KDK Spectrum", "kdk.png", 28, 28, "KDK Spectrum"],
] as const;

// PLAN.md D3, D6, D18, D19, D21, D36.
export const questions = [
  [
    "Do you keep my emails?",
    "No. Your emails stay in your mailbox, and InboxCA stores no email text.",
  ],
  [
    "Where are my files kept?",
    "In your firm's own OneDrive or Dropbox. Your old files stay there too.",
  ],
  [
    "Do you need my GST or income tax portal password or OTP?",
    "Never. InboxCA does not log in to the GST or income tax portal.",
  ],
  [
    "Does InboxCA file returns?",
    "No. It prepares the form. Your team checks every figure and files with its own OTP or digital signature.",
  ],
  [
    "Does it work with my current software?",
    "Yes. It reads Tally exports, Excel sheets and PDFs, and prepares files that TaxPower GST and KDK Spectrum can import. There is no live connection to Tally.",
  ],
  [
    "What if someone deletes a file?",
    "Staff can view files but cannot change or delete the originals. A deleted file waits 30 days before it is gone, so it can be brought back.",
  ],
  ["Is there WhatsApp?", "Email only for now. WhatsApp is planned for later."],
  [
    "How do I start?",
    "You set it up yourself on the website: connect your firm's email, link your OneDrive or Dropbox, and upload your client list. Nothing is installed, and help is one message away.",
  ],
  [
    "Can I use it today?",
    "Not yet. InboxCA is in development and the first firms join by invitation.",
  ],
] as const;

// The two people behind Orelu, with the titles they use.
export const makers = [
  ["Utsav Doshi", "Founder, CEO and CTO"],
  ["Ria Chheda", "Cofounder and CMO"],
] as const;

// Rough invite ranges, matching the plan sizes.
export const clientRanges = [
  "Up to 70",
  "71 to 170",
  "171 to 340",
  "341 to 700",
  "More than 700",
  "Not sure",
] as const;
