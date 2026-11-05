// Privacy notice, terms, refund policy and data processing agreement. Every point follows
// what the product does in code (PLAN.md D5, D6, D33, D36, sections 5.14.1 and 8) and the
// official texts: the DPDP Act 2023 (sections 5, 6, 8, 11 to 14 and 16), the DPDP Rules 2025,
// the IT Act 2000 section 43A with the SPDI Rules 2011, the CERT-In directions of 28 Apr 2022,
// the Consumer Protection (E-Commerce) Rules 2020 and the RBI E-mandate Framework 2026.
// G.S.R. 843(E) and 846(E) of 13 Nov 2025 start most of the DPDP Act and Rules (sections 3 to 17,
// rules 3 and 5 to 16) and the end of section 43A eighteen months later, so until May 2027 the
// SPDI Rules apply and the DPDP duties are named with that start.
// Sign up records the version dates below as what a firm accepted, so a change that affects
// firms needs a new date.
import { analyticsToken, contactEmail } from "@/src/lib/site";
import { clientFiles } from "./security";

export const legalUpdated = "5 Nov 2026";
export const legalNote =
  "InboxCA is a product of Orelu, a partnership firm. Orelu's registration is in progress, and its registered name and address will be added here when it completes.";

// The person who answers questions, rights requests and complaints, and how fast. InboxCA
// stores and sends records for firms, so it may be an intermediary (IT Act section 2(1)(w)):
// IT Rules 2021 rule 3(2)(a)(i), as G.S.R. 120(E) of 10 Feb 2026 left it, asks for 24 hours and
// 7 days, which also meets the SPDI Rules' one month, the E-Commerce Rules' 48 hours and one
// month, and the DPDP Rules' 90 days.
export const grievanceContact = "Utsav Doshi and Ria Chheda";
export const grievanceAcknowledge = "24 hours";
export const grievanceAnswer = "7 days";

