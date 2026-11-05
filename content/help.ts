// Help centre articles: short steps and points in plain words. Every line is copied from what
// the app says and does: its screens' own words (app/(app)/app, settings, clients, notices,
// calendar, work/gst, people), src/lib (rights.ts, presets.ts, answers.ts, reminders.ts,
// calendar.ts, paper-origin.ts), and content/security.ts, legal.ts and plans.ts. Prices come
// only from plans.ts (no GST is charged while Orelu is not GST registered). Nothing planned is described.
import { helpTopics } from "./help-topics";
import { aiBlock, custom, extraPerson, plans, rupees } from "./plans";

export type HelpArticle = {
  slug: string;
  title: string;
  lead: string;
  steps?: readonly string[];
  points?: readonly string[];
};

const top = plans[plans.length - 1];
const topic = (id: (typeof helpTopics)[number]["id"]) => ({ id, title: helpTopics.find((group) => group.id === id)!.title });

export const helpGroups: readonly { id: string; title: string; articles: readonly HelpArticle[] }[] = [
  {
    ...topic("start"),
    articles: [
      {
        slug: "sign-up",
        title: "Sign up and open your firm",
        lead: "The owner sets up InboxCA once. It takes a few steps.",
        steps: [
          "Choose Get started. A plan you picked on the price list waits for you at the plan step.",
          "Enter your firm's name, its state and your own work email, and accept the terms and the data processing agreement for your firm. Where the buttons show, you can continue with Google or Microsoft instead.",
          "Type the 6 digit code we email you. There is no password.",
          "Set up your 2 step code: scan the QR code with an authenticator app, such as Google Authenticator or Microsoft Authenticator, then type the code it shows. You do this once.",
          "Choose your plan, monthly or yearly, and your team size, then set up AutoPay and pay. Your firm opens as soon as the first payment is in.",
        ],
        points: [
          "Before you pay you see the exact amount, with GST where it applies, and you confirm it.",
          "Until Orelu starts taking payments, nothing is charged, and Settings, Billing says so.",
          "Cancel within 14 days of your first payment and the whole payment comes back, apart from the one time setup fee once your past papers have started to be brought in, and AI top up credits already used.",
          "Joining a firm that already uses InboxCA? Do not sign up. Ask the owner to invite you on People.",
        ],
      },
      {
        slug: "connect-email",
        title: "Connect your firm's email",
        lead: "InboxCA works from the address your clients already write to. The owner connects it once.",
        steps: [
          "Open Settings, then Email and drive, and find Firm email.",
          "Choose Connect with Google, Microsoft or Zoho, where the button shows, and allow InboxCA on their sign in page.",
          "Or type the firm's email address and its password. Gmail, Google Workspace and Zoho need an app password, made in the account's security settings. InboxCA finds the mail servers itself and asks for them only when it cannot.",
        ],
        points: [
          "With Microsoft 365, your firm's Microsoft 365 admin may need to sign in and choose Allow for the whole firm.",
          "InboxCA reads only your clients' emails, keeps no copy of them, and replies from this address.",
          "Emails in 24 hours is how many emails InboxCA may send a day, replies and bulk sends together. It starts at 500. Lower it if your email provider allows fewer.",
          "Disconnect stops the reading, the replies and the reminders until you connect again. Your emails stay where they are.",
          "Sign in to InboxCA with your own work email, never with the firm email it reads.",
        ],
      },
      {
        slug: "connect-drive",
        title: "Connect your firm's drive",
        lead: "Client papers are saved in your firm's own OneDrive or Dropbox. InboxCA keeps a locked safety copy, for 30 days, of a paper it removes or changes, and the text it reads from each paper, encrypted with your firm's key, until the paper is removed.",
        steps: [
          "Open Settings, then Email and drive, and find Firm drive.",
          "Choose OneDrive or Dropbox.",
          "Read what you are allowing InboxCA to do, tick that you agree for your firm, and choose Connect drive.",
          "Sign in at your drive and choose Allow. InboxCA then sets up its folder, which takes a minute.",
        ],
        points: [
          "InboxCA gets access to the whole drive, but it opens only the folders you choose and its own InboxCA folder. Connect a drive used only for your firm.",
          "It will not delete a file without your approval, share anything outside your firm, or use your files to train AI.",
          "Choose the folder order for new papers, such as year, client, type of work, and how new papers are named.",
          "InboxCA checks its folder once a day. If the folder is shared, files are missing, the drive is nearly full, or the drive cannot be reached, the owner is told.",
          "Old papers already in your drive? Add old files moves them into their client folders after a preview. Nothing moves until you choose.",
          "Disconnect stops new papers being saved. The papers already in your drive stay where they are.",
        ],
      },
      {
        slug: "import-clients",
        title: "Add your clients from Excel",
        lead: "Bring in your whole client list at once, or add clients one at a time with New client.",
        steps: [
          "Open Clients and choose Import from Excel.",
          "Download the client list template, or use your own sheet with the column names in row 1.",
          "Put one client on each row. Only Name is needed. Fill Client type, PAN, GSTIN, Email, TAN, the services, Phone and Looked after by when you have them.",
          "Choose the CSV or Excel file, then Check the file.",
          "InboxCA shows every row's problem. Nothing is added until you have seen the check; then the good rows go in together.",
        ],
        points: [
          "One import takes up to 2,000 clients.",
          "The services you choose for each client decide their due dates.",
          "Email is the address InboxCA writes to for that client. Looked after by is the person in your firm, by name or email, as on People.",
          "Clients are unlimited on every plan.",
        ],
      },
      {
        slug: "what-inboxca-does-not-do",
        title: "What InboxCA does not do",
        lead: "InboxCA prepares and keeps track. Some things stay with your team, always.",
        points: [
          "It does not file returns. It prepares the form, and your team checks every figure and files on the portal with its own login, OTP or digital signature.",
          "It never asks for portal passwords or OTPs, and never logs in to the GST or income tax portal or TRACES.",
          "It gives no accounting, audit, tax or legal advice, and it never signs or certifies a document. Questions about advice, fees or what a notice means always wait for your team.",
          "It is software, not a firm of chartered accountants. Orelu, which makes it, does not practise as chartered accountants and is not part of, or approved by, ICAI. The CA in InboxCA stands for the firms it is built for.",
          "It never writes or sends a reply to a notice. People in your firm do.",
          "It does not read or send WhatsApp messages. For a client with a phone number, Message on WhatsApp opens your own WhatsApp with the missing papers filled in.",
          "It has no upload page or upload link for clients. Clients email papers to your firm's address, as they do today.",
          "It has no live connection to Tally. It reads Tally exports, Excel, Word and PDFs.",
          "It keeps no copy of your emails. Emails stay in your mailbox and papers in your drive, apart from a locked 30 day safety copy of a paper InboxCA removes or changes, and the text read from each paper, kept encrypted until the paper is removed.",
          "It never uses your data for advertising or to train AI, and it does not ask for Aadhaar numbers.",
        ],
      },
    ],
  },
  {
    ...topic("papers"),
    articles: [
      {
        slug: "papers-by-email",
        title: "How client papers arrive and get filed",
        lead: "Clients email papers to your firm's own address, as they do today.",
        steps: [
          "A client emails papers to your firm's address.",
          "InboxCA reads the email and finds the client.",
          "Each attachment is saved in the client's folder in your drive, by year, client and type of work, with a clear name.",
          "The email shows in the Inbox with where it stands, such as Needs reply or Answered by InboxCA.",
        ],
        points: [
          "Your email provider checks attachments as its own policy says, before InboxCA reads the mailbox.",
          "InboxCA accepts PDF, pictures, Excel, CSV, XML, JSON, plain text, Word (.docx) and ZIP. It refuses programs, scripts, shortcuts, web pages, Office files with macros, and a ZIP inside a ZIP.",
          "A file behind a sharing link waits for a person in your firm to save it. A private link or a folder link is not opened: the client is asked for the file attached.",
          "When InboxCA cannot tell a paper's type or period, the paper waits under To check.",
          "When someone who is not yet a client writes, InboxCA only checks by rules whether it asks about your services, and keeps none of its words. It keeps who wrote and when, so you can add them as a client.",
          "Inside InboxCA, papers open view only.",
        ],
      },
      {
        slug: "to-check",
        title: "The To check list",
        lead: "Papers InboxCA saved but was not sure about wait under To check, with why each waits.",
        steps: [
          "Open Documents and choose To check.",
          "Open a paper. It opens on the client's Documents.",
          "Confirm its type and period, or change them.",
        ],
        points: [
          "A paper waits when InboxCA could not tell its type or its period, or when the same file came in before.",
          "The Inbox also says when an email's papers went to To check, with a link to check them.",
          "A paper under To check cannot be sent to a client until it is checked.",
          "Missing in the drive means the file is no longer where InboxCA saved it. Move it back to its folder in the drive, or remove the paper on the client's Documents tab.",
          "Staff may correct a paper's type or period unless the owner turns it off in Permissions.",
        ],
      },
      {
        slug: "ask-for-papers",
        title: "Ask for papers, and reminders",
        lead: "InboxCA asks clients for what is missing by email, from your firm's address.",
        steps: [
          "Open the client and choose Ask for papers.",
          "Tick the papers, add anything else by name, and choose the period.",
          "The client gets one email from your firm's address listing each paper, and replies with the papers attached.",
          "Papers that come back are matched to what you asked for. Follow ups name only what is still missing.",
        ],
        points: [
          "Turn on reminders in Settings, Reminders and papers, and choose when: 7, 3 or 1 day before, on the day, or 1 or 3 days after.",
          "Reminders go each morning from about 9:30, India time, and never after 8 pm. Each client gets at most one email a day, from your firm email.",
          "If the papers asked for do not come, InboxCA emails again every 3 days. After two follow ups, the person who looks after the client gets a card on Today to call them, and after the third the owner is told.",
          "InboxCA reminds only for due dates it has checked against the government notification.",
          "A reminder is skipped when the return is filed, the client already sent papers for it, or your team is replying to them.",
          "Ask for papers before the due date: choose how many days before, for monthly, quarterly and yearly returns. Papers you already have are left out.",
          "InboxCA never asks clients for papers your team gets from the portals, such as AIS, TIS, Form 26AS and GSTR-2B.",
          "Pause reminders for one client in that client's Details.",
        ],
      },
      {
        slug: "replies",
        title: "Replies InboxCA sends for you",
        lead: "InboxCA answers some routine client questions from your records, from your firm's address.",
        points: [
          "It can answer: Is my return filed, Which papers are still needed, What is due, Papers received, and Notice received.",
          "For each one, choose Auto, Ask me first or Off in Settings, Reminders and papers, Replies by InboxCA.",
          "Auto sends 5 minutes after the email arrives. Until then, Undo in the Inbox stops it.",
          "Ask me first keeps the reply in the Inbox for you to send or change. Off sends nothing, and the question waits in Needs reply.",
          "Replies are in English, from your records only, to the client's own address or a contact allowed to receive papers.",
          "Emails InboxCA cannot answer go to the person who looks after the client.",
          "When a client asks for a paper by email, InboxCA finds it and replies with a secure link. Paper types you tick go at once; the others wait until someone approves them in the Inbox.",
        ],
      },
    ],
  },
  {
    ...topic("returns"),
    articles: [
      {
        slug: "due-dates",
        title: "Due dates and the Calendar",
        lead: "InboxCA works out each client's due dates from the services you do for them.",
        points: [
          "Choose the services for each client, and InboxCA works out their due dates.",
          "Calendar shows Late, Due in 7 days, Due in 30 days and Filed in the last 30 days, as a list or as a month.",
          "Mark a return in progress or filed, one at a time or many together.",
          "In the Calendar or on Your list, point at a late client and choose Mark filed, or open the client's Returns tab. You can add the acknowledgement number, and Undo puts it back.",
          "Every due date is checked against the government notification before InboxCA reminds clients. Until Orelu has checked one, the owner can confirm it from the notification linked beside it, in Settings, Reminders and papers.",
          "A filed ITR shows the date to verify it by, 30 days after filing.",
          "Remind client sends one email now about the client's returns late or due in 7 days, and the papers still missing.",
          "On a client's Overview, To-dos: write what is to be done, by when and for whom, then choose Add a to-do. It shows on Today for that person.",
          "In a client's Details, Licences and registrations, add an expiry date, such as a DSC, FSSAI licence or IEC. It shows on the Calendar and Today before the date. InboxCA does not remind the client of it.",
        ],
      },
      {
        slug: "gst-month-end",
        title: "GST month end",
        lead: "One page for every GST client in a month: what is in, what differs, and what is still to prepare or file.",
        steps: [
          "On Today, open Your list, then choose GST month end.",
          "Choose the month, and if you like the person who looks after the clients or a tag.",
          "Each client shows its papers, GSTR-2B, differences, GSTR-1, GSTR-3B and filing, each in a few words with one next step.",
        ],
        points: [
          "Returns for a month are filed the month after, so last month opens first.",
          "Add the GSTR-2B your team downloads from the GST portal. InboxCA reads the client and the month from inside the file.",
          "Purchase bills are matched with GSTR-2B, and the differences are listed.",
          "GSTR-1 is prepared from the sales register as the JSON for the portal's Prepare Offline upload. Invoices and notes with an IRN are left out, as the portal has them already.",
          "GSTR-3B is filled from checked GSTR-1 and GSTR-2B figures. Parts that need a person's judgement are left for the portal.",
          "Your team checks the figures, downloads the file, files it on the GST portal, then marks it filed. If the owner turned on Second approval before filing, another person approves it first.",
        ],
      },
      {
        slug: "itr",
        title: "Income tax returns, ITR-1 to ITR-4",
        lead: "InboxCA prepares ITR-1, ITR-2, ITR-3 and ITR-4 from the client's papers. Your team checks and files.",
        steps: [
          "Add the client's papers: Form 16 (Form No. 130 from tax year 2026-27), Form 26AS (Form No. 168), AIS and TIS.",
          "InboxCA reads the figures into the return. Every figure opens the page it was read from.",
          "Check each figure. Approving and downloading wait until every figure is checked.",
          "Once every figure is checked the return is approved, or, with Second approval before filing on, another person approves it. Choose Download for filing, file it on the income tax portal, then mark it filed here.",
        ],
        points: [
          "Each return shows four steps: Figures checked, Prepared, Approved, Filed.",
          "InboxCA shows where the return differs from the client's Form 26AS and Form 16. It never changes the return itself.",
          "If figures change after a file is made, it shows Out of date and InboxCA makes a newer version.",
          "If InboxCA cannot make the file for the income tax portal yet, the return says why.",
          "Your team gets Form 26AS, AIS and TIS from the portal. InboxCA never asks clients for them.",
        ],
      },
      {
        slug: "tds",
        title: "TDS and TCS statements",
        lead: "InboxCA prepares the quarterly TDS and TCS statement files from the client's registers and challans. Your team validates and files them.",
        steps: [
          "Add the client's TAN under Tax numbers, then choose TDS statement details and fill in the deductor's details and the person responsible.",
          "Clients email their TDS papers as they do today. Registers and challans are filed under TDS for their quarter, and Ask for papers asks for them before each TDS return.",
          "On the Calendar or the client's Returns, choose Prepare statement for the quarter. Choose the register and match its columns once; InboxCA remembers them.",
          "Add the challans, then check the figures. Rows that need a look are listed one by one; choose Yes, these figures are right for the rest.",
          "Under Prepare the statement file, choose Prepare and the form's number, then approve and download it under Return files. Validate it with Protean's free File Validation Utility, file it, then mark it filed there.",
        ],
        points: [
          "InboxCA prepares Form No. 140 (was 26Q), Form No. 144 (was 27Q) and Form No. 143 (TCS, was 27EQ) for every quarter, and Form No. 138 (salaries, was 24Q) for April to December.",
          "Form No. 138 for January to March waits for Protean's official format. InboxCA checks Protean's page every day and shows when it is published.",
          "A payment with no challan, or a challan that does not cover its payments, stops the statement and says how much it is short by.",
          "Every rule comes from Protean's official file formats. InboxCA says when a format changes.",
          "InboxCA never files on the portal and never logs in to TRACES. Your team files, and downloads certificates from TRACES.",
        ],
      },
      {
        slug: "notices",
        title: "Notices from the departments",
        lead: "InboxCA reads the notice emails your firm gets from the GST and income tax departments and keeps track of each one.",
        points: [
          "It finds the client from the PAN or GSTIN in the email, and lists the notice on Notices, nearest date first.",
          "A reply date read from the notice is only a suggestion. Until someone checks it, Notices shows your firm's own deadline to read the notice.",
          "Look at the date on the notice, then choose Mark date checked.",
          "The owner, a partner or a manager checks the date and moves the notice on: Open, In progress, Replied, Closed.",
          "Add a notice by hand with Add a notice: the authority, the notice, its reference or DIN, when it came, and its action date.",
          "People in your firm write and send every reply. InboxCA never writes or sends a notice reply.",
          "Record what your firm sent, when, and its acknowledgement. A notice closes only with it.",
          "If the client writes about it, InboxCA can only say the notice arrived and your CA will look at it.",
        ],
      },
    ],
  },
  {
    ...topic("team"),
    articles: [
      {
        slug: "people-and-permissions",
        title: "People, roles and permissions",
        lead: "Each person has their own login. The owner decides what each role may do.",
        steps: [
          "On People, the owner chooses Invite person, enters their work email and picks a role.",
          "They get an email with a sign in code, then set up their own 2 step code.",
        ],
        points: [
          "Roles: owner (one a firm), partner, manager, staff and front desk.",
          "In Settings, People's access, Permissions, tick what staff and managers may do without asking. Partners may do the same as managers.",
          "What can be ticked: upload papers, send papers to clients, edit figures and prepare returns, download papers, correct a paper's type or period, add portal files, check figures, mark returns filed, and approve the team's permission requests.",
          "For anything not ticked, they ask their manager or you, and the request waits in the Inbox for a yes or no.",
          "Only the owner can remove papers.",
          "Who sees which clients: everyone sees every client, or only the people assigned to it.",
          "Extra permission for one person lets one person do one thing without asking, for some clients or until a date.",
          "Removing someone takes their access at once. You can restore them later.",
        ],
      },
      {
        slug: "office-only",
        title: "Office only and approved computers",
        lead: "Keep staff to the PCs you approve, on your office internet, in office hours.",
        points: [
          "In Settings, Office and sign in, How your team works, one choice sets Office only, office hours and signing out. You can change each of them after.",
          "Standard: everyone signs in with the 2 step code, on any computer, from anywhere, at any time.",
          "Office only: staff, managers and front desk work only on approved PCs in the office, in office hours. You and partners work from anywhere.",
          "Office and approved remote: the same, and staff may also ask to use their own laptop away from the office. You approve it for a few days, and they can only view.",
          "Remote friendly: staff, managers and front desk work from anywhere in India, on computers you approve, in office hours.",
          "Solo CA: InboxCA signs you out after 15 minutes without use, and any staff work only on approved PCs in the office.",
          "A new PC waits for approval. Approve it in Settings; until then it shows This PC is waiting for approval.",
          "On an approved PC on the office internet, the email code is enough. Elsewhere the 2 step code is needed too.",
          "The owner's login works only on computers the owner approved. Remove a lost one in Your computers, and every other computer is signed out too.",
        ],
      },
      {
        slug: "sign-in",
        title: "Signing in, passkeys and a lost phone",
        lead: "Every sign in starts with a code from your email, then your 2 step code or a passkey. On an approved PC on the office internet, the email code can be enough.",
        steps: [
          "Enter your own work email and type the 6 digit code we email you.",
          "Then type the 6 digit code from your authenticator app, or use your passkey.",
        ],
        points: [
          "Codes in the app change every 30 seconds. If one fails, type the new one.",
          "A passkey uses your laptop's fingerprint or PIN, your phone or a security key in place of the 6 digit code. Add one from your account menu, Your sign in. You still enter the email code.",
          "Lost a device? Remove its passkey in Your sign in. Any computer that signed in with it is signed out, and the 6 digit code still works.",
          "Owner lost the phone? Sign in with the email code, then choose Lost your phone? Use a recovery code, and set up a new phone. Each code works once.",
          "The owner downloads 10 recovery codes in Settings, Office and sign in. Old codes stop working once new ones are downloaded. Keep them somewhere other than your phone.",
          "Everyone else who loses their phone: ask your firm's owner for help.",
        ],
      },
      {
        slug: "report-a-problem",
        title: "Report a problem or an idea",
        lead: "Anyone in your firm can tell Orelu when something is broken, does not work as expected or is out of date, or when you need something new.",
        steps: [
          "Choose Help in the sidebar, then Report a problem or idea. Or type Report in the search box.",
          "Choose what it is: Something is broken, Something does not work as expected, An idea or a feature I need, or Something is out of date. For something out of date, say which form, rule, due date or file.",
          "Type a short subject, and the details if you like.",
          "Attach up to 3 files if they help. Take a screenshot, or Record the screen for up to 1 minute: Chrome asks which tab or window to share. Or choose a picture, a recording or a PDF.",
          "Choose Send to Orelu. We reply to your email.",
        ],
        points: [
          "The report goes by email to Orelu support, with the page you were on, your role, your browser and the time, never anything else from the page. InboxCA keeps no copy of it.",
          "Pictures and recordings can show client details, such as PANs or names. They go only to Orelu support and are used only to fix and improve InboxCA.",
          "Each person can send up to 5 reports a day, one a minute.",
        ],
      },
    ],
  },
  {
    ...topic("billing"),
    articles: [
      {
        slug: "plans",
        title: "Plans, extra people and AI credits",
        lead: "Every plan has unlimited clients. Plans differ by returns a year, InboxCA storage, team and AI credits. No GST is charged: Orelu is not GST registered yet.",
        points: [
          ...plans.map(
            (plan) =>
              `${plan.name}: ${rupees(plan.monthly)} a month or ${rupees(plan.yearly)} a year. ${plan.returns} returns a year, ${plan.storage} storage, ${plan.ai} AI credits a month, ${plan.people === 1 ? "just you" : `a team of up to ${plan.people}`}.`,
          ),
          `Custom is for firms past ${top.name}: more than ${top.maxReturns.toLocaleString("en-IN")} returns a year or a team of more than ${custom.includedPeople}. Its price shows at the plan step.`,
          `One more person costs ${rupees(extraPerson)} a month. One more block of ${aiBlock.credits.toLocaleString("en-IN")} AI credits costs ${rupees(aiBlock.price)} a month. Each is paid first, then added.`,
          "Paid monthly, your plan gives a twelfth of the year each month, and what you do not use carries forward to March.",
          "Your plan follows the returns due in the year and InboxCA storage, and you hear about it at 80%. If your firm uses more than its plan gives, Settings, Billing shows the plan that fits, and nothing changes until you choose.",
          "Moving up starts at once, and you pay the difference for the rest of the period. Moving down starts at your next renewal.",
          "You pay by Cashfree AutoPay: UPI, card or bank mandate.",
        ],
      },
      {
        slug: "setup-fee",
        title: "The one time setup fee",
        lead: "The setup fee pays for bringing in your firm's old papers at the start. It is charged once, with your first payment.",
        steps: [
          "At the plan step, your first payment shows One time setup of InboxCA for your firm, with your plan's fee.",
          "Once your firm is open and your drive is connected, choose Add old files in Settings, Email and drive, Firm drive.",
          "Choose what to bring: Final papers only (recommended), One year in full, or Everything in these folders. Tick the folders in your drive, then choose Show what would move.",
          "InboxCA matches each folder to a client by its name and shows where every file would go. Choose the client for any folder with no client found.",
          "Choose Move these files. Each file is renamed and filed by year, client and type of work. Undo the move puts them back.",
        ],
        points: [
          `The fee by plan: ${plans.map((plan) => `${plan.name} ${rupees(plan.setup)}`).join(", ")}. For Custom it is worked out from its AI credits, and shown before you pay.`,
          "It is worked out from one month of your plan's AI credits. No GST is charged: Orelu is not GST registered yet.",
          "Old files are optional. InboxCA works on new emails from the first day, with or without them.",
          "The files stay in your drive and are only moved and renamed, so nothing is uploaded again. Files on a computer go into your drive's Incoming folder first, from the same page.",
          "In your first 14 days, only the latest three months of old files are brought in. The rest follows after.",
          "Cancel within 14 days of your first payment, before your old files start to be brought in, and the setup fee comes back with the rest. Once they have started, it is kept.",
        ],
      },
      {
        slug: "money-back",
        title: "Money back and cancelling",
        lead: "Cancel within 14 days of your first plan payment and you get that payment back in full.",
        points: [
          "You do it yourself in Settings, Billing, Money back, and confirm with the code from your authenticator app. Nobody needs to approve it. It applies once for each firm, monthly or yearly.",
          "Payments in those 14 days for a bigger plan, yearly payment, extra people or monthly AI blocks come back too. An AI top up comes back only for its credits not yet used. The one time setup fee is kept once your past papers have started to be brought in.",
          "After the money back your firm can view everything for 30 days. Then the firm is closed, and for 30 more days the owner can still sign in and download its data. Then InboxCA deletes it.",
          "The refund goes through Cashfree to the same card, UPI or bank account, and usually arrives within 5 to 7 working days.",
          "Cancel later at any time in Settings, Billing or at your bank or UPI app. You keep your plan until the period you paid for ends. After the first 14 days there is no part refund.",
          "If a payment fails, for 7 days nothing changes while it is tried again. Until day 30 your firm can view but not change anything. After day 30 the firm is closed: your team is signed out and the email and drive are disconnected, and for 30 more days the owner can still sign in and download its data.",
          "Your files are in your own drive, so they stay with you. Download your records as one ZIP from Settings, Your data, at any time.",
          "Close the firm in Settings, Your data: everyone is signed out and the email and drive are disconnected. For 30 days you can still sign in and download your data.",
        ],
      },
    ],
  },
];

export const helpArticles = helpGroups.flatMap((group) => group.articles.map((article) => ({ ...article, group })));
