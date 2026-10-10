// Deck page 7. Staff permissions corrected to PLAN.md D18: approved filing downloads are a built-in exception.
export const controls = [
  [
    "Keep using your own drive",
    "Link your firm's own OneDrive or Dropbox to InboxCA. Your old files stay there and InboxCA puts them in order. Only you and InboxCA can open them."
  ],
  [
    "You approve what it can do",
    "You see what InboxCA will do with your drive and tick to agree. You can take it back any time."
  ],
  [
    "Private papers need your OK",
    "Routine papers (acknowledgements, challans) go to the client by themselves. Private ones (financial statements, audit reports, PAN, Aadhaar, bank papers) wait for one click. You choose."
  ],
  [
    "Staff work only from your office",
    "One switch: staff use InboxCA only on PCs you approved, in your office, in your hours."
  ],
  [
    "Staff can view, not change",
    "Staff view files and check forms. The owner sets what each role may do. Approved filing files can be downloaded for your team to file."
  ],
  [
    "Deleted files can be restored",
    "A deleted file is kept for 30 days and can be brought back."
  ],
  [
    "Your emails stay with you",
    "Clients hear only from your firm's own email. InboxCA keeps no copy of your emails."
  ],
  [
    "Turn off anything, anytime",
    "Stop reminders for any client, or stop the email assistant, at any time."
  ]
] as const;

// Deck page 2. These are outside-India surveys, never measured InboxCA savings.
export const facts = [
  {
    "figure": 45,
    "suffix": "%*",
    "text": "of an accounting leader's time goes on running the office, not on client work.",
    "with": "Sorting, saving and typing are done for you.",
    "source": "https://www.getcanopy.com/resources/ebooks/canopys-2024-practice-management-survey/",
    "label": "Canopy practice management survey"
  },
  {
    "figure": 7,
    "suffix": " in 10*",
    "text": "accountants say collecting papers from clients takes too much of their time.",
    "with": "Clients are reminded only for what is still missing.",
    "source": "https://www.getcanopy.com/blog/document-management-accounting-firm-study/",
    "label": "Canopy document management study"
  },
  {
    "figure": 8,
    "suffix": " in 10*",
    "text": "say finding files inside their own firm takes too much of their time.",
    "with": "Every paper is saved in the right client folder.",
    "source": "https://www.getcanopy.com/blog/document-management-accounting-firm-study/",
    "label": "Canopy document management study"
  },
  {
    "figure": 3,
    "suffix": " hours*",
    "text": "a week, for each person, is what firms using a similar tool say they save on email.",
    "with": "Client emails are read, sorted and answered for you.",
    "source": "https://karbonhq.com/the-karbon-effect/",
    "label": "The Karbon Effect"
  }
] as const;

// Deck page 10. Planned after launch, not in the first version.
export const future = [
  [
    "Signature expiry alerts",
    "A client's digital signature (DSC) is about to expire? You are told weeks before filing day."
  ],
  [
    "All notices in one list",
    "Every tax notice, with the date the reply is due and who is handling it."
  ],
  [
    "Morning summary",
    "One email each morning: what came in, what is due this week and what is stuck."
  ],
  [
    "UDIN register",
    "Every UDIN in one list, with a reminder before the 60 days run out."
  ],
  [
    "Last year's paper list",
    "Each client's list of papers is made from what they sent last year, so nothing is missed."
  ],
  [
    "Renewal reminders",
    "Licences and registrations that expire: you and your client are reminded in good time."
  ],
  [
    "Due date changes",
    "If the government moves a due date, your reminders move too. Tell clients in one click."
  ]
] as const;

// PLAN.md D3, D6, D19, D21, D35, D36 and deck pages 5, 7, 10.
export const questions = [
  [
    "Do you keep my emails?",
    "No email text is stored. Your emails stay in your mailbox. InboxCA keeps no copy."
  ],
  [
    "Where are my files kept?",
    "In your firm's own OneDrive or Dropbox. Your old files stay there too."
  ],
  [
    "Do you need my GST or income tax portal password or OTP?",
    "Never. InboxCA never asks for a tax portal password or OTP."
  ],
  [
    "Does InboxCA file returns?",
    "No. InboxCA prepares forms for your team to check and approve. Your team files with its own OTP or digital signature."
  ],
  [
    "Does it work with my current software?",
    "InboxCA works beside Tally exports and prepares files that TaxPower GST and KDK Spectrum import. There is no live connection to Tally."
  ],
  [
    "Is there WhatsApp?",
    "Email only for now. WhatsApp is planned for later."
  ],
  [
    "Can I use it today?",
    "InboxCA is in development. The first firms join by invitation."
  ]
] as const;

// Deck page 9. This describes the planned setup, not an available product.
export const setup = [
  [
    "Sign up",
    "Sign up and pay on the website. Your InboxCA link comes at once. You choose who can open data, from where and when."
  ],
  [
    "Your client list",
    "Upload your Excel sheet of client names, PAN, GSTIN, phone, email and services. InboxCA checks it and shows rows that need fixing."
  ],
  [
    "Your email",
    "Connect your firm's email in a few clicks. InboxCA tests sending and receiving before it starts."
  ],
  [
    "Your office and hours",
    "If you want, switch on office only use, say yes to your PCs with one tap each, and set your working days, timings and holidays."
  ],
  [
    "Your team",
    "Add each person with their name and email, your managers and their teams, and two partners who can say yes for you."
  ],
  [
    "Link your own drive",
    "Link your firm's OneDrive or Dropbox: sign in and tick to agree. Files on a hard disk? Copy them into the drive first. Nothing moves until you say yes."
  ],
  [
    "Start using it",
    "Try it with sample data first. Real work starts after the safety checks pass. Each step has a guide; help is one message away, but you can finish on your own."
  ]
] as const;

// Film headings with supporting copy from deck pages 2, 3, 4, 5 and PLAN.md D19.
export const steps = [
  [
    "Reads every client email.",
    "Reads client emails, sorts them, and sends clients the papers they ask for."
  ],
  [
    "Files every paper in the right folder.",
    "Each file a client emails is saved in that client's folder in your own OneDrive or Dropbox, with a clear name."
  ],
  [
    "Replies to clients on its own.",
    "Routine papers go by themselves. Private papers wait for one OK from your team. Anything unusual goes to your team."
  ],
  [
    "Reminds clients only for what is missing.",
    "Clients are reminded only for what is still missing."
  ],
  [
    "Keeps forms ready for your approval.",
    "Your team checks, approves and files. InboxCA never files a return for you."
  ]
] as const;

// Rough invite ranges, based on the deck plan bands.
export const clientRanges = ["Up to 70", "71 to 170", "171 to 340", "341 to 700", "More than 700", "Not sure"] as const;