export const privacySections = [
  {
    id: "who",
    title: "Who we are",
    points: [
      "InboxCA is a product of Orelu, a partnership firm in India run by Utsav Doshi and Ria Chheda. Orelu's registration is in progress, and its registered name and address will be added here when it completes.",
      "This notice covers this website and the InboxCA app, and it explains how InboxCA handles a firm's data.",
      `To read this notice or the terms in a language of the Eighth Schedule to the Constitution, write to ${contactEmail} and we send it in that language.`,
      "For the personal data of your firm's people, Orelu decides how it is used (it is the data fiduciary). For your clients' data, your firm decides and Orelu only processes it on your firm's instructions, under the data processing agreement.",
      "Today the Information Technology Act 2000 and its 2011 rules on sensitive personal data apply. Most duties under the Digital Personal Data Protection Act 2023 and its Rules of 2025 start in May 2027, and this notice says where a point starts then.",
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
      "We use those details to run your firm's account, to email you sign in codes, payment notices and receipts, and to keep the account safe. We do not sell them, and we pass them only to the services that run InboxCA, listed below.",
    ],
  },
  {
    id: "product",
    title: "Your clients' data in InboxCA",
    points: [
      "Your firm decides what happens to its clients' data. InboxCA only follows your firm's instructions, under the data processing agreement.",
      "Client files stay in your firm's own OneDrive or Dropbox.",
      "InboxCA keeps your client list, your records and the figures read from files, so that it can do its work.",
      "InboxCA also keeps the text read from each file, encrypted with your firm's key in InboxCA's own store, planned for Backblaze B2, so it can search the file and read its figures again without opening it. The text is removed when the file is removed.",
      "InboxCA does not keep email subjects or email text, portal passwords, OTPs, card details or Aadhaar numbers. A password your team types to open a locked PDF is kept, encrypted with your firm's key, so the file opens again. An AI reply draft is kept, encrypted with your firm's key, until the email is answered or marked done, and at most until the email is 7 days old.",
      ...clientFiles,
      "InboxCA also reads the emails your firm gets from the GST and income tax departments, to find the client they are about.",
      "When someone who is not yet a client writes to your firm, InboxCA only checks by rules whether the email asks about your firm's services, and keeps none of its words. It keeps a record of who wrote and when, so that your firm can add them as a client.",
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
      "Only the services InboxCA runs on, each under its own agreement. They are listed in the security policy and in the data processing agreement.",
      "The AI service receives only the email being worked on and that one client's own records, never the papers themselves.",
      "When someone in your firm sends Report a problem or idea, it goes by email to Orelu support with what they type and attach, their work email, the page they were on, their role, their browser and the time. InboxCA keeps no copy of it. Orelu uses it only to fix and improve InboxCA.",
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
      "The text read from a file is kept until the file is removed. An AI reply draft is kept until its email is answered or marked done, and at most until the email is 7 days old.",
      "The record of who did what is kept for 36 months.",
      "When a firm closes its account, its owner can still sign in and download its data for 30 days. Then InboxCA deletes the firm's records; the activity log and the sign in emails of the firm's people are kept one more year, as the IT Rules 2021 and, from May 2027, the DPDP Rules 2025 ask, and backups expire within 35 days. The files stay in the firm's drive.",
    ],
  },
  {
    id: "where",
    title: "Where it is kept",
    points: [
      "Records will be kept in a Supabase database. Its region is chosen at launch, and India is planned.",
      "InboxCA's temporary files, safety copies, the text read from files and backups are planned for Backblaze B2, which is outside India. They are encrypted.",
      "Your files are wherever your drive provider keeps them.",
    ],
  },
  {
    id: "breach",
    title: "If data is exposed",
    points: [
      "If personal data that Orelu holds is exposed, Orelu reports it to CERT-In within 6 hours, as CERT-In's directions of 28 April 2022 ask, and tells each affected person without delay.",
      "From May 2027, when section 8(6) of the Digital Personal Data Protection Act 2023 starts, Orelu also reports it to the Data Protection Board of India as the Act and its Rules ask.",
      "If your clients' data is affected, Orelu tells your firm within 24 hours with what happened, which data and what to do, and helps your firm make its own reports.",
    ],
  },
  {
    id: "rights",
    title: "Your rights",
    points: [
      "You can ask to see a summary of the personal data we hold about you, how it is used and which services it was shared with, to correct or complete it, or to delete it. You can withdraw a consent you gave at any time by writing to the same address.",
      "You can name another person to exercise these rights for you if you die or cannot act.",
      `Write to ${grievanceContact} at ${contactEmail} from the email address your account uses, so that we know it is you. We answer within ${grievanceAnswer}.`,
      "If you are a client of a CA firm, ask your firm first. It decides what happens to your data, and InboxCA helps it answer.",
    ],
  },
  {
    id: "grievance",
    title: "Complaints",
    points: [
      `${grievanceContact} are the grievance officers for InboxCA. Write to ${contactEmail}.`,
      `We acknowledge a complaint within ${grievanceAcknowledge} and answer it within ${grievanceAnswer}.`,
      "From May 2027, when that part of the Digital Personal Data Protection Act 2023 starts, you can also complain to the Data Protection Board of India if we do not settle it.",
    ],
  },
  {
    id: "changes",
    title: "Changes to this notice",
    points: [
      "When this notice changes, the date at the top changes. Firms using InboxCA are told by email before a change that affects them.",
    ],
  },
] as const;

export const termsSections = [
  {
    id: "about",
    title: "About these terms",
    points: [
      "InboxCA is a product of Orelu, a partnership firm in India. Orelu builds software that takes repeated office work off a team, and InboxCA is its product for chartered accountant firms. These terms cover this website and your firm's use of InboxCA.",
      "The CA in InboxCA stands for the chartered accountant firms it is built for. Orelu does not practise as chartered accountants and is not part of, or approved by, the Institute of Chartered Accountants of India.",
      "By signing up, the person signing up agrees to these terms on behalf of their firm and confirms they may do so. The data processing agreement and the privacy notice are part of these terms.",
      "InboxCA is sold only to firms, for their professional work, and not for anyone's personal or household use.",
    ],
  },
  {
    id: "website",
    title: "This website",
    points: [
      "The screens on this website are illustrations, and the firms, names and figures in them are sample data.",
      "Prices on this website are estimates, before GST. The exact price, with GST where it applies, is shown before you pay.",
    ],
  },
  {
    id: "service",
    title: "What InboxCA does",
    points: [
      "InboxCA reads the emails from clients and from the GST and income tax departments in your firm's own mailbox, files attachments in your firm's own drive, sends routine replies and reminders from your firm's address, and reads figures from papers to prepare GST and income tax forms and files.",
      "InboxCA prepares. Your team checks every figure, approves every form and files every return on the government portals with its own login, OTP or digital signature. InboxCA is not an e-Return Intermediary and does not file anything itself.",
      "InboxCA gives no accounting, audit, tax or legal advice, and it does not sign or certify any document or award any certificate, badge or designation. Your firm's own chartered accountants do the professional work, sign what they sign, and stay responsible for what the firm files.",
      "Due dates and form versions come from government notifications, and InboxCA says when one is not yet checked. Your firm confirms every date and figure before it relies on it.",
    ],
  },
  {
    id: "account",
    title: "Your account and your team",
    points: [
      "One login is for one person, who must be 18 or older. Keep your sign in codes and recovery codes to yourself.",
      "The owner decides who is in the firm's team and what each role may do. The owner is responsible for what the team does in InboxCA.",
      "You connect your own mailbox and drive, and you can disconnect them at any time.",
    ],
  },
  {
    id: "billing",
    title: "Plans and payment",
    points: [
      "Plans are paid monthly or yearly through Cashfree AutoPay, by UPI, card or bank mandate. Each plan's returns, storage, AI credits and team size are shown before you pay and in Settings, Billing.",
      "The exact amount, with GST where it applies, is shown before you pay, and you confirm it. The same amount is then taken each month or each year, with a notice at least 24 hours before each debit. A card or UPI debit above ₹15,000 needs your approval each time, as the Reserve Bank's rules ask. Orelu never takes more than the mandate's limit shown at setup without asking you.",
      "If your firm uses more than its plan gives, InboxCA moves it to the plan that fits and takes the difference, with an email 3 days before. Moving to a bigger plan applies at once and moving to a smaller one at the next renewal. Extra people and AI top-ups are paid for first, then added.",
      "If a payment fails, for 7 days nothing changes while it is tried again, until day 30 your firm can view but not change anything, and after day 30 the firm is closed: its team is signed out, its email and drive are disconnected, and for 30 more days the owner can still sign in and download its data.",
      "The refund policy gives the 14 day money back and how to cancel. You can turn AutoPay off at any time in Settings, Billing or at your bank or UPI app. Until Orelu starts taking payments, firms use InboxCA with no payment, as Settings, Billing shows.",
      "A one time setup fee, when one is shown before you pay, covers bringing in your firm's past papers. Prices can change for a new period with an email 30 days before.",
    ],
  },
  {
    id: "data",
    title: "Your firm's data",
    points: [
      "Your firm owns its files, its client list, its records and everything InboxCA prepares for it. InboxCA works on them only as your firm instructs, under the data processing agreement.",
      "Your firm is responsible for having the right to give InboxCA its clients' data, and for telling its clients what the law asks it to tell them.",
      "You can download your records from Settings, Your data at any time, and for 30 days after your firm closes its account.",
      "Your firm's data is never used for advertising or to train AI.",
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
      "Use InboxCA only for your firm's own practice and within the law, including the professional rules that apply to your firm.",
      "Do not try to break into InboxCA, overload it, copy it in bulk, resell it, or use it for another firm's work.",
      "Do not use it to send unlawful or misleading emails, or to mislead anyone about InboxCA or Orelu.",
      "Do not keep, send or share through InboxCA anything that belongs to someone else and that you have no right to; that is obscene or invades someone's privacy; that is harmful to a child; that infringes a patent, trademark or copyright; that is false or misleads anyone about where it came from; that pretends to be someone else; that threatens India's unity, security, public order or friendly relations with other countries; that carries a virus or other harmful code; or that breaks any law.",
      "If someone breaks these terms, Orelu may at once suspend or end their access, or remove the information concerned, or both. Breaking the law this way can also bring a penalty or punishment under the Information Technology Act 2000 or another law, and an offence that the law says must be reported is reported to the authority concerned.",
      "Each plan's AI credits and emails have the limits shown in Settings, Billing.",
    ],
  },
  {
    id: "suspension",
    title: "Pausing and ending",
    points: [
      "When a payment stays unpaid, your firm can only view and then is closed, as Plans and payment describes. Orelu may also pause a firm's account when the account is used against these terms or the law, when the law requires it, or to stop a security problem. Where it can, Orelu emails the owner first.",
      "Your firm can close its account at any time from Settings. Everyone is signed out, the firm's email and drive are disconnected, and for 30 days the owner can still sign in and download the firm's data. Then InboxCA deletes the firm's records, keeping the activity log and the sign in emails of the firm's people one more year, as the IT Rules 2021 and, from May 2027, the DPDP Rules 2025 ask. Files in your drive are not touched.",
      "Orelu may stop offering InboxCA with 90 days' notice by email. Any payment for time after that date is returned.",
    ],
  },
  {
    id: "responsibility",
    title: "Responsibility",
    points: [
      "Orelu works to keep InboxCA correct and available, but it is offered as it is, without a promise that every reading, reply or figure is right or that it is always available. Your team's check before filing is part of how InboxCA works.",
      "Orelu's total responsibility to your firm for all claims about InboxCA in any 12 months is limited to the fees your firm paid Orelu in those 12 months. Orelu is not responsible for loss of profit, penalties, interest or indirect loss, or for loss caused by your firm's mailbox, drive or portal accounts, or by what your firm filed.",
      "If a third party claims against Orelu because your firm broke these terms or the law, your firm covers Orelu's loss from that claim. If a third party claims that InboxCA, used as agreed, infringes their intellectual property, Orelu covers your firm's loss from that claim. Each of these is limited in the same way as above.",
      "Nothing here takes away a right you have under Indian law that cannot be limited.",
    ],
  },
  {
    id: "names",
    title: "Names and logos",
    points: [
      "InboxCA™ and Orelu™ are trade marks of Orelu. They are not registered yet, so they carry ™ and not ®. InboxCA, the InboxCA logo and Orelu belong to Orelu. InboxCA is licensed to your firm for its use, not sold.",
      "InboxCA does not use the name, emblem or logo of the Institute of Chartered Accountants of India.",
      "Other companies' names and logos belong to their owners. They are shown only to say what InboxCA is built to work with, and do not mean a partnership, endorsement or certification.",
    ],
  },
  {
    id: "changes",
    title: "Changes to these terms",
    points: [
      "When these terms change, the date at the top changes. Firms using InboxCA are emailed at least 30 days before a change that reduces what they get or adds a duty. Using InboxCA after that date means your firm accepts the change; a firm that does not can close its account and the refund policy applies.",
    ],
  },
  {
    id: "law",
    title: "Law and disputes",
    points: [
      "These terms follow the laws of India. Disputes go to the courts at Mumbai, after both sides have first tried to settle by writing to each other for 30 days.",
      `Notices to Orelu go to ${grievanceContact} at ${contactEmail}. Notices to your firm go to the owner's email address.`,
    ],
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
      "Payments in those 14 days for a bigger plan, yearly payment, extra people or monthly AI blocks come back too. An AI top up comes back only for its credits not yet used.",
      "The one time setup fee is not returned once your old files have started to be brought in.",
      "After the money back your firm can view everything and download its data for 30 days. Then the firm is closed: your team is signed out and the email and drive are disconnected, and for 30 more days the owner can still sign in and download its data. Then InboxCA deletes the firm's data. Your files stay in your drive.",
    ],
  },
  {
    id: "cancel",
    title: "Cancelling later",
    points: [
      "You can cancel at any time, in Settings, Billing or at your bank or UPI app. Cancelling stops the next renewal, and you keep your plan until the period you paid for ends. There is no charge for cancelling.",
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
      "After day 30 the firm is closed: your team is signed out and the email and drive are disconnected. For 30 more days the owner can still sign in and download your records.",
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

// The data processing agreement between a firm (the data fiduciary for its clients' data)
// and Orelu (its data processor), as section 8(2) of the DPDP Act 2023 asks. Sign up records
// this date as the version a firm accepted.
export const dpaUpdated = "4 Nov 2026";
export const dpaSections = [
  {
    id: "parties",
    title: "Who agrees to what",
    points: [
      "This agreement is between your firm and Orelu, a partnership firm in India that makes InboxCA. It is part of the terms and applies from the day your firm signs up.",
      "For your clients' personal data, your firm is the data fiduciary under the Digital Personal Data Protection Act 2023: it decides why and how that data is used. Orelu is your firm's data processor and acts only on your firm's instructions.",
      "Most duties under that Act and its Rules of 2025 start in May 2027. Until then the Information Technology Act 2000 and its 2011 rules on sensitive personal data apply, and the safeguards below are the security practices the two sides agree under section 43A of that Act.",
      "For the personal data of your firm's own people, Orelu is the data fiduciary, and the privacy notice applies.",
    ],
  },
  {
    id: "data",
    title: "The data and the purposes",
    points: [
      "The data: your clients' names, contact details, PAN, GSTIN and other registration numbers, bank details, the papers they send and the figures read from them, the emails handled for them, and the returns and notices prepared for them.",
      "The purposes: only the work your firm asks InboxCA to do, which is sorting and answering client emails, reading the GST and income tax departments' emails about them, filing papers in your firm's drive, reminding clients for missing papers, and preparing GST and income tax forms and files for your team to check and file. Nothing else, and never advertising or training AI.",
      "Your firm's instructions are its settings and actions in InboxCA, these terms and any written instruction from the owner. Orelu processes the data only on them, and on the law where the law requires it; in that case Orelu tells your firm unless the law forbids it.",
    ],
  },
  {
    id: "firm",
    title: "Your firm's duties",
    points: [
      "Your firm makes sure it may give InboxCA its clients' data, gives its clients the notice the Act asks for and has their consent or another lawful ground, and answers their requests about their data. For a client under 18, that includes a parent's consent where section 9 of the Act asks for it, from May 2027. For bank and card details, it includes the client's consent in writing, by letter or email, as the 2011 rules ask. InboxCA does not collect consent from your clients.",
      "Your firm keeps its own mailbox, drive and portal accounts safe, and decides who in its team may see and do what in InboxCA.",
    ],
  },
  {
    id: "security",
    title: "How the data is protected",
    points: [
      "Everything that travels between you, InboxCA and its services is encrypted (TLS 1.2 or newer).",
      "PAN, GSTIN, phone numbers, email addresses, bank details and the figures read from your files are encrypted with your firm's own key (AES 256). Each firm has its own key, and the database keeps each firm's records apart from every other firm's.",
      "Every sign in needs two proofs. The owner's login works only on computers the owner approved, and the owner can keep staff to approved office PCs, on the office internet connection, in office hours.",
      "Staff can view files but cannot change or delete the originals. Every view, download, share and delete request is recorded, and nobody can edit the record or delete it early.",
      "Email subjects and text, portal passwords and OTPs are never kept. A file passes through InboxCA only while it is checked and filed, at most 24 hours, or up to 7 days if your drive cannot be reached. InboxCA also keeps the text read from each file, encrypted with your firm's key in InboxCA's own store, planned for Backblaze B2, so it can search the file and read its figures again without opening it. The text is removed when the file is removed. A password your team types to open a locked PDF is kept, encrypted with your firm's key, so the file opens again. An AI reply draft is kept, encrypted with your firm's key, until the email is answered or marked done, and at most until the email is 7 days old.",
      ...clientFiles,
      "Orelu's own team cannot open your firm's data. To fix a problem, support may ask in the app to see your people and client names for one hour; the owner approves it and it is recorded.",
      "Orelu's people who work on InboxCA are bound to keep it confidential.",
    ],
  },
  {
    id: "others",
    title: "Other services that handle the data",
    points: [
      "Orelu uses other services to run InboxCA, each under its own agreement that binds it to protect the data. Those planned for launch are: Supabase (database and sign in), DigitalOcean (the app's server, in Bangalore), Amazon Web Services (the key vault, planned for the Mumbai region, and system email), Backblaze B2 (encrypted temporary files, safety copies, the text read from files and backups, outside India), Resend (system email until Amazon's is set up), OpenAI (AI, which receives only the email being worked on and that client's own records), Cashfree (payments) and Sentry (error reports, with personal details removed).",
      "Backblaze B2, OpenAI, Sentry and Resend keep or handle data outside India. Your firm agrees to this, as the work needs it, and each must protect the data at least as well as these terms and the 2011 rules ask.",
      "Your firm's own mailbox and drive providers act for your firm under its own accounts, not for Orelu.",
      "Orelu emails firms before a new service starts handling their data. A firm that objects can close its account under the terms.",
    ],
  },
  {
    id: "breach",
    title: "If data is exposed",
    points: [
      "If your clients' data held by Orelu is exposed, Orelu tells your firm within 24 hours of knowing: what happened, which data, and what to do.",
      "Orelu reports to CERT-In itself within 6 hours where CERT-In's directions of 28 April 2022 ask it to. Those directions also ask your firm to report an incident it notices itself, and that duty cannot be passed to Orelu. From May 2027, when section 8(6) of the Act starts, your firm, as the data fiduciary, reports to the Data Protection Board of India and to the people affected, as the Act and the Rules ask. Orelu gives your firm what it needs for those reports.",
    ],
  },
  {
    id: "rights",
    title: "Your clients' requests",
    points: [
      "When a client asks your firm to see, correct or delete their data, your firm answers. Orelu helps within 30 days of your firm asking, with the records InboxCA holds and the download in Settings, Your data.",
      "Orelu answers your firm's reasonable written questions about how these safeguards work.",
    ],
  },
  {
    id: "end",
    title: "How long, and what happens at the end",
    points: [
      "Orelu keeps your clients' data only as long as your firm uses InboxCA, except the activity log, which is kept 36 months, and safety copies of deleted or changed files, which are kept for 30 days.",
      "When your firm closes its account, the owner can download the firm's records for 30 days. Then Orelu deletes the firm's records, and backups expire within 35 days. The activity log is kept one more year, as the DPDP Rules 2025 will ask from May 2027. The files in your firm's drive are not touched.",
      "Records will be kept in a Supabase database whose region is chosen at launch, with India planned. Temporary files, safety copies, the text read from files and backups are planned for Backblaze B2, outside India, encrypted.",
    ],
  },
  {
    id: "changes",
    title: "Changes to this agreement",
    points: [
      "When this agreement changes, the date at the top changes, and firms are emailed at least 30 days before a change that affects them. The terms say what a firm can do if it does not accept a change.",
    ],
  },
] as const;
