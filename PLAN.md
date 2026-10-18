# InboxCA, a product by Orelu — Build Plan

- **What:** a multi-tenant SaaS for Indian CA firms, named **InboxCA** and made by Orelu: an AI back-office over email.
- **Naming rule (user, 8 Oct 2026):** the product is **InboxCA**; the company is **Orelu**. Every user-facing string, screen, email, invoice footer, the drive folder (`Apps/InboxCA`) and the client deck say InboxCA, with "a product by Orelu" where the maker is named. In this file's running text, "Orelu" still stands for the product ("Orelu reads the email") unless it plainly names the company: the legal entity, billing and the Razorpay account, the team, costs and margins, and Orelu's own accounts with providers. Code uses `inboxca` for product names and never shows "Orelu" to a firm's staff or clients except in that maker line.
- **Does:** reads client emails, files documents, answers routine requests, flags notices, sends reminders and acknowledgements, and turns client data (Tally, Excel, PDF, scans, email text) into official GST and income-tax templates.
- **Rule:** the firm's team checks and approves before anything is filed: the staff yes/no check on every figure is the approval, and a firm can also require a manager's or partner's sign-off.

- This file is the source of truth for the build: read it fully before writing code, work through the milestones in order, tick checkboxes as tasks finish.

- **Status:** rewritten on 2026-09-30 after the meeting with Paresh bhai, updated on 2026-10-01 and on 2026-10-07 (employee and manager permissions, §5.17.2; the simplified office lock with four checks, owner-approved PCs and the self-adjusting office connection, §5.8 and §5.17; client invoices and fees removed from the launch, D30; the filing-work rights for staff (yes/no check, mark filed, manager approves forms), §5.17.2; year and month download with optional removal, D31, since replaced by D36; GST handling, D32; the no-Orelu-person setup rule, D23). 2026-10-01 covered (smart reminders, prepared forms, activity-log retention, pricing formula, AI credits and usage limits, future WhatsApp and AI call packs); 14-day money-back guarantee added on 2026-10-07 (D33); data model reduced from 71 tables to 30 on 2026-10-07 (D34); product name InboxCA chosen on 2026-10-07 (D35), rename pending domain registration; client files moved to the firm's own drive, plans re-sized by workspace and returns a year, sign-up guards and the portal files drop box added on 2026-10-08 (D36 to D39); seven features for after launch added (D40) and leftover lines brought in line with D35 and D36 on 2026-10-10 (D4, the UI tokens, the M4 and M5 acceptance checks, the workspace bucket and the environment variables); rounding rule added on 2026-10-11 so that every plan price, monthly and yearly, ends in the same last three digits (§5.14; the prices themselves stay in the business plan); no product code yet. The previous WhatsApp-first version is archived outside the repo.
- **Owner:** Orelu (Utsav Doshi, Founder, CEO & CTO; Ria Chheda, CMO).
- **First user:** Paresh bhai's CA firm. More design-partner firms are to be found (§12).
- **Release model:** **every feature ships together, in one launch.** We build module by module internally, test each with Paresh bhai's firm as it is finished, and launch only when all are ready (§7).
- **Business plan** (pricing, costs, market, go-to-market): https://claude.ai/code/artifact/e7e3f92a-4455-4d87-bb00-56d4d1c322b8

---

## 1. Context

### 1.1 Where this came from

- An Instagram reel (@the_automation_guru_) sells a "CA Firm Automation + Dashboard" as a one-off n8n build per firm, with data in Google Sheets.
- Its workflow is kept in [reference/CA_Firm_Automation_n8n_workflow.json](reference/CA_Firm_Automation_n8n_workflow.json) (152 nodes) for business logic only.

**Paresh bhai's needs (meeting of 30 Sep 2026):**

1. **Part 1, incoming email:** each client email is one of: asking for past records, asking for current-year records, only telling the firm a notice was received, data for GST filing, data for income-tax filing, or data for tax audit. Record requests should get an automated reply; data should be filed into folders by **Year** and **Client** (per work type).
2. **Part 2, data to filing:** work on the data that arrives by email, which comes as Tally exports, PDFs and Excel files (these are inputs, confirmed by the user on 7 Oct 2026) → produce the filled form → staff approval (yes / no check) → upload through his filing software (**TaxPower**, **KDK Spectrum**; books in **Tally**) → file → send the acknowledgement to the client.
3. **Constraints:** storage, AI and encryption are his three concerns; staff should reach data only inside the office and only during the firm's office hours; the owner can reach it anytime; staff must not delete or change originals, and controls should deter and record misuse. Office hours and holidays are editable in Settings; Paresh bhai's current preference is 9 am–5 pm, to be confirmed.
4. **Volumes:** about 300 GB of documents a year (about 30 GB in September, the tax-audit month). His files live in his own drive (D36), so nothing has to leave after three years; he needs about 1 TB of drive space for the last three years and adds about 300 GB a year.

### 1.2 How automation runs (no n8n)

- **No n8n or other no-code tool (D2):** automation is code inside the app.
- Durable work (reminders, follow-ups, email processing, file jobs, template runs) is recorded in one Postgres `jobs` table, driven by **Supabase Cron** (schedules), with idempotent workers. Workers claim jobs straight from the table (`FOR UPDATE SKIP LOCKED` with a lease), so no separate queue service is needed (step 3, 14 Oct 2026).
- Pay-as-you-go; no extra orchestration service.

| Area | n8n workflow (the reel) | Our approach |
|---|---|---|
| Many firms | One workflow copy per firm | One app serves every firm |
| Data | Google Sheets, no isolation | Postgres with row-level security per firm |
| Reliability | A rerun can send the same email twice | Send jobs written in the same transaction as the change, atomic claims, idempotency keys, delivery reconciliation |
| Scheduling | Fixed daily sweeps | Jobs with a `run_at` time, cancelled when the task is filed |
| Fairness | n/a | Per-firm concurrency and per-mailbox send limits |
| AI | Pasted text summary | Tools that read live records; anything else goes to the team |
| Email | One hard-coded Gmail | Each firm connects its own mailbox; no message text stored |

- If job volume outgrows Postgres queues, a durable-workflow engine (e.g. Inngest) can sit behind the same job interface without changing domain code.

### 1.3 Other materials

- **Business plan** (shared doc): link above. Pricing, plan sizes, costs and competition live there, not in this file.
- **Client-facing deck** for Paresh bhai: [Orelu-CA-Firms-Plan.pptx](Orelu-CA-Firms-Plan.pptx). Non-technical, InboxCA-branded (navy and blue, the InboxCA logo on the cover, "a product by Orelu" in the footer), **11 slides** (cut from 16 to 9 on 8 Oct 2026 because it read as too complicated for a client; a facts slide and, on 10 Oct 2026, a future features slide were added since): cover, with the InboxCA logo and "A product by" the Orelu logo; a facts slide on the hours a firm loses today, using other companies' survey figures marked as estimates and no claimed figure for InboxCA's own savings; today's work beside what Orelu does; how it works; what clients see; the dashboard; one "You stay in control" slide (files in the firm's own drive, the consent tick, office-only staff access, view-only, deleted files, emails); the plans and Paresh bhai's estimate on one slide (prices only there, as estimates before GST); self-serve set-up; "What we plan to add next (future features)" (the seven after-launch features of §5.20 in one table, with a note that none needs a portal password and that they are not in the first version); closing. Every line is in everyday words. Orelu's own costs, margins and the pricing formula never appear in it, and client fee billing is not in it.
- Internal plan deck (older, technical): https://claude.ai/artifact/7Y8RhKmdCj7qnxCdpkyQQ6 (private). Superseded by this file where they differ.
- Orelu brand source: `~/Desktop/projects-coding/orelu` (`dist/styles.css`, `dist/assets/`). See §9.

### 1.4 Decisions

| # | Decision | Value | Status |
|---|---|---|---|
| D1 | Release model | All features ship together in one launch (§2). | **Decided** |
| D2 | Automation engine | Code in our app; one Postgres jobs table driven by Supabase Cron; workers claim from the table itself, with no separate queue service (Supabase Queues dropped in M0 step 3, 14 Oct 2026, as one moving part fewer); no n8n (§1.2). | **Decided** |
| D3 | Channels | **Email only at launch**, through each firm's own mailbox. **Later add-ons, designed now but not built:** an AI WhatsApp assistant on the official WhatsApp Business Platform (Meta Cloud API, the firm's own number and Meta account, so Meta bills the firm directly) and AI phone calls through a telephony API, both metered and capped (§5.19). Never unofficial WhatsApp or WhatsApp Web automation. | **Decided by user** (30 Sep, 1 Oct 2026) |
| D4 | Product name | **Replaced on 7 Oct 2026 by D35.** The product is named InboxCA. The name is still held in one config constant. | **Replaced** (7 Oct 2026) |
| D5 | Plans and billing | Plans are sized by **the work Orelu does; clients are unlimited** on every plan (user, 1 Oct 2026). Solo, Growth, Scale and Enterprise each include a number of **users** (the final size of the whole team, the owner included: 1 on Solo, a single CA who is both the admin and the worker, and up to 10, 20 and 40 on Growth, Scale and Enterprise; user, 8 Oct 2026, replacing the earlier "owner free" rule), an **Orelu workspace a year**, a number of **returns a year** and **AI credits a month**; client files live in the firm's own drive, so storage does not size a plan (re-based on 8 Oct 2026, D36 and D37). **Custom** (above Enterprise on workspace, returns or people) is a plan builder where the owner enters clients, practice type and people, extending Enterprise (§5.14; Orelu works out the returns and measures the workspace): the firm's work sets the price, people up to 40 are included at no extra cost, and only people above 40 add to it; its extra work and extra people are priced in **slabs that get cheaper as the firm grows** (user, 7 Oct 2026). Any plan can add users one at a time. Extra AI credits come in fixed blocks that are **capped per plan**, so they give headroom for a busy month and can never replace an upgrade; storage blocks no longer exist. **The plan follows the firm's work and is not chosen down:** Orelu measures the workspace it keeps for the firm and the returns in the firm's calendar, each over a year, and places the firm on the plan that fits the higher of the two; above Enterprise's figure it is on Custom automatically, whatever its head-count, and having fewer people than a plan includes never lowers the price (user, 7 Oct 2026; §5.14). A one-time **setup fee** = the AI cost of the setup credit allowance (one month of the plan's AI credits, used to place past files, §5.16) plus 20%. Formula values and prices live in the business plan and admin configuration, never in code. Build entitlements, metering and alerts. **All payments run through Razorpay and are automatic (§5.14.1):** the owner picks monthly or yearly (yearly = 11 × monthly, i.e. 1 month free, then adjusted by the rounding rule so that it ends in the same last three digits as the monthly price, §5.14) and sets up Razorpay AutoPay once (card or UPI up to ₹15,000 a debit; bank e-mandate (eNACH) above that, because card and UPI debits over ₹15,000 need an OTP every time). The first successful debit activates the firm by webhook and emails the owner an invite (no manual onboarding); renewals debit automatically. Top-ups and add-ons are **paid first** and applied automatically when the payment is captured. Razorpay's fees are counted in Orelu's costs. | **Decided** |
| D6 | Stored content | Store firm-entered/confirmed client and business records and deliberately accepted documents. **Never persist email subjects or bodies, transcripts, raw webhook payloads or message summaries.** Minimal operational ids/statuses remain (§8.0). | **Decided by user** |
| D7 | Document naming | Upload first; staff choose a document type, or **Other + a typed name**. Original filename is independent. | **Decided by user** |
| D8 | Missing information | The AI pauses and raises **Needs team reply** on the dashboard; staff reply from their own mailbox. | **Decided by user** |
| D9 | Assistant scope | CA-firm business only. Off-topic or unclear mail goes to the team; no general chatbot. | **Decided by user** |
| D10 | Custom document retrieval | Lookup includes Other/custom names and firm-approved aliases under the same permissions. | **Decided by user** |
| D11 | Ownership | The firm owns its mailbox, its drive and its filing-software licences. Orelu pays its own hosting, workspace and AI costs, recovered through the plan price. | **Decided** |
| D12 | Where data lives | Client files live in the **firm's own drive** (D36): the firm chooses its provider and region. Orelu's own data is not restricted by location (user, 30 Sep 2026): use the **cheapest reputable, secure provider worldwide**. Database and login: Supabase Mumbai. Orelu's workspace store (temporary files in transit, the encrypted text read from files, the locked 30-day safety copies and database exports): **Backblaze B2** (S3-compatible, SOC 2 Type 2, object lock, $6.95 per TB a month, no minimum; US or EU region), with IDrive e2 as the alternative behind the same S3 adapter. Web app: Cloudflare Workers (D28). Keys: AWS KMS `ap-south-1`. | **Decided by user** |
| D13 | AI provider and retention | Provider-neutral adapter; **OpenAI API by default** (`gpt-5-mini` for extraction and replies, `gpt-5-nano` for labels). Zero data retention required; foreground Responses with `store:false`; no Files, Conversations, Assistants, Threads, Vector Stores, Batch, background mode or extended prompt caching for client content. | **Decided** |
| D14 | Mailbox go-live gate | A firm's mailbox goes live only after an end-to-end test: receive, label, file an attachment, send a reply from the firm's own address, and confirm nothing was stored beyond metadata. | **Decided** |
| D15 | Registration-independent launch | Orelu is not yet registered. Launch uses only what the firm owns or an individual developer can run: email through TLS IMAP/SMTP app passwords or OAuth the firm's own admin consents to. Register Udyam now (free) for Orelu's domain, email and future partner programmes; an LLP later. Pilot contracts are signed by Utsav Doshi trading as Orelu (confirm with a CA/lawyer). | **Decided by user** |
| D16 | Three-year automation window | **Replaced on 8 Oct 2026 by D36.** Files live in the firm's own drive, so nothing leaves after 36 months and no file is removed by a time rule. Orelu works on every file in the folder it manages; how far back that goes is the firm's choice. | **Replaced** (8 Oct 2026) |
| D17 | Access policies | **Each firm sets, in Settings, who can open client data, from where, on which device, when, and what they can do there** (§5.17). Every lock is optional, per firm, role, branch or person. **Standard** is the default; Office only and the other presets are opt-in. Settings → **"Staff can use Orelu only in the office"** is one switch with nothing else for the owner to configure. With it on, every staff request must pass four checks: login with 2-step code, a PC the owner approved, the office hours the owner set, and the office's internet connection as Orelu's server sees it (§5.8, §5.17.1). Every new PC needs the owner's or a deputy's tap; personal devices are refused until approved. A changed office address is accepted only through a fixed address, the owner's or a deputy's tap, or a PC marked as staying in the office that holds a device-bound passkey; a laptop never establishes it, and there is no unconfirmed session. Orelu handles the rest internally and adjusts by itself for every firm: it tracks address changes and suggests a fixed address in plain words when confirmations become frequent. The beacon page, same-Wi-Fi check, office code and laptop question are not in the launch build. Nothing is installed (user, 7 Oct 2026). | **Decided by user** |
| D18 | No staff misuse | **Every employee and manager can see every client's folders and open any document, view-only by default:** in Orelu's browser viewer, in the office and in office hours (under Office only), with no edit, upload, download, share, link or delete. Built-in exceptions, because they are the filing work itself: **renaming** a document by correcting its type or period (logged, undoable); the **yes/no check** on extracted figures; **marking a form filed** and attaching its acknowledgement; **adding recognised portal files** (GSTR-2B, Form 26AS, AIS and the like, D39); and downloading **approved filing files** to upload on the portal. The yes/no check is the approval: once every figure has passed it, staff download the filled form to upload on the government portal. A firm can also switch on a second approval by a manager or partner before download (off by default; user, 7 Oct 2026). Anything more is a **request**: a manager approves their team's everyday requests once; deletes, standing permissions and a manager's own requests go to the owner (§5.17.2). These are the defaults; the owner can change what each role may do in Settings → Permissions (user, 7 Oct 2026). **The owner (admin) can do everything.** Originals are **read-only**: corrections are new versions. Deletes need the owner's approval and wait 30 days in a Deleted folder in the firm's drive; Orelu also keeps its own locked 30-day copy of anything deleted or changed (D36). Staff never get drive access, bulk download or folder export; every opened file carries a watermark; every action is logged. **Activity logs** (who opened, downloaded, shared, changed or asked to delete what, from which device and IP address, and when) are kept **36 months by default**; the firm can choose 12, 24 or 36 months, never less than 12. Nobody, including the owner, can edit or delete a log early; after the period it is deleted automatically. | **Decided by user** |
| D19 | Filing boundary | Orelu **prepares** returns and import files; the firm files through its own software or the government portal with its own OTP or digital signature. Orelu never files on government portals and never holds portal credentials. | **Decided** |
| D20 | Government templates | Output always targets the **latest official version for the period of the work** of each GST/ITR template or schema, kept in a versioned library that is checked daily against the official download pages (D42). **Every extracted figure is reviewed by staff** before any output is produced. | **Decided** |
| D21 | Existing software | Orelu works **alongside** the firm's tools: it reads the files clients send (including Tally exports in Excel or XML), and produces files that **TaxPower GST** and **KDK Spectrum** import: the official government formats, which are public (TaxPower imports the GSTN Excel templates; KDK Spectrum says it imports Excel in any column layout). No import template is needed from any firm; a firm that prefers its tool's own layout maps it itself on the website (user, 7 Oct 2026). **No live connection to Tally** (user, 30 Sep 2026): not needed. | **Decided by user** |
| D22 | First import of past files | Past files do not have to be uploaded to Orelu. Files still on a disk go through **Orelu's uploader**, which sends them from the browser straight into the firm's drive. Files already in a drive are handed over by moving them into Orelu's folder (OneDrive, Dropbox) (§5.5.1). Old files are optional and are brought in stages, final papers first (§5.16). Orelu shows a preview of where each file will go and moves nothing until the owner approves. Rules place the files from their existing folder names (Work type / Year / Client); AI reads only what the rules cannot place (§5.16). The import is outside the yearly meter once, and its yearly average sets the starting plan (D37). | **Decided** |
| D23 | Self-serve, remote and automatic | **Everything works remotely and self-serve once a firm pays:** activation, setup guide, access policy, mailbox connection, office connection and PC approval, connecting the drive and adding past files, template updates and day-to-day automation. No Orelu person needs to visit or do manual work for a firm; help is optional (chat, call or screen-share, never asking for passwords or one-time codes). **Everything runs from the website; nothing is installed.** **No step of sign-up, setup or daily use may depend on an Orelu person:** whatever a firm supplies is handled on the website (the client list and any import layout are uploaded, the drive is connected, past folders are handed over), and every choice has a default. Samples from Paresh bhai are used once to build and test the product; later firms send nothing (user, 7 Oct 2026). | **Decided by user** |
| D24 | Automatic filing and naming | Every attachment from a client's email is filed automatically into **that client's folder** (Financial year / Client / Work type, changed on 17 Oct 2026) with a consistent name (Client - Document type - Period, with the received date only when another copy exists); uncertain files go to the same client's `To check` folder for one-click confirmation; if the same document arrives again, **both copies are flagged to the team, who choose which to keep**; nothing is overwritten (§5.5.0). Pattern and folder order are editable in Settings. **Documents are saved; the email text itself is not** — the AI assistant replies to it (§5.11) and it stays in the mailbox (D6). | **Decided by user** |
| D25 | Smart reminders | Before every reminder Orelu checks the client's live records and **skips it if the work is done** or asks only for what is still missing. Approved fixed templates are the zero-credit default. A firm may enable AI-written reminders; even then, Orelu reuses an approved template when the facts fit and calls AI only when a personalised draft is needed, with a fact check (§5.2.1, D29). | **Decided by user** |
| D26 | Usage limits | **Everything that costs Orelu money per use is metered and capped by Orelu**, so no firm's usage can create a bill Orelu absorbs: AI credits, the workspace, downloads, system emails, first-import AI, and later WhatsApp and call minutes (§5.14, §5.18, §5.19). Usage warns at 80%, degrades gracefully at 100% (nothing a client sends is lost, nothing fails silently) and never charges beyond a cap the owner has set. | **Decided by user** (1 Oct 2026) |
| D27 | Legal and security | Orelu is built to comply with Indian law from day one: DPDP Act and Rules, IT Act s.43A, CERT-In directions, RBI payment and e-mandate rules (through Razorpay), GST and income-tax, Aadhaar rules, and the ICAI duties of its customers. The compliance register (§8.1) and security controls (§8.2–8.10) must be met before real data; a lawyer reviews the terms, privacy notice and DPA before the pilot. | **Decided by user** (1 Oct 2026) |
| D28 | Cheapest good stack | Orelu is an early, self-funded startup, so every service is the **cheapest option that stays safe for CA data** (user, 1 Oct 2026): Supabase Pro on Micro compute (Small only when measured load needs it), Cloudflare Workers Paid for the app, AWS Lambda (Mumbai) for the file worker, Amazon SES (Mumbai) for system email, AWS KMS for keys, Sentry's free plan, and 6-hourly encrypted database exports instead of the $100 point-in-time add-on. About $34 (≈ ₹3,300) a month fixed, including the .com domain; startup credits applied for. Prices re-checked on the providers' sites before each change. | **Decided by user** (1 Oct 2026) |
| D29 | Deterministic first; no unwanted AI | **AI is the last resolver, not the default reader.** Orelu first uses sender mappings, canonical folders and names, file signatures, exact/normalised checksums, deterministic parsers, prior staff-confirmed mappings, cached OCR and the document index. Scanned pages are OCRed once with a non-generative OCR engine where it passes accuracy tests; the encrypted result and keyed search tokens are reused for the file's retention period. AI runs only for an unresolved classification or extraction that requires it, within the firm's credits. Cache hits, ordinary search, duplicate detection, OCR, deterministic parsing and template filling consume no AI credits. Every AI call records a reason code and source ids; the admin console reports avoidable calls. | **Decided by user** (1 Oct 2026) |
| D30 | Client fee billing | **Not in this launch** (user, 7 Oct 2026). Orelu does not create invoices for the firm's clients, send payment links, record client payments, send receipts or chase fees; the firm keeps billing its clients as it does today. No firm Razorpay account is connected. Orelu's own plan billing through Razorpay (§5.14.1) is unaffected. Listed under After launch (§2). | **Decided by user** |
| D31 | Download and remove a period | **Replaced on 8 Oct 2026 by D36.** The firm's files are already in its own drive, so there is nothing to download from Orelu or to remove to free space. | **Replaced** (8 Oct 2026) |
| D32 | GST on Orelu's own prices | Prices are stored and shown before GST. While Orelu is unregistered (below the ₹20 lakh services threshold, counted across all Orelu products on the same PAN) no GST is charged. One admin setting (GSTIN, state, start date) turns on 18% GST on every invoice from that date. Each firm's GSTIN and state are collected at sign-up. Starting GST later raises every debit by 18%, and Razorpay lets a live subscription's amount be changed only for cards, not for UPI AutoPay or eNACH; so either Orelu registers before its first paid subscription, or billing uses mandates whose maximum amount already includes 18% (§5.14.1). When to register is a business decision kept in the business plan and confirmed with a CA. | **Decided**; timing open |
| D33 | Money-back guarantee | A firm can cancel within **14 days of its first payment** and get its first plan payment back in full, monthly or yearly, from Settings → Billing, with no Orelu person involved. Once per firm. The setup fee is not returned once the first import of past files has started, and used AI top-ups are not returned. Chosen over a free trial because the first debit is what activates a firm (D5, D23) and the first import costs Orelu real AI money. After the 14 days there are no part refunds; cancelling stops the next renewal (§5.14.1). | **Decided by user** (7 Oct 2026) |
| D34 | Minimal data model | Fewer tables and fewer columns, always. One table per real thing; a kind, status or stage is a column; nothing that can be read from another row is stored again; small settings live in one jsonb; who did what and when lives only in the activity log. The only deliberate repeat is `firm_id`, which row-level security needs. The model is 30 tables (§6). | **Decided by user** (7 Oct 2026) |
| D35 | Product name | The product is named **InboxCA**, sold as "InboxCA, a product by Orelu"; Orelu stays the company that builds, bills and supports it. Chosen because it says what the product does (the firm's client inbox, handled), is short, and returned no existing product, with inboxca.com, .in, .co.in and .ai unregistered when checked on 7 Oct 2026. **Applied on 8 Oct 2026 at the user's word:** the client deck is fully renamed and re-coloured to InboxCA, and this file and the business plan carry the naming rule at their top. **Still to do before the name is used in public:** register the domains and run an Indian trademark search; until a domain is held, the deck shows no web address. Brand direction: [InboxCA-Brand-Kit.png](InboxCA-Brand-Kit.png) (navy and white, blue for actions, green only for "done"; mark = a solid navy tile holding a white inbox tray and a green tick, the user's choice; to confirm with a trademark agent that it is far enough from the ICAI "CA" logo, which also pairs blue with a green tick). | **Chosen by user** (7 Oct 2026); registration open |
| D36 | Files live in the firm's own drive | Orelu stores **no client files**. The owner connects the firm's own drive once by signing in; Orelu can touch only the one folder it creates there. OneDrive and Dropbox are built for the launch; Google Drive is left for later (user, 8 Oct 2026: "for now don't do Google Drive"); any other drive whose service lets an app create and edit files in its own folder can be added through the same adapter. **Orelu handles the connection end to end:** the owner chooses the drive and signs in, and never has to look up a setting or a how-to. An owner whose drive is used only for the firm can give Orelu the whole drive on OneDrive or Dropbox, so existing folders are sorted where they are. Orelu builds the client folders, saves every incoming file and every filled form there, and shows files to staff only through its own viewer, so the office lock and view-only rules are unchanged. **Only the owner and Orelu's server can reach the drive;** the owner keeps it signed in only on the owner's own computer. Edits never overwrite; a deleted file waits 30 days in a Deleted folder; and because a drive has no lock against deletion, Orelu also keeps its own locked 30-day copy of anything deleted or changed (taken beforehand when done through Orelu; taken from the drive's bin when done directly in the drive). Orelu keeps only a small **workspace**: client details, the text and figures read from each file, working copies of forms and those safety copies (§5.5.1). Replaces D16, the upload tool of D22, D31 and the file-storage part of D12. | **Decided by user** (8 Oct 2026) |
| D37 | Plans sized by work: workspace and returns a year | With files in the firm's drive, a plan is sized by what Orelu does, measured two ways over a year: the **Orelu workspace** (the client details, text and figures Orelu keeps) and the **returns** in the firm's calendar. The firm's plan is the one that fits the higher of the two; people and AI credits are the other two numbers on the price list, and clients stay unlimited. The allowance is yearly because CA work is seasonal. Running out never blocks work or a filing: the owner gets notice and the firm moves up, pro-rated. The first import is outside the meter once and sets the starting plan; the client list sets the returns figure on day one. A firm outgrowing its plan is shown an upgrade or Switch to Custom prompt on the dashboard and in Settings, with the plan and price worked out automatically. On the price list a CA sees the suggested client number first, then returns, AI allowance and the team size; the workspace is shown under the plain name "InboxCA storage a year". Storage limits, storage blocks and the 36-month limit are gone. The workspace sizes are provisional until one real month of files is measured, and the returns sizes until one real client list is counted (§5.14, §12). | **Decided by user** (8 Oct 2026); sizes provisional |
| D38 | Guards against under-paying | (1) Monthly payers earn the yearly allowance one month at a time; the full year's allowance comes at once only with yearly payment. (2) Each new device signing in to the owner's login is approved on the owner's phone, and use of that login on several PCs alerts the owner. (3) In the first 14 days only the latest three months of past files are imported; the rest follows after the money-back window. (4) The meter counts what was added in the year, not what is held, so deleting does not lower it. (5) The import that is free of the meter happens once, and only for files dated before sign-up. (6) One firm signing up as several small accounts is detected by PAN, GSTIN, mailbox and drive account, and is against the terms (§5.14). | **Decided** (8 Oct 2026) |
| D39 | Portal files drop box | Orelu never logs in to a government portal, so files only the portal can give (GSTR-2B, GSTR-2A, Form 26AS, AIS, TIS, filing acknowledgements, challan receipts) are downloaded by staff as they do today and **dropped into Orelu**. Orelu recognises the file from its own contents, finds the client and the period inside it, saves it in the client's folder in the firm's drive, reads the figures into the draft form and closes the matching 'still missing' item, with no AI. Every employee and manager may add these files as a built-in exception to view-only, because it is the filing work itself; any other file still follows the upload rule (§5.3.1, §5.17.2). | **Decided by user** (8 Oct 2026) |
| D40 | Seven features after launch, built without outside services | After launch Orelu adds seven features that firms ask for and competitors sell: a DSC expiry tracker, a notice register with reply due dates, the owner's morning summary, a UDIN register, a "same as last year" paper checklist, renewal reminders, and due-date-change notices. **Each one runs only on what Orelu already has** (the firm's mailbox, its drive, the portal files drop box and dates the firm enters): no paid data provider, no GST Suvidha Provider tie-up, no e-Return Intermediary registration, no portal passwords or OTPs. Automatic fetching from the government portals is **left out** for that reason. Designed in §5.20; not in the launch build. | **Decided by user** (10 Oct 2026) |
| D41 | Staff sign in under Office only | **Staff on an approved PC on the office connection sign in with their email code only;** the approved PC is the second proof, so the phone code (TOTP) is skipped for them. The phone code stays for the owner, deputies and co-admins (who can open everything from anywhere and approve devices and networks), for anyone signing in off the office connection (an approved remote or personal device), and for every firm on Standard or another preset without the office checks. Each staff login is the person's own address; the firm's connected mailbox can't be a login. The database accepts such a session only with the server-set office claim (§4.4). Built with M7; until then everyone uses the phone code. | **Decided by user** (17 Oct 2026) |
| D42 | Daily check of rules and forms | **Every day Orelu checks the official sources itself** (user, 18 Oct 2026): GST (the GST portal's news and downloads, CBIC notifications), income tax (the e-filing downloads and the department's notifications and circulars), TDS (the TRACES and Protean statement utilities) and MCA forms, plus the public release notes of the filing software firms use (TaxPower GST, KDK Spectrum, TallyPrime exports). Only public pages are read; no portal sign in. A change becomes a draft for the Orelu admin: a new form version, utility or schema is fetched and recorded; a due date change or extension is recorded with its notification. **A new form version goes live by itself** when every field Orelu fills is unchanged and all of its tests pass; otherwise it waits until its mapping is updated and tested, and outputs keep using the last active version meanwhile. **A due date change goes live only after a CA approves it** against the notification, because a wrong date harms a firm; until then the earlier date stands, so reminders can come early but never late. **Old and new forms stay usable together:** every version is kept for the periods it covers, the form is chosen from the period of the work and never from today's date, and when the government publishes a newer version mid season both stay valid for that period, the newer one by default. Firms do nothing; they see which version each output used. | **Decided by user** |

---

## 2. Scope (the launch)

- Everything below ships together.

1. **Firm, teams and branches (§5.9):** firm created automatically when it pays (D5); owner invites staff with roles; teams, client assignment, `open` visibility by default (every employee sees every client) with optional `restricted`, optional branches, client groups and authorised contact persons.
2. **Client register:** clients with PAN, GSTIN(s), contact emails, services taken and client type (individual, business, tax-audit, company). CSV/XLSX import.
3. **Compliance calendar (§5.1):** due dates generated from each client's services, with a tracker to mark items filed.
4. **Email triage (§5.5):** every mail from a registered client or contact is labelled — past-records request, current-records request, notice received, GST data, income-tax data, tax-audit data, other — without storing the text.
5. **Records auto-reply (§5.5.2):** for record requests, Orelu finds the document and replies automatically from the firm's email (password-protected PDF or secure link); sensitive documents wait for one staff approval. A request for a file that is not in the firm's drive folder becomes Needs team reply.
6. **Notice tracker (§5.6):** notice emails raise a dashboard alert with client, authority, notice type and an action date; the notice document is filed to the client.
7. **Automatic filing and document hub (§5.5.0, §5.3, §5.10):** every email attachment is filed automatically into the client's folder (**Financial year / Client / Work type**) with a consistent name; duplicates are flagged to the team; files from the government portals are dropped in by staff and placed by themselves (§5.3.1, D39); uploads are typed (or Other + name) and versioned; collection checklists and secure upload links; the client document vault for sending documents out.
8. **Data extraction and template engine (§5.7):** reads Tally exports, Excel, PDFs, scans, email text and portal files (GSTR-2B, Form 26AS, AIS); staff review figures side by side with the source; fills the official GST and ITR templates (GSTR-1 and GSTR-3B data first, then ITR-1 to ITR-4) and TaxPower / KDK Spectrum import files; a watcher keeps templates current.
9. **Office connection (§5.8, §5.17.3):** with the Office only switch on, staff requests must come from the office's internet connection as Orelu's server sees it; a changed address is confirmed only by a fixed address, the owner's or a deputy's tap, or a trusted fixed PC; Orelu adjusts by itself for each firm; nothing installed.
10. **Prepared forms, approval and acknowledgement (§5.7.4):** every filled form is saved in the client's `Prepared` folder in the firm's drive; staff see it on the dashboard; the owner, or staff the owner allows, adjust figures in Orelu (each change is a new version); the staff yes/no check on every figure approves the form (a second approval by a manager or partner is an optional switch), and staff then download the approved version for filing on the portal or in TaxPower / KDK Spectrum; once the firm files and uploads the acknowledgement, Orelu emails it to the client and closes the task.
11. **Smart reminders (§5.2, §5.2.1):** email reminders for deadlines and pending documents; approved templates by default and AI only when the firm enables it and personalisation is needed; skipped when work is done and limited to what is still missing; partner alerts when overdue.
12. **Client invoices and fees: not in this launch (D30).** The firm keeps billing its clients as it does today; see After launch below.
13. **AI email assistant (§5.11):** answers known clients' routine email questions from live records; anything else goes to the team.
14. **Lead pipeline (§5.12):** explicit enquiries from the website form and email; staff confirm before saving; follow-ups by email.
15. **Protected storage and access (§5.17, §8)** — headline selling point: **"Office only for staff"** (§5.17.3), one switch that keeps staff to approved PCs, the office's internet connection and office hours, view-only, with the owner approving anything more from anywhere: client files in the firm's own drive, reachable only by the owner and Orelu (D36); Orelu's own data encrypted per firm; a locked 30-day safety copy of anything deleted or changed; **firm-set access policies** (office-only, approved remote, remote-friendly, solo), owner-approved deletes, watermarks, audit log.
16. **Plans, usage limits and metering (§5.14, §5.18):** preset plans sized by the work Orelu does, unlimited clients and a Custom plan builder for larger firms; people, workspace, returns and AI-credit measures (D37); 80% / 100% alerts; owner-set caps for AI top-ups; no time limit on history (D36).
17. **Dashboard:** clients, due in 7 days, overdue, pending documents, notices open, Needs team reply queue, drafts awaiting approval, workspace, returns and AI credits used, the owner's upgrade card when the firm is outgrowing its plan (§5.14), recent activity.
18. **Guided connections (§5.13):** onboarding wizard for the mailbox, the Office only switch and office PCs, with a live checklist.
19. **Sign-up and activation (D5, D23):** a public sign-up page collects firm details, the chosen plan and monthly or yearly billing, and sets up Razorpay AutoPay on Orelu's account; the first successful debit's webhook makes the pending firm active and emails the owner an invite; renewals, extra blocks and plan changes are charged automatically, and top-ups are paid before they apply (§5.14.1). A firm can cancel within 14 days of its first payment and get its first plan payment back (D33).
20. **Orelu admin console:** create firms, see health (mailbox and drive connected, failed jobs, workspace, returns and AI usage), open owner-approved time-limited support sessions, all audit-logged.

- **After launch (don't build now):** the seven features in §5.20 (D40: DSC expiry tracker, notice register, morning summary, UDIN register, "same as last year" checklist, renewal reminders, due-date-change notices), AI WhatsApp assistant and AI phone calls as monthly packs (future features, designed in §5.19), client invoices and fee collection (the firm invoicing its clients with payment links, receipts and fee reminders; removed from the launch on 7 Oct 2026, D30), a client portal with logins, direct GST/IT portal integrations, a local-storage option, further drive providers through the same adapter.

- **Out of scope:** filing returns on government portals, bookkeeping, payroll, a mobile app, AI-generated tax advice.

---

## 3. Users and roles

| Role | Who | Can do | Default access policy (§5.17; firm can change) |
|---|---|---|---|
| `owner` (admin) | Senior or managing partner | **Everything:** settings, access policies, devices, permissions, downloads, edits, sends, deletes, exports | Anywhere, anytime, registered devices, 2FA |
| `partner` | Other partners | Like a manager, plus what the owner grants (§5.17.2), typically approving outputs and sensitive sends; a partner named as a deputy approves requests like the owner | Firm preset (Standard by default for a new firm); owner may opt into Office only or approved remote |
| `manager` | Senior staff, team leads | **Same as staff, plus approving:** sees every client, view only, can rename; approves their team's everyday requests once (never their own, never deletes or standing permissions) and, where the firm has switched on second approval, their team's prepared forms; no settings (§5.17.2) | Firm preset |
| `staff` | Accountants, article assistants | **View only by default:** every client's documents and records in Orelu's browser viewer; can rename (correct document type or period), do the yes/no check on extracted figures, mark a form filed with its acknowledgement, and download approved filing files to upload on the portal; any other edit, upload, download, share, link or delete is a request to their manager or the owner (§5.17.2) | Firm preset |
| `front_desk` | Reception or office admin | View only like staff, including every client's documents; team-reply queue and leads; uploads only if granted; no settings | Firm preset |
| `orelu_admin` | Orelu team | Cross-firm admin console; content only in an owner-approved support session | Separate admin path, audit-logged |
| Client or lead | The firm's customer or prospect | **No login.** Email, the enquiry form and tokenised upload / download links | Link rules (§8.6) |

- **Users counted for the plan (§5.14):** every active login, the owner included: owner, partners, managers, staff, front desk, deputies and co-admins. A plan's number is the final size of the team; Solo is the owner alone. Deactivated users, clients and Orelu staff don't count.
- **One login per person.** The terms forbid shared logins; one active session per person and passkeys on each person's own device enforce it (§5.17.4 #39).

---

## 4. Architecture

### 4.1 Stack

| Part | Choice | Notes |
|---|---|---|
| Language | TypeScript, `strict: true` | Everywhere |
| Web app | Next.js (App Router) on **Cloudflare Workers** (Workers Paid, $5 a month) through the OpenNext Cloudflare adapter; Smart Placement runs it close to Supabase Mumbai. Fallback if the adapter causes trouble in M0: Netlify Personal ($9 a month, 1,000 credits) | One app for every firm |
| UI | Tailwind CSS + shadcn/ui, InboxCA tokens (§9.1) | Lucide icons |
| Database | **Supabase Postgres (Mumbai)** | RLS on every tenant table |
| Auth | Supabase Auth, an emailed code or link + TOTP 2FA + passkeys for registered devices | Plus access-policy checks (§4.4) |
| Jobs | One Postgres `jobs` table (scheduled work and sends) and **Supabase Cron** | Idempotent workers; `run_at`; claims with `FOR UPDATE SKIP LOCKED` and a lease; cancellation by entity version |
| Client files | **The firm's own drive**: OneDrive and Dropbox at launch (Google Drive later), others behind one adapter interface | Orelu touches only the folder it creates, with the narrowest own-folder permission; no drive link ever reaches staff (D36) |
| Orelu workspace store | **Backblaze B2**, S3-compatible API, one private bucket | Temporary files in transit (24-hour lifecycle), the encrypted text read from files, locked 30-day safety copies (object lock), database exports; no India region (D12) |
| File worker | **AWS Lambda in Mumbai** (`ap-south-1`), container image; free tier covers normal monthly volume; the M0 spike confirms 2 GB files fit Lambda's limits, otherwise large files use a short-lived container task | Malware scan, conversions, encryption, ZIP extraction, streaming downloads (§5.15) |
| Keys | AWS KMS `ap-south-1` | Wraps per-firm keys; never leaves KMS |
| Firm email | Gmail API, Microsoft Graph, Zoho Mail API, or TLS IMAP/SMTP (§5.13) | Read and send from the firm's own address |
| System email | **Amazon SES in Mumbai** (`ap-south-1`), from Orelu's own domain, $0.10 per 1,000 emails | Invites, sign-in links, staff alerts |
| AI | Provider-neutral adapter, OpenAI by default (D13) | Structured outputs, function tools |
| Validation | zod at every boundary | Forms, webhooks, CSV rows, AI outputs, env |
| Tests | Vitest, Playwright, AI eval suite (§5.11) | |
| Errors and logs | Sentry and structured JSON logs, with redaction | Server only, through a small reporter of our own instead of Sentry's SDK: no browser code, and it sends only an error's type, code frames and route (M0 step 7) |

### 4.2 Repository layout

```
/app                  Next.js routes (App Router)
  /(auth)             sign-in, invite acceptance, device registration
  /(app)              dashboard, clients, calendar, inbox-triage, notices, documents,
                      extraction, outputs, team-replies, leads, settings
  /admin              Orelu admin console
  /u/[token]          public tokenised upload page (no login)
  /d/[token]          public secure download page (one-time code)
  /f/[formKey]        public enquiry form
  /signup             public sign-up, plan choice and Razorpay AutoPay
  /api/jobs           job worker endpoint (called by Supabase Cron)
  /api/webhooks/email/google       Gmail Pub/Sub push
  /api/webhooks/email/microsoft    Graph change notifications
  /api/webhooks/razorpay/orelu      Orelu plan payments (activation, renewals)
  /api/oauth/[provider]/callback
/src
  /db                 typed query helpers, generated Supabase types
  /domain             pure business logic, no I/O:
    compliance/       catalog, due-date rules, calendar generation
    triage/           label rules, routing
    reminders/        stage calculation, pre-send checks and skip reasons, AI drafting + fact check, escalation, quiet hours
    documents/        checklists, folder paths, share policies, retention
    templates/        template versions, mappings, validation rules
    access/           office connection, device and hours checks
    plans/            entitlements, metering, alerts
    leads/            scoring rules, follow-up cadence
  /jobs               job handlers (thin: call /domain, /email, /ai, /drive)
  /email              mailbox adapters: gmail.ts, graph.ts, zoho.ts, imap.ts, fake.ts; email template registry
  /ai                 agent loop, tools, extraction prompts, classifiers, eval fixtures
  /drive              adapters (onedrive.ts, dropbox.ts) behind one interface, workspace store b2.ts (S3 API), encryption streams, worker client
  /integrations       razorpay.ts, taxpower.ts, kdk.ts
  /lib                auth guards, env (zod), logger, crypto
/supabase/migrations  SQL migrations (the only way to change the schema)
/supabase/seed.sql    compliance catalog, document types, template library seed, demo firm
/tests                unit/, integration/ (incl. RLS isolation), e2e/, ai-evals/
/reference            the reel's n8n workflow (read-only)
```

### 4.3 How jobs run

- **One job per entity action.** Creating or rescheduling a compliance task writes a `jobs` row with `run_at`, `entity_type`, `entity_id` and `schedule_version`. Workers claim due jobs atomically (`claim_jobs`: `FOR UPDATE SKIP LOCKED` and a lease; a job whose lease runs out goes back to the queue, or becomes `uncertain` if it had started its outside call), recheck the entity (stop if filed or rescheduled), then write a `send` job in the same transaction.
- **Delivery contract:** transactionally write the domain change and the `send` job row; send with a deterministic idempotency key; states `pending`, `claimed`, `sending`, `done`, `failed`, `uncertain`, `cancelled`. An `uncertain` send (timeout after possible acceptance) is reconciled against the mailbox's Sent folder or provider status before any retry; it is never blindly resent.
- **Cron:** Supabase Cron triggers the due-job sweep every minute while a job is due (it checks the `jobs` table first, so an idle app is never woken), mailbox polling every 2 minutes (IMAP/Zoho), the nightly reconciliation, the daily check of rules and forms (D42), the daily workspace and returns metering, the daily drive check (sharing and outside changes), the daily clean-up of 30-day copies and the daily activity-log retention (step 5).
- **Flow control:** per-firm concurrency limit on workers; per-mailbox send pacing within the provider's daily cap (§5.13).
- **Quiet hours:** client reminders go out 09:00–20:00 IST, spread across the window.

### 4.4 How a request is authorised (access policies)

**Every signed-in request passes, in order:**
1. Valid session and 2FA. The database checks this too: firm data is visible only to a session that has passed the 2 step code (`aal2`), so a session that stopped after the email code sees nothing. **Exception (D41, M7):** a staff member under Office only on an approved PC on the office connection signs in with the email code alone; the server checks the PC's device key and the office connection on that request and sets a short-lived office claim, and `member_role` accepts an email-code session only with that claim. The owner, deputies and co-admins always need the phone code.
2. Role and client scope (RLS).
3. **The user's effective access policy (D17, §5.17):** where (office proof per §5.8 and §5.17.1: the request's IP, from Cloudflare's trusted `CF-Connecting-IP` header, matches a confirmed office address, or the owner allowed that network for today; or anywhere, optionally India-only by IP), which device (an approved device proven by its device key or passkey, marked `stays_in_office`, `laptop` or `personal`), when (the policy's hours and holidays in the firm's timezone) and what (full, view-only or no access when off the office connection). Any failure → sign-out or a reduced mode with a plain message; the attempt is logged and the owner alerted on repeats.
4. Sessions end automatically at the end of allowed hours and after the policy's idle timeout.

- The owner turns on **Staff can use Orelu only in the office** from an office PC and approves the PCs that sign in that day with one tap (§5.17.3); everything else is handled inside Orelu.

### 4.5 How an incoming email flows without storing it

1. A new message from a registered client or contact address arrives (push or poll). Persist only the provider message id, thread id, matched contact id, time and a processing status.
2. In memory: read the body and attachments; label the email (§5.5) with the classifier; route by label.
3. Attachments that belong to the label (data, notices) are scanned, encrypted and filed (§5.3); the body is not stored. Details typed in the body can be extracted into a draft dataset for staff review (§5.7), never saved as text.
4. Record requests get an automatic reply, or a draft for approval when the document is sensitive (§5.5.2); notices create a notice record (§5.6); unclear or off-topic mail creates **Needs team reply**.
5. Store the label, the chosen action and outcome codes only. Staff read the original email in their own mailbox; Orelu offers **Open mailbox** links.

---

## 5. Domain logic

### 5.1 Compliance catalog and due dates

- Due dates are **data, not code constants**.
- Each rule is effective-dated and carries its official source, applicable period, verification date and CA approver; an unverified rule can't generate live reminders.
- `compliance_types` holds the default rule; a row with a period holds a government extension for that period, entered by an Orelu admin and reviewed by a CA.
- **Daily check (D42):** a job at 06:00 India time reads the official notification pages; a new extension or date change is saved as an unverified row with its notification link and shown to the Orelu admin with the number of firms and returns it moves. It moves dates only once a CA verifies it; until then the earlier date stands. A rule is effective dated, so the rules of the Income-tax Act 1961 for years up to FY 2025-26 and of the Income-tax Act 2025 from tax year 2026-27 run side by side, each for its own periods.
- The calendar generator is one SQL function, `private.plan_tasks(registration, today)` (M2 step 1, 17 Oct 2026: in the database rather than a TypeScript function, so the nightly top-up needs no worker): the rule's `due_rule` (which number it sits on, the month after the period and the day, exceptions by month, a day by GSTIN state, the only period months, and services that exclude each other) gives each period's date, and table-driven database tests check it.

**Seed catalog (statutory defaults). Verify every row against current CBIC, CBDT and MCA notifications before launch:**

| Code | Name | Frequency | Default due date |
|---|---|---|---|
| `GSTR1_M` | GSTR-1 (monthly) | Monthly | 11th of next month |
| `GSTR1_Q` | GSTR-1 (QRMP) | Quarterly | 13th of month after quarter |
| `GSTR3B_M` | GSTR-3B (monthly) | Monthly | 20th of next month |
| `GSTR3B_Q` | GSTR-3B (QRMP) | Quarterly | 22nd or 24th of month after quarter (by state) |
| `PMT06` | GST payment (QRMP, months 1 and 2) | Monthly | 25th of next month |
| `CMP08` | CMP-08 (composition) | Quarterly | 18th of month after quarter |
| `GSTR4` | GSTR-4 (composition annual) | Yearly | 30 June following FY (verify extensions) |
| `GSTR9` | GSTR-9 / 9C annual | Yearly | 31 December after FY |
| `TDS_PAY` | TDS/TCS payment | Monthly | 7th of next month (March: 30 April) |
| `TDS_RET` | TDS returns 24Q/26Q | Quarterly | 31 Jul, 31 Oct, 31 Jan, 31 May |
| `ADV_TAX` | Advance tax instalments | Quarterly | 15 Jun, 15 Sep, 15 Dec, 15 Mar |
| `ITR_NA` | ITR (non-audit) | Yearly | 31 July |
| `TAX_AUDIT` | Tax audit report (Form 26 from tax year 2026-27; Forms 3CA/3CB-3CD up to AY 2026-27) | Yearly | 30 September |
| `ITR_AUDIT` | ITR (audit cases) | Yearly | 31 October |
| `AOC4` | ROC AOC-4 | Yearly | 30 days after AGM |
| `MGT7` | ROC MGT-7/7A | Yearly | 60 days after AGM |
| `DIR3KYC` | DIR-3 KYC | Yearly | 30 September |
| `LLP11` | LLP Form 11 | Yearly | 30 May |
| `LLP8` | LLP Form 8 | Yearly | 30 October |

**Rules:**
- Statutory dates are `date` in `Asia/Kolkata`; event, security and session times are UTC `timestamptz`.
- Don't shift dates for weekends or holidays automatically.
- A client's services set the codes; each service sits on a **registration** (the client's PAN or one GSTIN/TAN/CIN/LLPIN, in `client_registrations`). Uniqueness is `(firm_id, registration_id, code, period_key)`.
- Generate 12 months ahead on a rolling basis; never touch tasks already `filed`.
- Status `upcoming` → `in_progress` → `filed`; `overdue` is derived. Filing stores `filed_on`, `filed_by` and the acknowledgement number.

### 5.2 Reminder and follow-up stages (email; each firm can edit them)

| Kind | Stages | Escalation |
|---|---|---|
| Compliance task | T−7, T−3, T−1, T0, T+1, T+3 | T+3 and later: alert the partner |
| Document request | Every 3 days while pending, up to 4 follow-ups | 3rd follow-up: alert the partner |
| Lead | Every 3 days, up to 4 follow-ups | After the 4th with no reply: `cold` |

- No reminders 20:00–09:00 IST. A firm can pause reminders for a client.

#### 5.2.1 Smart reminders (D25)

**Check before every send:** just before a reminder goes out, Orelu re-reads the client's live records and **skips it** if the work is done or in hand:

| Skip or shorten when… | How Orelu knows |
|---|---|
| The task is marked filed, or an acknowledgement for that form and period is in the vault | Compliance task status; filed-document type and period (§5.5.0) |
| Every checklist document for that task has arrived | Checklist items matched by automatic filing |
| The client already sent data for that form and period by email | A `data_gst` / `data_income_tax` / `data_tax_audit` email filed for that client and period |
| Some documents arrived but not all | The reminder lists **only what is still missing** |
| Staff are already handling the client (open team-reply item, recent staff reply) | Team-reply queue; outgoing-mail metadata |
| The firm paused reminders for this client | Client setting |

- Every skip is logged with its reason, so staff see why nobody was chased.
- **One email per client per day (17 Oct 2026, for firms of 1,000 clients):** everything due or missing for a client that day goes in one reminder, never one email per return, sent in the background inside quiet hours and the mailbox's daily limit; staff are not notified of reminders, only of what needs them.

**Templates first; optional AI personalisation** (what is due and when, what has arrived, what is still missing, the upload link; firmer as the date nears). Rules:
- Every date, amount, form name and document name must come from Orelu's records; a check compares the draft against those facts before sending, and anything unverified falls back to the fixed template for that stage.
- No advice, no promises, no invented deadlines; English, Hindi or Gujarati per the client's language.
- Firms choose in Settings: **fixed templates** (default, 0 AI credits) or **AI personalisation**. When AI personalisation is on, a matching approved template is still reused without AI; AI runs only when the facts require a new personalised draft. Fixed templates (English, Hindi, Gujarati) remain the fallback.
- The text is written and sent in memory, never stored (D6); Orelu records the template stage, facts used (by reference) and delivery status.

- **Emails driven by documents and deadlines:** filed acknowledgement → sent to the client automatically (§5.7.4); notice → the reply names the action date (§5.6); client writes in → the reply also mentions anything due soon or missing (§5.11).

### 5.3 Upload first, choose the document type, then confirm

- **Filename is never the document type:** `scan001.pdf`, a phone photo and `final-v2.xlsx` all work without renaming.

1. **Upload** one or many files (or a ZIP), or accept attachments from a labelled email. Store the original filename separately. Block preview and sharing until the malware scan is clean.
2. **Choose the client** (and GSTIN or other registration). Never infer access from a filename.
3. **Choose the document type** from a searchable catalog covering the Indian CA practice areas, or **Other — type document name** (2–120 characters, stored encrypted as `custom_document_name`). Owners, partners and managers may save an Other name as a reusable firm type.
4. **Choose the period** (FY/AY/month/quarter/date or not applicable) and **work type** (GST, income tax, tax audit, statutory audit, ROC, other). Together with year and client these set the **folder path and name** (D24, §5.5.0).
5. **Review and save:** each file shows original name, client, registration, type, period, work type and sharing. AI suggestions are labelled as suggestions; staff choices win. A duplicate is shown beside the existing file and staff choose which to keep (§5.5.0); nothing is overwritten.
6. **Originals are read-only (D18).** Reclassifying creates an audited change; content corrections create a new version. Employees and managers may reclassify (rename) by correcting the document type or period only (§5.17.2); changing the client is a request.

- AI matching is assistance, not a prerequisite: the flow works with AI off.

#### 5.3.1 Portal files drop box (D39)

- **Why:** some files exist only on the government portals and need the client's login and often an OTP. Orelu never holds either (D19), so staff fetch them as they do today. Everything after the download is automatic.
- **Where:** an **Add portal files** box on the dashboard, on each client's page and on the form being prepared. Staff drag in one file or many, for one client or many.
- **Files it takes** (a list in `platform_settings.document_types`, each marked `portal_file`): GSTR-2B and GSTR-2A (JSON or Excel from the GST portal), Form 26AS, AIS and TIS (PDF, JSON or text from the income-tax and TRACES portals), filing acknowledgements (GST ARN, ITR-V) and challan receipts.
- **Recognised from the file's own contents,** never from its name, by fixed signatures (the JSON structure, the sheet layout, the form's printed title and fields). No AI, 0 credits.
- **Client and period are read from inside the file:** the GSTIN and return period, or the PAN and assessment year, matched against `client_registrations`. Staff choose nothing.
- **Then, automatically:** scanned → saved in the client's folder in the firm's drive with the standard name → read by the parser → the figures go into the open draft (GSTR-2B into the input-tax-credit part of GSTR-3B; Form 26AS and AIS into the TDS, tax-paid and income cross-check of the ITR) → the matching "still missing" item closes and its reminder stops. An acknowledgement dropped here follows the Mark filed flow (§5.7.4): staff confirm, and the task closes.
- **What it will not do by itself:** a file that is not on the list, or whose GSTIN or PAN matches no client, is not filed. From an employee it follows the normal upload rule (a request, unless the owner has switched upload on); from a permitted person it goes to `To check`. A password-protected file asks for its password once and never stores it. A duplicate is shown beside the existing file; nothing is overwritten.
- **Each form shows what it still needs:** the form's page lists the portal files that feed it (for example "GSTR-2B for September: not added yet") with the drop target beside it.
- **Who:** every employee and manager by default (§5.17.2), logged in `activity_log` with the person, the PC and the time. The owner can switch it off for a role or a person.
- **No new table or column:** the file is a normal `documents` row with source `upload`.
- Unattended matching of email attachments needs a registered sender, one unambiguous client and period, and a validated confidence threshold; everything else goes to the review inbox.
- Never guess PDF passwords.

- **Requests and checklists:** checklists per compliance type and client type (catalog or Other); a request creates item rows and a random 32-byte upload token (stored hashed, 30-day expiry, scoped to the request).
- A clean, confirmed match marks an item received; staff mark it verified or rejected.

### 5.4 Client invoices and fees (not in this launch)

- Removed from the launch on 7 Oct 2026 (D30): no client invoices, payment links, client payment records, receipts or fee reminders, and no connection to a firm's own Razorpay account.
- The firm keeps billing its clients as it does today.
- Orelu's own plan billing (§5.14.1) is unaffected.
- If it is added later: money as integer paise, GST at 18% on professional fees, invoice numbers per firm per financial year, payment links on the firm's own Razorpay keys, and Orelu never holding funds.

### 5.5 Email triage

**Labels** (Paresh bhai's categories), assigned transiently by a deterministic-first pipeline. It applies registered-sender rules, attachment/file signatures, confirmed per-client patterns and high-precision subject rules first; only unresolved mail is classified in memory by `gpt-5-nano` from the minimum necessary subject, body and attachment names:

| Label | Meaning | Action |
|---|---|---|
| `records_past` | Asking for records from earlier years | Automatic reply (§5.5.2) |
| `records_current` | Asking for current-year records | Automatic reply (§5.5.2) |
| `notice_received` | Only informing the firm of a notice | Notice record + alert (§5.6) |
| `data_gst` | Data for GST filing | Automatic filing (§5.5.0); extraction into a draft dataset (§5.7) |
| `data_income_tax` | Data for income-tax filing | Automatic filing; extraction into a draft dataset |
| `data_tax_audit` | Data for tax audit | Automatic filing; extraction into a draft dataset |
| `other` | Anything else, or low confidence | Needs team reply |

**Rules:**
- Process only mail from registered client/contact addresses (and, if enabled, enquiries to the firm's main address for leads). Skip everything else at metadata level.
- A deterministic or previously confirmed match costs **0 AI credits**. AI is called only when the rule result is unresolved or conflicting; `email_events` records `decision_source` (`rule`, `confirmed_mapping`, `ai`, `staff`) and a reason code.
- Store only the label, confidence band, action taken and outcome codes (D6).
- Staff can correct a label in one click; corrections feed the eval set as labelled examples without storing the email (store the corrected label and a hash only).
- A label below the confidence threshold is always `other` → Needs team reply.

#### 5.5.0 Automatic filing and naming (D24)

- Every attachment in a client's email is filed **automatically** into that client's folder with a consistent name.
- The email text isn't saved: the AI assistant replies to it (§5.11), and it stays in the firm's mailbox (D6).

- **Canonical folder:** `Financial year / Client / Work type / Status`, where `Status` is omitted for confirmed originals and is `To check`, `Prepared` or `Filed` when applicable, e.g. `FY 2026-27 / Patel Textiles / GST`. **Default changed on 17 Oct 2026 (user):** staff never open the drive (only the owner and Orelu reach it, D36), so it is ordered for the owner: one client's whole year in one place, and a year archived or handed over at once; staff get the work-type view inside Orelu. A firm may reorder the first three levels in Settings; Paresh bhai earlier named work type, then year, then client, and confirms his order at setup. Stored records also keep stable ids for firm, client, work type, period and document type, so changing display folders never loses the document or requires rereading it.
- **Canonical name:** `Client - Document type - Period[ - Received date][-vN][-short-id].ext`, e.g. `Patel Textiles - Purchase bills - Sep 2026.pdf`. The client stays in the name because files are downloaded, emailed and uploaded to portals, away from their folder; the received date is added only when another file of the same type and period exists (user, 17 Oct 2026). `vN` is used for an accepted new version; a short stable id is appended only to resolve a collision. Names are Unicode-normalised, path-safe and length-limited; nothing is overwritten. The original filename is kept encrypted in the record. Firms may change the display pattern using approved parts, but stable ids and indexed metadata remain authoritative.
- **Same document again (user rule):** if a new file matches an existing one for the same client (identical content by checksum, or the same document type and period), **both are flagged to the team** in the review inbox, shown side by side. Staff choose: keep the new one as the current version (the old one stays as an earlier version), keep the old one and discard the new, or keep both as separate documents. Until they choose, the new file waits in the client's `To check` folder and automation keeps using the existing one.
- **How it decides:** the sender's registered address gives the client (a contact acting for several clients picks from the email's content, else the review step); the label gives the work type; document type and period come from deterministic parsing (utility files, spreadsheet headers) and the classifier.
- **Confident → filed straight away.** Not sure about type or period → still filed in **that client's folder** under `To check`, with the suggested name, and shown in the review inbox; one click confirms or corrects it (any employee may do this: it is a rename, §5.17.2). Unknown sender → nothing is filed; Needs team reply.
- Password-protected PDFs are filed as they are and flagged; ZIPs are unpacked and each file named separately.
- Every automatic filing is recorded (which email, which rule, which name) and can be undone by staff with the right permission; the original stays read-only (D18).

**Read once, index once, reuse (D29):**
- On first clean acceptance, calculate the raw SHA-256 and a normalised-content fingerprint. Exact duplicates need no OCR, parsing or AI; previously confirmed metadata is reused only within the same firm and client scope.
- Parse text PDFs, Excel, CSV, XML, Office files and supported utility files deterministically. For image-only pages, run a non-generative OCR engine once. OCR language packs cover English first and tested Hindi/Gujarati documents when quality is sufficient; low-confidence pages go to review or AI only with an explicit reason.
- Store the OCR/text artifact encrypted, tied to the document version and deleted with it. Store only keyed search-token hashes and non-sensitive routing metadata in the database index; never put extracted text in logs, analytics or plaintext search indexes.
- Search narrows by firm, authorised clients, work type, period, document type, status and keyed tokens before opening an encrypted artifact. It never scans or sends every document to an AI model for an ordinary lookup.
- A confirmed correction updates the client's reusable mapping. A new document version is parsed only where its checksum or page fingerprint changed.
- OCR and deterministic parsing are compute operations, not AI-credit actions. Meter their infrastructure cost separately so repeated work and runaway OCR jobs are still capped.

#### 5.5.1 Files in the firm's own drive (D36)

- **Orelu stores no client files.** Every file a client sends, and every form Orelu fills, is saved in the firm's own drive, inside one folder that Orelu creates and organises.
- **Connecting (the owner, once):** Settings → Drive → Connect. The owner signs in to the drive provider and approves; Orelu never sees a password. Orelu asks for the narrowest permission the provider offers: only the files and folders Orelu itself creates or the owner hands over. The token is stored encrypted in `connected_accounts`.
- **Which drives:** one adapter interface (create folder, save, read, move, rename, list changes, read sharing). OneDrive and Dropbox are built for the launch. **Google Drive is not in the launch** (user, 8 Oct 2026). Any other drive whose service lets an app create and edit files in its own folder is added behind the same interface. The M0 spike confirms the narrow permission on each account type (personal and business) before that type is offered.
- **What each drive allows (from the providers' own documentation, read on 8 Oct 2026; the M0 check still tests it):**
  - **OneDrive, home and work or school accounts:** the app-folder permission (`Files.ReadWrite.AppFolder`) gives Orelu one folder, `Apps/InboxCA`, and nothing else. Any file the owner puts into that folder becomes reachable by Orelu, so old folders are handed over by moving them in.
  - **Dropbox:** the "App folder" access type gives Orelu read and write access to one folder, `Apps/InboxCA`, and nothing else; files the owner moves into it become reachable, as on OneDrive (Dropbox developer guide, read on 8 Oct 2026).
  - **Inside its folder, on OneDrive and Dropbox, Orelu can do everything:** create folders, save, read, rename, move and delete, including files the owner put there. Outside that folder it can do nothing.
  - **Two approvals Orelu itself needs before firms can connect (both free, both human tasks, §13.2):** Microsoft **publisher verification**, without which people on a work account are warned off or cannot approve the app (it needs a verified Microsoft partner account and Orelu's own domain); and Dropbox **production approval**, which must be granted within two weeks of the 50th linked account.
  - **Why Google Drive waits:** its narrow permission (`drive.file`) covers only files Orelu creates and files the owner picks one by one, not the contents of a folder, and whole-drive access needs a security assessment by an approved lab every year. It can be added later behind the same adapter, either with the narrow permission and Orelu's uploader, or after the assessment (§12).
- **One level of access: the whole drive, acting only on what the owner ticks (user, 17 Oct 2026: "the firm will use this drive only for firm documents"; replaces the two levels of 8 Oct 2026):**
  - Orelu asks for the whole drive (`Files.ReadWrite` on OneDrive, "Full Dropbox" on Dropbox). Neither needs a yearly audit. Orelu lists the drive's top folders, the owner ticks the ones that hold client files, and Orelu sorts those where they are after the usual preview; old files are never moved by hand into an app folder.
  - **Orelu acts only on what the owner ticked** and on its own `InboxCA` folder tree, where new files go; it never opens, moves or renames anything else, and every action is in the activity log.
  - **Said plainly on the Connect screen before the owner agrees:** Orelu can technically read this whole drive account, so connect a drive kept for the firm.
  - One app per provider. The narrow app-folder permission above stays a later option, behind the same interface, if firms ask for it.
  - The level is kept in `connected_accounts.settings`; no new column.
- **The owner's steps, and the consent he ticks (user, 8 Oct 2026):** Orelu needs this access to read files, fill forms, and make and change folders, so the owner must see exactly what he is allowing and agree to it before any access is asked for.
  1. **Choose the drive:** OneDrive or Dropbox.
  2. **Read the one line about access:** Orelu can read this whole drive and touches only the folders you choose, so connect a drive kept for the firm.
  3. **Read "What you are allowing Orelu to do"** on one screen, in plain words:
     - read the files in the folders you choose, and every file Orelu saves;
     - make folders, and rename and move folders and files to keep them in order;
     - save new files from client emails, and the forms it fills;
     - read figures from your files to fill GST and income-tax forms for your team to check;
     - Orelu will **not** delete a file without your approval, share anything outside your firm, open folders you did not choose, or use your files to train AI;
     - you can take this access back at any time in Settings → Drive, or at your drive provider.
  4. **Tick the box:** "I have read this and I agree, on behalf of my firm, to the Drive access terms." The box is not pre-ticked, links to the Terms, the Privacy Notice and the DPA, and Connect stays disabled until it is ticked.
  5. **Sign in on the provider's own screen and press Allow.**
  6. **Choose the folders** that hold client files; this can be skipped and done later.
  7. **Approve the preview** of where files will go. Nothing moves before this.
  8. **See the result:** a tick for each thing Orelu set up, and a "what Orelu can now do" summary that stays in Settings → Drive.
  - **The consent is recorded:** `activity_log` gets a `drive_consent` entry with the owner, the time, the PC, the access level and the version of the Drive access terms. If those terms change in a way that widens what Orelu does, the owner is asked to tick again before Orelu uses the wider access.
  - **Only the owner can do this,** signed in with 2-step login; a deputy or manager cannot connect or widen a drive.
  - **The Drive access terms are a named section of Orelu's Terms** (§8.1): what Orelu may do, what it will not do, that the firm stays the owner of its files, that the firm is responsible for its drive account and its provider's charges, the limits stated in this section, and how access ends.
- **Orelu does it end to end; the owner never has to search for how (user, 8 Oct 2026):**
  - **Short and guided:** the eight steps above take a few minutes; each screen has one thing to do and says it in one sentence. Nothing has to be looked up.
  - **Orelu then does the rest by itself** and shows a tick for each: makes its folder, builds the client folders, saves and reads back a test file, checks the folder is shared with nobody, checks the free space, and switches on change notices.
  - **Whenever the owner must do something, Orelu shows one sentence and one button** that opens the exact page at the provider. It never says "go to your settings and find…". Cases covered: a work account that needs its administrator's approval (a ready link to send or press); too little free space (the size needed for a year, worked out from the firm's own files, with a link to the provider's upgrade page); 2-step sign-in advice (a link to the provider's page for it); the connection lost (one Reconnect button).
  - **No drive yet:** the Connect screen shows the three providers, the size this firm needs and a link to each sign-up page. Orelu cannot create or pay for the account, because it never holds the owner's password.
  - **Old files:** one "Add old files" screen (§5.16). Folders already in the drive are ticked and sorted where they are. Folders on a hard disk are dragged into Orelu's uploader, or sent with the drive's own desktop app; Orelu notices the files as they arrive and shows progress.
  - **Kept inside each provider's limits without the owner knowing:** file and folder names avoid characters a provider refuses and stay within its path length; uploads are paced inside its daily limits.
  - **Free space is watched:** Orelu warns the owner when less than about a year of the firm's files is left, with the same one-button link.
- **Who can reach the drive:** the owner, and Orelu's server. The folder is shared with nobody. Staff and managers never get a drive link; every view and download is fetched by Orelu's file worker after the access check (§4.4), so the office lock, view-only, the watermark and the log all apply exactly as before.
- **Shown at Connect, in plain words:** turn on 2-step sign-in for the drive account; keep the drive signed in only on your own computer; do not run the drive's sync app on a shared PC; lock your screen when you step away.
- **How a new file is saved:** it arrives → held in Orelu's temporary store → scanned → read (rules first, AI only if needed, §5.5.0) → saved to the right client folder in the drive with its clear name → the temporary copy is deleted. If the drive cannot be reached, the file waits in the temporary store for up to 7 days with retries and the owner is alerted; nothing is dropped silently.
- **Edits:** an original is never overwritten. A correction is saved as a new file; the previous version moves to the **Deleted and old versions** folder for 30 days.
- **Deletes:** the owner approves (§5.17.2) → the file moves to **Deleted and old versions** for 30 days → Orelu then sends it to the drive's own bin.
- **Orelu's safety copy:** a drive has no lock against deletion, so Orelu keeps its own copy for 30 days in its workspace store, under object lock. For a delete or an edit made through Orelu, the copy is taken before the file is touched. For a file deleted or changed directly in the drive, Orelu takes the copy from the drive's bin or version history as soon as it sees the change; the owner can then restore it even after the drive's bin is emptied. **Limit:** if someone deletes a file in the drive and empties the bin before Orelu sees it, the file is gone; Orelu can then show only its name, client, text and figures.
- **Watching the drive** (daily, and on the provider's change notices): if the folder is shared with anyone but the owner, the owner is alerted at once with a one-click "make private again"; a file renamed, moved or removed directly in the drive is matched by its file id, marked **changed outside Orelu** or **missing from drive**, and shown to the owner, never silently dropped from the index.
- **If the connection breaks** (password change, access withdrawn, provider outage): filing pauses, new files wait in the temporary store, staff see "drive not connected", and the owner gets a reconnect link. Nothing already in the drive is affected.
- **What Orelu keeps (the workspace):** client details and records; the text and figures read from each file, with search tokens; working copies of forms until they are approved; temporary files in transit; the 30-day safety copies; the activity log. Text and figures stay encrypted with the firm's key (§8.4).
- **History has no time limit.** Nothing leaves after 36 months; Orelu works on every file in its folder. A request for a file that is not there becomes **Needs team reply** with reason `not_in_drive`.
- **Stated plainly to every firm:** the owner's drive account is now part of the firm's security; what the owner does directly in the drive is not in Orelu's activity log; client files are backed up by the drive provider, not by Orelu.
- **Leaving Orelu:** the files are already the firm's. Orelu disconnects, the owner can download the client list, records and logs for 30 days, then Orelu deletes its workspace with notice.

#### 5.5.2 Records auto-reply

1. The assistant uses `find_client_documents` (§5.11) scoped to the verified sender's clients.
2. One clear match with share policy `auto` → Orelu **replies automatically** from the firm's mailbox to the verified sender, with the document as a **password-protected PDF** (firm-approved method) or a **secure link** (§8.6) for non-PDF or large files. This follows Paresh bhai's notes ("automated reply") and D23.
3. Share policy `approval` (financial statements, audit reports, identity and bank documents) → a draft waits for **one staff approval**. A firm can switch to "approve every record reply" in Settings.
4. No match, several matches, or an `internal` document → Needs team reply.
5. **Status questions** (is it filed, what is still pending, when is it due) are answered automatically from the database (§5.11); no approval is needed, because no document leaves.
6. **Plain names, used in the product and in the deck:** share policy `auto` is a **routine paper**, `approval` is a **private paper**. Defaults: routine = ITR acknowledgements (ITR-V), filed returns, challans and certificates the firm marked routine; private = financial statements, audit reports, identity documents (PAN, Aadhaar) and bank documents. The owner moves any type of paper between the two lists in Settings, or sets every paper to automatic or every paper to wait for approval.
7. **Who can receive:** a paper goes only to a contact the firm has marked as allowed to receive that client's documents (`contact_clients.can_receive_documents`). The client never gets a link into the firm's drive; a link is always Orelu's own, expires, and opens with a one-time code (§8.6).
8. **End to end means:** Orelu reads the request, finds the answer in the database or the paper in the firm's drive, sends the reply from the firm's mailbox and logs it. Only what is not found, unclear, private or outside firm matters reaches the team.

### 5.6 Notice tracker

- A `notice_received` email creates a `tasks` row of kind `notice`: client, authority (Income Tax, GST, MCA, other), notice type (from a catalog, or Other + name), reference number, date received, **action date** (only when found and verified from the notice) and status (`open`, `in_progress`, `replied`, `closed`). If no action date can be verified, `action_date` stays empty and Orelu creates a prominent **Review deadline** task using the firm's configurable internal target (default 1 business day). The internal target is never shown as the legal deadline.
- The notice attachment is filed as a document (work type from the authority).
- The dashboard shows open notices sorted by action date; overdue notices alert the partner-in-charge.
- Staff can also create notices by hand.

### 5.7 Data extraction and government templates

#### 5.7.1 Inputs

| Input | How it is read |
|---|---|
| Tally exports | Excel or XML files exported from Tally and sent by the client or uploaded by staff; parsed deterministically |
| Excel / CSV | Parsed deterministically; column mapping remembered per client |
| PDF with text | Deterministic text/table extraction and remembered mappings first; AI structures only unresolved fields |
| Scans and photos | One-time OCR first; deterministic mappings next; AI vision only for low-confidence fields that cannot otherwise be resolved (transient, D13) |
| Portal files dropped in by staff (§5.3.1) | GSTR-2B and GSTR-2A (JSON, Excel), Form 26AS, AIS and TIS (PDF, JSON, text): fixed parsers for the government's own layouts, versioned like templates; no AI |
| Details typed in an email | Deterministic field rules first, then minimum-necessary AI only if unresolved; structured fields may be saved encrypted under §8.0, but the email text itself is not stored |

#### 5.7.2 Review

- The deterministic extraction pipeline starts automatically when a data email is filed and on demand from the client page. It reuses cached OCR, parsers and confirmed mappings. An AI step starts only for unresolved fields, after reserving credits and recording its reason (D29, §5.18).
- Every extraction produces a **draft dataset** (encrypted fields) linked to its source documents. The review screen shows each figure beside its source page or cell; staff confirm or reject each line (the yes/no check, allowed for every employee, §5.17.2); correcting a figure needs the edit right or a request.
- Totals are cross-checked (invoice sums vs register totals, tax maths); mismatches block confirmation.
- Nothing downstream uses unconfirmed data.

#### 5.7.3 Template library and outputs

- `templates`: form code (e.g. `GSTR1`, `GSTR3B`, `ITR1`…`ITR4`, later `ITR5/6` and `FORM26`, the tax-audit report), version, assessment year or period, official source URL, file hash, effective dates, validation rules, status (`draft`, `active`, `retired`).
- `templates.mappings`: how confirmed dataset fields map into each version (sheet/column or JSON path), with unit tests per version.
- **Outputs:** the official GSTR-1 Excel workbook (and its JSON via the official offline tool path) and ITR JSON matching the official schema; the same official files serve as **import files for TaxPower GST and KDK Spectrum** (TaxPower imports the GSTN Excel templates; KDK Spectrum imports Excel in any column layout), or a layout the firm mapped itself in the setup guide (§5.13). The official formats come from the government download pages, not from a firm.
- **Order of work:** GSTR-1 and GSTR-3B data first (GST is most of Paresh bhai's volume), then ITR-1 to ITR-4; ITR-5/6 later.
- **Tax audit:** from launch, tax-audit emails are sorted, filed and read into draft data like the rest. The report itself is built for the new **Form 26**, which replaces Forms 3CA, 3CB and 3CD from tax year 2026-27 under the Income-tax Act 2025 (55 clauses; first due 30 Sep 2027), once the official utility and schema are published and well before that season. Firms will still do old-period work on Forms 3CA/3CB-3CD (late, revised or rectified audits for years up to FY 2025-26), so both are supported when the tax-audit report is built (user, 7 Oct 2026; confirm the form details with Paresh bhai).
- **Old and new forms side by side:** the library keeps every version by form and period. Orelu picks the form from the **period of the work** (assessment year or tax year), never from today's date, so a late or revised filing for an earlier year uses that year's form while current work uses the new one. Staff can change the form for a client and period, with a reason code. This covers the move to the Income-tax Act 2025 (new forms from tax year 2026-27) for ITR and tax audit alike; a retired version stays usable for its own periods.
- **Watcher (D42):** a daily job fetches the official download pages (Income Tax Department downloads and schemas, the GST returns offline tool and Excel templates, the TDS statement utilities, MCA forms) and the public release notes of TaxPower GST, KDK Spectrum and TallyPrime, compares published versions and file hashes, and records a new version as a `draft` template with its source and hash. A version whose fields Orelu fills are unchanged, and which passes every test of the version before it, is activated by itself and the admin is told; any other change alerts the admin, and outputs keep using the last active version until the new mapping passes its tests. A page that cannot be read two days running alerts the admin, since the page has probably moved. The page hashes live in `platform_settings.watch`, so the watcher needs no table of its own. Firms see which version each output used.
- **Two versions for one period:** when the government publishes a newer version mid season (a schema v1.1 after v1.0), both stay active for that period; Orelu uses the newer one and staff may pick the older one with a reason code, for example when the filing software has not caught up yet. Past examples: for AY 2026-27 the ITR-2 schema moved to v1.1 on 30 Jun 2026, the ITR-5 utility came out on 7 Jul 2026 and ITR-6 on 4 Aug 2026.

#### 5.7.4 Prepared forms: review, approve, download, file

- Every filled form (official GST / ITR file or TaxPower GST / KDK Spectrum import file) is **saved as a document in the client's folder** in the firm's drive (kilobytes to a few MB); Orelu keeps only a working copy until the form is approved.

- **Where and name:** `Work type / FY / Client / Prepared`, named "Client - Form - Period - v2" (e.g. "Mehta Textiles - GSTR-1 - Sep 2026 - v2.json"). Status is shown beside it: Draft, Approved, Filed or Rejected.
- **See it on the dashboard:** a "Forms to review" list per firm and per client. Opening a form shows it in the browser (sheet or form view) with every figure beside its source page or cell and the template version used.
- **Adjust it in Orelu, not in the file:** the owner, or staff with the owner's edit permission (§5.17.2), change a figure on the review screen with a reason (other staff tap Request edit, which goes to their manager or the owner, §5.17.2); Orelu regenerates the file as the **next version** and re-runs the checks (totals, tax maths, official schema). Hand-editing a JSON or Excel file breaks the link to the sources and can fail the portal's schema, so it is the fallback only: staff may upload a file they corrected elsewhere, which is saved as a new version marked "edited outside Orelu", checked against the schema, and needs approval like any other.
- **Every version is kept** in the firm's drive (read-only, D18), so the firm can show what changed, who changed it and who approved it.
- **Approve:** a prepared form is **approved once every figure in it has passed the yes/no check** (§5.7.2), which any employee may do; the form is only ever generated from confirmed figures. A firm can switch on **Second approval** (off by default): the owner, a partner, or the manager of the team that prepared it then approves or rejects with a reason code before the form can be downloaded (§5.17.2). Any change after approval creates a new version and **clears the approval**. A solo CA or an owner may approve their own work; other firms can require a second person.
- **Download for filing:** every employee can download the approved version (checked, and second-approved where the firm requires it) as the file to upload on the government portal or import into the filing software; only that version can be downloaded; drafts can be viewed in the browser but not downloaded for filing. Filing files carry no visible watermark (it would break the upload); each download is logged in `activity_log` instead.
- **File (by the firm):** staff upload it to the government portal, or import it into TaxPower GST / KDK Spectrum / the official utility, and **file with the firm's own OTP or digital signature** (D19). Orelu never logs in to a government portal.
- **Mark filed:** staff upload the acknowledgement or enter its number (allowed for every employee, §5.17.2). If the portal's confirmation reaches the firm's mailbox, Orelu files it and matches it to the form (client, form, period) and asks staff to confirm. The form becomes Filed, the compliance task closes and its reminders stop (§5.2.1).
- **Tell the client:** Orelu emails the acknowledgement to the client from the firm's mailbox (subject to the share policy) and logs it in `shares`.

### 5.8 Office connection (website only)

- **What it is:** the office's public internet address as Orelu's server sees it (Cloudflare's trusted `CF-Connecting-IP`). Nothing is installed, and nothing a PC reports about itself (battery, location, device type) is trusted.
- **Both address families:** IPv4 is matched exactly, IPv6 by prefix (/56, falling back to /64). At sign-in the page calls one IPv4-only and one IPv6-only Orelu hostname, so the server sees both for that PC. An office line is stored as a pair (IPv4, IPv6 prefix); a firm may have several lines. A PC that has shown the office's IPv6 prefix before must show it again; a PC that has never had IPv6 is checked on IPv4 only (M0 spike).
- **How it starts:** the owner turns the switch on and answers "Are you in your office right now?" Yes: that request's connection is the first confirmed office connection (the owner's action is the approval). No: the first connection is confirmed by the owner's first "Yes, this is my office" tap from the office.
- **A new or changed address becomes an office address only through one of these:**
  1. **A fixed address.** The firm has a static IP; the owner taps **Done** from an office PC and Orelu records that request's address as fixed. The owner never types an address.
  2. **The owner's or a deputy's tap.** "Is this your office? Yes, this is my office / No". A deputy who is the first person in can confirm on the sign-in screen.
  3. **A trusted fixed PC.** A PC the owner approved as **Stays in the office**, holding a device-bound passkey (§5.17), proves itself from the new address; the address is accepted and the owner is told "Your office internet connection changed today (first seen on Reception PC)" with **Not my office**, which removes the address, ends every session on it and removes that PC's mark.
  4. **Continuity of one family.** When an approved PC's sign-in shows a confirmed IPv6 prefix with a new IPv4 (or the reverse), Orelu learns the new half by itself; if both changed, rules 1 to 3 apply.
- **Never:** a laptop, a personal device, provider and city, or any number of movable PCs agreeing. Two laptops taken somewhere together cannot create a new office.
- **Until confirmed:** staff requests from that connection are refused with a plain message ("Waiting for your firm to confirm the office internet connection"). There is no unconfirmed session, however short.
- **Other connections inside the office** (phone hotspot, backup line): the owner or a deputy taps **Allow this network today**; it lapses at closing time.
- **Housekeeping:** a confirmed non-fixed address not seen from any approved PC for 7 days is dropped. If office PCs start arriving from an address other than the fixed one, Orelu treats it as a change (rules 2 and 3) and tells the owner the fixed address seems to have changed.
- **Self-adjusting for every firm (no manual measurement by Orelu):** how often an office's address changes differs by provider and is unknown in advance, so Orelu records every firm's connection changes and who had to confirm them (in `activity_log`) and reacts by itself.
  - After 3 confirmation taps in 14 days, or when the firm has no trusted fixed PC, the owner gets one plain suggestion: "To stop these morning confirmations, ask your internet provider for a fixed address. Here is what to say", with **Done** and **My provider doesn't offer it** (Orelu then suggests marking one desktop as staying in the office and naming deputies).
  - Thresholds are admin configuration; the admin console shows changes and taps per firm and per provider so the defaults can be tuned for all firms.
- **Stated limit:** broadband providers share public IPv4 addresses among customers (CGNAT), so an approved PC on a nearby connection of the same provider can occasionally match the office's IPv4. The IPv6 rule above removes this where the office line has IPv6; a fixed address removes it everywhere. Orelu says so plainly.
- **Not in the launch build:** the `/beacon` page, the same-Wi-Fi (WebRTC) check, the rotating office code and the map geofence. Reasons: Chrome is putting local-network connections behind a permission prompt, signals reported by a PC can be faked, and each added a failure path for the first person in.

### 5.9 Firms of every size: teams, roles, branches, client groups

| Firm shape | How it typically works | What the product must do |
|---|---|---|
| Solo practitioner | One CA, a few staff; mostly individuals and small businesses | Near-zero setup, sensible defaults |
| Small firm | 2–3 partners, desks by work type | Assign clients and tasks; "my work" views |
| Mid-size firm | Partners, managers, departments, sometimes 2–3 offices | Teams, restricted visibility, branch filters, approvals |
| Large, multi-branch firm | Several cities, many corporate and audit clients | Branches with their own office connections and PCs, strict permissions, full audit trail |

- **Build:** roles (§3); teams; client assignment (partner-in-charge, manager, staff or team); `open` (default: every employee sees every client) / `restricted` (optional, set by the owner) visibility via one SQL function `can_access_client(client_id)`; optional branches (own office connections and PCs); client groups (family, business group); contact persons with per-client permissions (view status, receive documents); workload views; bulk actions.

### 5.10 Client document vault (firm → client)

- The firm keeps documents it produces or files for clients: ITR-V and computations, GST returns and challans, TDS returns and certificates, financial statements, audit reports, ROC filings, CA certificates, registrations, working papers (internal).
- Each document has client, category, work type, period, title, file, version, uploader, date and a **share policy**: `auto` (sent on a verified request), `approval` (owner/partner/manager approves first), `internal` (never sent).
- **Out:** on a client's email request (§5.5.2), from the client page, or in bulk (e.g. every ITR acknowledgement after the season), always to a **verified recipient** (registered client email or authorised contact).
- A request from an unregistered address gets a polite refusal and a staff alert; nothing is sent.
- Every send is recorded in `shares`.

### 5.11 AI email assistant

- **Where:** known clients' inbound email, after triage.
- **How:** provider-neutral tool loop (OpenAI `gpt-5-mini`), at most 4 tool calls per turn; firm, contact and client ids injected server-side. Tools return typed outcomes (`found`, `not_found`, `ambiguous`, `stale`, `forbidden`, `unavailable`, `not_in_drive`):
  - `get_client_overview()`, `get_task_status(code, period?)`, `list_pending_documents()`, `list_upcoming_deadlines(days=30)`
  - `get_upload_link()`
  - `find_client_documents(query?, typeId?, period?, subjectId?)` incl. custom names and aliases (D10)
  - `send_document(documentId)` → sends an `auto` document to the verified sender, or creates an approval draft for an `approval` document (§5.5.2)
  - `select_client(clientId)`, `handoff_to_staff(reason_code, missing_field_codes?)`
- **Deadline-aware replies:** after answering, the reply adds a short line on anything due in the next 30 days or still missing for this client (from `list_upcoming_deadlines` and `list_pending_documents`), and that counts as the next scheduled reminder, so the client is not chased twice (§5.2.1).
- **Rules:** answer only from tool results; no tax, legal or investment advice, estimates or promises; reply in the client's language (English, Hindi, Gujarati, Hinglish); hand off on complaints, advice, any fee or payment question, low confidence, missing data or unavailable tools. Documents go out only under their share policy (§5.10).
- **Needs team reply (D8):** on `not_found`, `ambiguous`, `stale`, `unavailable`, `not_in_drive`, or missing fields, create one `requests` item of kind `team_reply` (deduplicated per thread), pause AI on that thread until staff resolve it, and send the client one acknowledgement: "I couldn't find that in our records. I've asked the team to check and reply." Store no question text or summary.
- **Guardrails (D9):** intent allowlist before the agent loop; off-topic mail gets one boundary line and a team item; per-contact and per-firm rate limits; output check that every business fact came from a tool.
- **Eval suite** (`/tests/ai-evals`): at least 60 scripted cases (status questions, record requests, requests for a file that is not in the drive, notices, advice requests that must be handed off, prompt injection in text, file or custom label, mixed Hindi/Gujarati/English). 100% on handoff and privacy cases before launch.

### 5.12 Lead pipeline

- **Sources:** the hosted/embeddable enquiry form (`/f/[formKey]`, honeypot, rate limit, allowed origins) and, if enabled, enquiries to the firm's main address.
- The AI proposes structured fields (service, entity type, urgency, score); **staff confirm** before anything is saved (D6). Board: New → Qualifying → Proposal → Won / Lost / Cold; Won converts to a client. Follow-ups by email (§5.2).

### 5.13 Guided connections

- **Self-serve (D23):** the firm completes every step alone; each step checks itself and shows a live checklist; help is optional.
- **Nothing needs an Orelu person:** each step validates itself and says in plain words what to fix; every choice has a default; a step that can't be finished never blocks the others.
- **Client list:** CSV/XLSX upload with a column-matching screen, a row-by-row error report and re-upload of only the failed rows.
- **Forms and import files:** the official GST and ITR formats are built in from the government download pages, and both TaxPower GST and KDK Spectrum import them, so no template is needed from the firm. A firm that prefers its tool's own layout uploads one sample file on the website; Orelu proposes the column mapping and the owner confirms it. The setup guide ends with one **test import** in the firm's own tool.
- **Help:** short guides beside every step and the live checklist; chat, call or screen-share only if the firm asks, never for passwords or one-time codes.

- **Wizard order:** 1) firm profile → 2) access policy preset, office connection and PCs → 3) import clients → 4) connect mailbox → 5) connect the drive and add past files (§5.16) → done; step 5 can wait.

- **Access policy, office connection and PCs:** the owner picks a preset (§5.17) and adjusts it, turns on **Staff can use Orelu only in the office** from an office PC if wanted (§5.17.3); the PCs staff sign in on that day are approved with one owner tap; the owner's own phone and laptop are added by QR code; deputies are named; branches do the same.

**Mailbox:**

| Provider | Connect | Receive | Send |
|---|---|---|---|
| Gmail / Google Workspace | TLS IMAP/SMTP with an app password until Google OAuth verification (and CASA) is complete; then OAuth | IMAP polling every 2 minutes, later Gmail push | SMTP / Gmail API from the firm's address |
| Outlook / Microsoft 365 | OAuth with the **firm admin's consent** (password IMAP/SMTP is being retired by Microsoft) | Graph change notifications | Graph `sendMail` |
| Zoho Mail | OAuth or TLS IMAP/SMTP | API or IMAP polling | API or SMTP |
| Other (own domain) | TLS IMAP/SMTP, settings auto-detected from the domain | IMAP polling | SMTP |

- After connecting, `mailbox.connected` runs: test send and receive, start polling/watch, **no history backfill**, match only firm-entered contacts, mark done.
- Tokens refresh automatically; a revoked token shows a reconnect banner and alerts the owner.
- Gmail caps: about 500 recipients a day (personal) and 2,000 (Workspace); bulk sends are paced per mailbox and spread over days.


### 5.14 Plans, pricing formula, entitlements and limits (D5, D26)

- **Sized by the work Orelu does; clients are unlimited (D37).** Client files live in the firm's own drive (D36), so storage does not size a plan. AI is what costs Orelu money, so it is the only hard stop. A plan has four numbers: people, Orelu workspace a year, returns a year and AI credits a month. `platform_settings.plan_formula` (versioned, edited only in the admin console; values come from the business plan) holds: each preset's price, people included, workspace a year, returns a year and AI credits a month; the extra-person price; the Custom rule (the Enterprise point, the people slabs and the work slabs with their rates, how many returns equal one GB of workspace, the AI credits per unit of work above Enterprise, the minimum-margin guard and the rounding rule); the extra-AI-credit block (size, price) and the block caps per plan; the workspace counting rule; the setup rule (setup credits = one month of the plan's AI credits; fee = (AI cost + payment fee) × (1 + margin)); months charged for a yearly plan; add-on prices.
  - **Two measures of work, each over the firm's year:**
    - **Orelu workspace:** what Orelu keeps for the firm, counted in GB added during the year. It counts client details and records, and the text and figures read from files. It does not count temporary files in transit, working copies of forms, the 30-day safety copies or the activity log. The counting rule is written in `plan_formula` and versioned, so a change in how Orelu stores things never moves a firm between plans.
    - **Returns:** every return in the firm's compliance calendar for the year (§5.1), one for each registration, form and period, whether Orelu fills the form or only tracks and reminds. It is known the day the client list is imported.
  - **The plan is the one that fits the higher of the two.** A firm with few heavy clients is caught by the workspace; a firm with many light clients is caught by the returns. Head-count never lowers the price.
  - **How a plan is shown to a CA (user, 8 Oct 2026):**
    - **Headline:** the suggested client number ("suits about N clients"), a guide and never a limit; clients stay unlimited.
    - **Then:** returns a year, InboxCA storage a year, AI allowance a month, and people as "your whole team, you included, up to N"; Solo shows "just you".
    - **The workspace is shown as "InboxCA storage a year", in GB** (user, 8 Oct 2026: first asked to hide it, then to show storage in the plan). It is on the price list, the pricing page cards and the deck, with one plain line beside it: the firm's files stay in its own drive; InboxCA storage holds the client list, records and what Orelu reads from the files; a new file waits there only until its folder is made in the drive, and that wait is not counted. "Workspace" stays the internal name in this plan and in the code.
    - **Inside the product the owner sees the same name:** a second meter, "InboxCA storage used this year", in GB and as a percentage of the plan, beside the returns meter. Upgrade prompts say "your firm is using more InboxCA storage than this plan includes".
  - **What Orelu's internal storage holds, and its rough size per client a year** (estimates from Paresh bhai's ratio of about 0.33 GB of files a client a year; to be measured, §12):

    | What Orelu keeps | Rough size per client a year | Counted in the workspace |
    |---|---|---|
    | Client details, registrations, contacts, tasks and reminders | under 1 MB | Yes |
    | Email records: label, time and sender only; **never the email's text** (D6) | under 0.1 MB | Yes |
    | Text and search index read from the client's files | at most about 55 MB (the keeping rule below caps it at one-sixth of the files) | Yes |
    | Figures read for forms | 1–2 MB | Yes |
    | **Total counted** | **about 57 MB** | |
    | Files in transit, kept at most 24 hours until saved to the firm's drive | passes through | No |
    | Working copies of forms, until approved and saved to the drive | passes through | No |
    | 30-day safety copies and the activity log | small, rolling | No |

    So 4 / 10 / 20 / 40 GB a year is the paperwork of about 70 / 175 / 350 / 700 clients of a mixed practice, which is where the suggested client numbers come from. It varies widely by client: a salaried client needs about 1–3 MB a year, a monthly GST client up to about 17–170 MB, an audit client up to about 33–330 MB. For a practice of mostly GST and audit clients the returns measure is usually reached first: about 44 / 110 / 220 / 440 clients at about 18 returns a client.
  - **The keeping rule (decided 8 Oct 2026, after a test on sample files):** a scanned page keeps text and index worth about 5–10% of its size, but a spreadsheet would keep 3 to 12 times its own size if every cell were stored and indexed. So:
    - For each file Orelu keeps text and search index of **at most one-sixth of the file's size**, and always enough to find the file by client, type, period and its key numbers.
    - **Spreadsheets, CSV, JSON and Tally exports are not copied or indexed cell by cell.** Orelu indexes their headings and identifying fields only, and reads the figures from the file in the drive when a form needs them.
    - **The figures read for a form are a working copy.** They are deleted 30 days after the form is filed; the filed form and the source file stay in the firm's drive and can be read again at no AI cost.
    - This makes one-sixth a ceiling and not a guess, so the InboxCA storage of a plan is never used up faster than the files themselves allow.
  - **Provisional sizes:** the workspace sizes assume Orelu keeps about one-sixth of what it reads, and the returns sizes assume about 11.4 returns a client a year for a mixed practice (Enterprise's returns ÷ its suggested clients, so the returns and the client numbers always agree). Both are re-set from the first real firm: one month of files measured for what Orelu keeps, and one client list counted (§12).
  - **Until the sizes are measured, the automatic plan fit is switched off** (`plan_formula.fit_enforced = false`): the meters and the upgrade card are shown as information, nobody is moved or charged because of them, and a firm stays on the plan it chose. Orelu switches it on, with 30 days' notice to every firm, once the sizes have been re-set from real figures (§12).
  - **The allowance is yearly,** because CA work is seasonal; a heavy September does not move a firm by itself. **Monthly payers earn it one month at a time** (one-twelfth each month, unused amounts carried forward within the year); the full year's allowance comes at once only with yearly payment (D38).
  - **Running out never blocks work or a filing.** The owner sees a live meter for both measures, with a projection. When the projection passes the plan, the owner gets 30 days' notice; when the allowance is used, the firm moves to the plan that fits from that date, pro-rated. Above Enterprise on either measure the firm is on Custom automatically, priced by the formula.
  - **Upgrade prompts, worked out automatically** (owner and deputies only; staff and managers never see plan or price prompts):
    - **When:** either yearly measure reaches 80% of the plan, or its projection for the year passes the plan, whichever comes first. The user limit and the AI-credit alerts (§5.18) use the same card.
    - **Where:** a card at the top of the owner's dashboard; a banner in Settings → Plan and add-ons, beside the two meters; an email to the owner.
    - **What it shows:** returns and InboxCA storage used against the plan, each as a figure and a percentage; the date the allowance is expected to run out; the plan that fits; its monthly and yearly price; the amount to pay now, pro-rated for the rest of the paid period; the AI credits the new plan gives.
    - **Which plan:** the smallest preset that fits both measures and the active people. If either measure is above Enterprise, or people are above 40, it offers **Switch to Custom**, with the builder's sliders already set to the firm's own measured figures and the price from the formula.
    - **Every figure is worked out by the server** from `plan_formula`, `usage_ledger` and `tasks`. Nobody types a price and no quote is needed; the card, the banner and the invoice always show the same numbers.
    - **Buttons:** **Upgrade now** or **Switch to Custom** → payment of the pro-rated difference (§5.14.1) → the plan changes on the payment webhook. **Remind me later** hides the dashboard card for 7 days; the Settings banner stays.
    - **If the owner does nothing,** the rule above still applies: after the notice, when the allowance is used, the firm moves to the plan that fits from that date, pro-rated. On UPI AutoPay or eNACH the higher amount needs the owner's approval once (§5.14.1). The card then shows the new plan, the date and the invoice.
    - **Moving down:** before renewal, if last year's figures and the active people fit a lower plan, Settings → Plan says so and shows the lower price; the owner chooses.
    - **Kept as** one `requests` row of kind `alert` with reason `plan_upgrade_suggested`, so it is raised once per plan period and the "remind me later" state is remembered; no new table or column.
  - **The first import** of past files is outside the workspace meter, once, and only for files dated before sign-up; its yearly average sets the starting plan. The client list sets the returns figure on day one, so a large firm cannot start small.
  - **The meter counts what was added, not what is held:** deleting records later does not lower the year's count.
  - **Clients added during the year (user, 8 Oct 2026):**
    - **Counted from the day they are added.** A new client's returns are the calendar entries from that day to the end of the firm's plan year, so a monthly GST client added in month 7 counts about 13 returns this year and about 26 next year. Nothing is back-counted.
    - **Shown before it is done.** When the owner adds one client, or loads a list of many, Orelu shows at once what it does to the two meters and to the year's projection, and whether the plan still fits.
    - **A growth cushion.** A firm may run up to 10% over its plan's returns and InboxCA storage within a plan year without being moved (`plan_formula.growth_cushion`). Above that, the notice and the move-up in the rule above apply, pro-rated from that date. The AI-credit limit is not cushioned; it is the cost stop.
    - **Set right at renewal.** Before each renewal Orelu works out the coming year from the client list as it then stands, with every client at a full year's returns, and shows the plan and price for that year 30 days ahead.
    - **Clients removed or archived** stop adding returns from that day; returns already counted stay counted.
  - **Guards (D38):** each new device signing in to the owner's login is approved on the owner's phone, and use of that login on several PCs alerts the owner; one firm signing up as several small accounts is detected by PAN, GSTIN, mailbox and drive account and is against the terms; in the first 14 days only the latest three months of past files are imported (§5.14.1).
  - **People never lower the plan:** a firm with fewer people than its plan includes pays the plan price; a firm with more adds users one at a time.
  - **AI block caps** (in `platform_settings.plan_formula`; a plan plus its blocks always stays just under the next plan):

    | Plan | Extra AI blocks (4,000 credits) |
    |---|---|
    | Solo | 1 |
    | Growth | 3 |
    | Scale | 8 |
    | Enterprise | 3 |
    | Custom | up to 25% of its own credits |

    Monthly AI blocks and one-time top-ups count together against the cap in any month. At the cap the only way to get more is to move up a plan, applied at once and pro-rated. Storage blocks no longer exist.
  - **At sign-up** the owner answers two questions, how many clients and what kind of practice, and Orelu names the plan that fits and its price as an estimate (the Custom plan builder below). The client list then gives the returns figure at once and the first import gives the workspace figure, so the starting plan is set from the firm's own data within the first days.
  - **Moving down** happens only at renewal, at the owner's request, when last year's workspace, last year's returns and the active people all fit the lower plan.
  - **Enterprise with more than 40 people is Custom:** adding the 41st person simply applies the Custom formula; nothing else changes.
  - **Add-ons on a yearly plan:** extra users and AI blocks are paid up-front for the months left in the year at the monthly rate; from the next renewal they join the yearly amount at the yearly multiple.
  - **Same features on every plan:** plans differ only in people, workspace, returns, AI credits and price; no feature is held back for a higher plan.
  - **Consistency tests (run in CI against `platform_settings.plan_formula`):** each preset's price per GB of workspace a year is equal, and per return a year is equal; a preset at its AI block cap has fewer credits than the next preset; the plan chosen is always the higher of the two measures; the Custom price never falls as work or people rise; yearly equals the yearly multiple of monthly, rounded by the rule.
  - **Custom price** = Enterprise price + the people slabs + the work slabs, rounded by the rule, + extra AI blocks + add-ons. **Rounding rule (user, 11 Oct 2026):** every plan price, monthly and yearly, ends in the same last three digits (499 in the business plan). A Custom price is rounded to the nearest such price and is never below the first such price above Enterprise, so the first step above Enterprise always changes the price. The digits and the floor are values in `plan_formula.rounding_rule`, not constants in code. The firm's **size** for the work slabs is the larger of its workspace GB a year and its returns a year converted to GB at the formula's rate. Slabs work like income-tax slabs: only the part of a firm inside a slab pays that slab's rate, and each higher slab has a lower rate. People slabs: 41–60, 61–100, above 100. Work slabs (workspace GB a year): 41–80, above 80. Bounds and rates live in `platform_settings.plan_formula`; the admin console refuses a rate that would leave less than a 65% margin on the added unit at full AI use. **Custom AI credits** = Enterprise's + the per-GB amount × (size − 40); extra people add no credits.
  - The suggested client number is each plan's headline on the pricing page (for a mixed practice, from Paresh bhai's ratio; a second, lower number is shown for a practice of mostly GST and audit clients). It is help only and never a limit.
- **Presets:** Solo, Growth, Scale and Enterprise are stored with their fixed users (the whole team, owner included: Solo 1, the CA alone; Growth, Scale and Enterprise up to 10, 20 and 40; any of them can add people one at a time). On Solo there is no staff, so approvals, deputies, teams and the office lock stay hidden until a person is added, allowances and prices, so the pricing page, sign-up, invoices and limits can never disagree.
- **Custom plan builder** (public pricing page and Settings → Plan):
  - **What the owner sets (user, 8 Oct 2026: a CA knows his clients, not his returns):**

    | Control | What the owner enters | What Orelu does with it |
    |---|---|---|
    | Clients (a slider, and a box to type the number) | How many clients the firm has | Turns clients into returns a year with the practice type below |
    | Practice type (one choice) | Mostly salaried and ITR · Mixed · Mostly GST and audit | Uses that type's returns-per-client rate from `plan_formula.estimator` (working values: about 2, 11.4 and 18; the GST rate follows GSTN's own totals, about 13 to 17 GST returns a registered business a year because many small businesses file quarterly, plus the income-tax return; the mixed rate is always Enterprise's returns ÷ its suggested client number, so the estimator can never contradict a plan's headline; returns above Enterprise's figure are rounded up to a whole size step) |
    | People (the whole team, owner included) | 1 to 40, in steps of 1 | None: included, the price does not move |
    | People | each person above 40 | Adds that person's slab rate; no credits |

    - **The same two questions sit at the top of the pricing page for every firm,** not only Custom: the answer names the plan that fits (Solo, Growth, Scale, Enterprise or Custom) and its price. A firm never has to know its returns to see a price.
    - **Before sign-up the price is an estimate** and is labelled so, with the returns figure it was worked out from shown beside it.
    - **After sign-up the estimate is replaced by the count.** When the client list is loaded, Orelu counts the real returns from the calendar and shows the exact plan and price. Lower than the estimate: the difference is credited against the next debit. Higher: the owner sees the upgrade card (above) with the difference; nothing is debited without the owner's approval, and the 14-day money-back still applies.
    - Inside the product, where the returns are already counted, the builder shows the real figure and the owner cannot set it lower.

    **InboxCA storage (the workspace) is not a slider.** Orelu measures it. The price uses the larger of the returns size and the measured workspace size, and there is no returns slider: clients and practice type take its place; when the workspace is the larger, the builder says "sized by the InboxCA storage your firm uses" and shows the GB it used. A Custom price therefore depends on the firm's work; a Custom firm with 8 people and one with 40 pay the same, and people count only above 40.  Extra AI credit blocks are a separate add-on inside the block cap. Smaller firms are placed on Solo, Growth, Scale or Enterprise by their work and can still add people and capped AI blocks; the builder never offers a smaller plan plus blocks in place of the plan a firm's work needs.
  - Switches: the owner's cap for AI auto top-up, always inside the plan's block cap; future monthly packs (WhatsApp messages, AI call minutes, §5.19), hidden until those features launch.
  - Shown live: the clients entered, the returns worked out from them, InboxCA storage and AI credits included; what the credits cover in plain words (about N emails sorted, N AI replies or reminders and N pages read a month); monthly and yearly price with a line-by-line breakdown; how the firm's current usage fits the new plan.
  - The server computes the amount for the Razorpay subscription or order with the same function (§5.14.1); the browser's figure is never trusted. Upgrades apply on payment (prorated); downgrades at renewal. A downgrade below the firm's measured work, or below its active people, is refused, with the reason shown (the owner deactivates users first).
- `subscriptions`: firm, formula version, billing cycle, renewal date and `plan` (plan code, extra people, workspace GB a year and returns a year for Custom, extra AI blocks, add-ons, the owner's caps). What the plan includes is read from the formula, not stored again. A firm keeps its formula version until renewal.
- **Client count is not metered.** Firms can add any number of clients; the dashboard shows active clients (activity in the last 12 months) only as information.
- **Users are counted, not metered by use.** Settings → Team shows "N of M users". At the limit, inviting another person offers **Add a user** (paid first, prorated, Razorpay order, §5.14.1) or a plan upgrade; existing users are never locked out. Deactivating a person frees the seat at once, so firms can swap article assistants any time at no cost; a removed user's log and history stay.
- **Workspace used and returns counted:** read when needed from `usage_ledger` (workspace bytes added in the year) and from `tasks` (returns in the calendar); shown to the owner as two meters, "Returns this year" and "InboxCA storage used this year", as a figure and a percentage; no separate table.
- **Every metered cost is capped (D26).** Usage shows on the dashboard; the owner is emailed at 80% and 100% and sees the upgrade prompt with the new plan and price already worked out.

| Meter | Included | At the limit |
|---|---|---|
| Clients | Unlimited | Not metered; the returns measure counts the work clients create, not the clients. |
| Users | The plan's team size, owner included (Custom: as chosen) + extra users | New invites wait for an extra user or upgrade; nobody already active is removed. |
| Orelu workspace (a year) | The plan's workspace (Custom: as measured) | Never blocks work: notice at the projection, then a pro-rated move to the plan that fits. |
| Returns (a year) | The plan's returns (Custom: as measured) | Never blocks a filing: notice, then a pro-rated move to the plan that fits. |
| AI credits | The plan's monthly credits (Custom: Enterprise's + per-GB credits above it), + rollover and top-ups | Paused in order at 90% and 100% (§5.18). |
| Downloads through Orelu | Fair use, set per plan in the admin configuration (files are fetched from the firm's drive and streamed by the file worker) | Further downloads wait for the owner's OK. The owner can always open files directly in the drive. |
| Orelu system emails (invites, alerts, share codes) | Per-firm daily cap | Queued to the next day; share codes rate-limited per contact. |
| Client emails sent | From the firm's own mailbox (no Orelu cost) | Paced under 80% of the mailbox provider's daily limit; the rest waits for the next day, oldest first. |
| First-import AI | One month of the plan's AI credits, paid by the setup fee (AI cost + 20%) | Files still unplaced go to `To check` for staff, or the owner buys a top-up. |
| SMS | Not used (sign-in by authenticator, passkey or email) | — |
| WhatsApp messages, call minutes (future) | The monthly pack bought | Channel stops and falls back to email; buy another pack or auto-renew up to the owner's maximum (§5.19). |

- No meter charges beyond a cap the owner set, and nothing a client sends is lost: at worst it stays in the firm's mailbox.
- The admin console shows each firm's usage per meter, Orelu's cost against the price (margin) and suggested plan changes.

#### 5.14.1 Billing and payments (Razorpay, all automatic)

- **One provider, no card data at Orelu.** Every Orelu charge goes through Orelu's own Razorpay account: Razorpay Subscriptions for plans paid by card, Razorpay Recurring Payments (one mandate, each debit raised by Orelu) for plans paid by UPI AutoPay or eNACH, Razorpay Orders for one-time payments. Razorpay's hosted Checkout collects card, UPI and bank details and keeps the token (RBI card-on-file rules); Orelu stores only Razorpay ids.
- **Sign-up:** firm details → plan and monthly or yearly → the server computes the amount from `platform_settings.plan_formula` → a Razorpay subscription is created → the owner authorises AutoPay in Checkout → the signed `subscription.activated` / `subscription.charged` webhook (verified, idempotent) makes the pending firm active and emails the invite.
- **Which AutoPay method:**

| Amount per debit | Methods offered | Why |
|---|---|---|
| Up to ₹15,000 | Card or UPI AutoPay (eNACH also offered) | Under RBI's e-mandate rules these debit without an OTP after one authorisation |
| Above ₹15,000 (Enterprise monthly, every yearly plan, Custom) | Bank e-mandate (eNACH) by default, up to ₹10 lakh a debit; card or UPI allowed, but the owner then approves each debit with an OTP | Card and UPI debits above ₹15,000 need an OTP every time; eNACH does not |

  The ₹15,000 check uses the amount actually debited, including 18% GST once Orelu is GST-registered.
  **A card does not lift the limit (17 Oct 2026):** RBI's ₹15,000 limit on recurring debits without an OTP applies to cards and UPI alike, so above it the only way to debit without an OTP each time is the bank e-mandate (eNACH). Razorpay runs the e-mandate end to end: the owner authorises it once on Razorpay's checkout (net banking, debit card or Aadhaar), and Razorpay registers it with the bank, sends the pre-debit notice, debits and retries; Orelu only raises each amount and handles the webhooks. A new mandate can take a day or so for the bank to confirm, so the first debit on eNACH is not instant.
- **Renewals:** Razorpay sends the required pre-debit notice (24–48 hours before) and debits on the renewal date. The owner can cancel AutoPay any time in Settings → Billing (or in their bank or UPI app); cancelling stops the next renewal. After the first 14 days there are no part refunds for the paid month or year; a duplicate debit or a charge error is always refunded in full. The published refund and cancellation policy says exactly this.
- **Money-back guarantee (D33):** within 14 days of the firm's first successful debit the owner can press **Cancel and get my money back** in Settings → Billing (owner only, confirmed with 2-step login; a reason is optional; no Orelu person is involved).
  - **Returned:** the first plan payment in full, monthly or yearly, and any extra users or AI blocks bought in those 14 days, with GST when GST was charged (a credit note is issued).
  - **Not returned:** the setup fee once the first import of past files has started (it covers AI work already done), and one-time AI top-ups once any of their credits are spent.
  - **Once per firm:** eligibility is decided on the server against `guarantee_claims` (hashes of PAN, GSTIN, connected mailbox address and owner email), kept after the firm's data is deleted for this purpose only and named in the privacy notice. A refunded firm can sign up again, without the guarantee.
  - **How it runs:** the server checks eligibility → cancels the Razorpay subscription and its mandate → creates a normal-speed Razorpay refund to the original payment method with an idempotency key → the signed `refund.processed` webhook marks it done and emails the owner. Razorpay quotes 5–7 working days. `refund.failed` (for example a short Razorpay balance) retries and alerts the admin; the owner sees "refund in progress", never a silent failure.
  - **What happens to the firm:** read-only at once under existing permissions, automation paused, client emails left in the mailbox; the files stay in the firm's own drive; the owner can download the client list, records and logs for 30 days, then Orelu deletes its workspace with notice. This is the same path as a suspended firm.
  - **Cost stays bounded:** nothing extra is unlocked in the 14 days, and only the latest three months of past files are imported in that time (D38). AI use is already capped by the plan's credits, auto top-up is off by default, and the setup credits are covered by the setup fee. Razorpay does not return its own fee on a refund, so Orelu bears it (figures in the business plan).
  - **Shown plainly:** on the pricing page, at sign-up, on the first invoice and in Settings → Billing, with the last day of the window as a date.
  - **Admin console:** refunds by month and reason; an alert when refunds pass 10% of new firms in a month.
- **Failed payments:** Razorpay retries automatically and Orelu emails the owner a pay-now link after each failure. Days 0–7: everything works, with a banner. Days 8–30: **read-only under the firm's existing permissions** (staff may view what they could already view and may download only approved filing files; no billing state expands access; automation pauses; client emails stay in the mailbox). The owner keeps the drive and can download the client list, records and logs. After day 30: suspended; Orelu's workspace is kept 30 more days, then deleted with notice. Orelu never deletes anything in the firm's drive for non-payment.
- **Plan changes:** an upgrade applies at once; the pro-rated difference is paid as a one-time Razorpay order and the plan changes on the webhook. Downgrades apply at renewal. **How the recurring amount changes depends on the AutoPay method** (Razorpay's Subscriptions FAQ, read on 8 Oct 2026: a live subscription can be updated when authorised by card, not when authorised by UPI):
  - **Card:** the subscription is updated in place; nothing more for the owner to do.
  - **UPI AutoPay or eNACH:** these firms are on Razorpay Recurring Payments. At sign-up the owner approves one mandate with a **maximum amount**, set at twice the plan's price and shown plainly ("Orelu will never debit more than this without asking you"). Each cycle Orelu's billing job raises the exact amount, after the pre-debit notice Razorpay requires at least 24 hours before. A plan change inside the maximum needs nothing more from the owner; one above it needs one new approval in Checkout.
  - **Automatic move-up (§5.14) above the mandate's maximum:** Orelu cannot debit more than the mandate allows, so the upgrade card and an email carry a one-click approval link. Work, filings and reminders continue. If it is not approved within 30 days, only AI work pauses, exactly as at 100% of AI credits (§5.18), until the owner approves; nothing is deleted and no filing is blocked.
  - **Why this method (Razorpay's documentation, read on 8 Oct 2026):** a live UPI subscription cannot be updated, while Recurring Payments let the business charge a different amount each time up to the mandate's maximum; the business raises each debit itself. So renewals, retries after a failed debit and the pre-debit notice for these firms are run by Orelu's billing job, not by Razorpay's scheduler. **Still needed from Razorpay in writing (§12):** that Recurring Payments is switched on for Orelu's account, its fee (UPI and e-mandate pricing is on request) and the per-debit limit on UPI. Until then the fallback is Subscriptions with one approval per plan change.
- **Top-ups and add-ons are paid first:** Buy → a Razorpay order for the exact amount → the owner pays with the saved card or UPI (one tap, plus an OTP if the bank asks) → `payment.captured` webhook → credits or pack added automatically within a minute. Nothing is added before the payment is captured.
- **Auto top-up** (optional, off by default): debited through the existing AutoPay mandate after the required pre-debit notice, so credits arrive about a day after the 90% alert; never above the owner's monthly maximum.
- **Invoices:** every charge produces an invoice (Orelu's PAN; GSTIN once registered), emailed to the owner and listed in Settings → Billing; firms that deduct TDS can reconcile against it.
- **GST on Orelu's prices (D32):** `platform_settings.plan_formula` prices are before GST. `platform_settings.tax` (admin only) holds registered yes/no, GSTIN, state code, SAC code and start date. Before the start date an invoice carries no GST and states that Orelu is not GST-registered; from it, every invoice is a tax invoice with 18% (CGST + SGST for firms in Orelu's state, IGST otherwise) and shows the firm's GSTIN. Sign-up collects each firm's state and, optionally, its GSTIN. **Starting GST on live plans:** every debit rises by 18% from that day. Card firms are on Subscriptions, whose amount can be updated. UPI AutoPay and eNACH firms are on Recurring Payments, whose mandate maximum (twice the plan price, §5.14.1 Plan changes) already covers the 18%, so nobody has to authorise again. Registering for GST before the first paid plan is still the simplest path and stays the recommendation. Firms get 30 days' notice either way. The admin console records Orelu's total turnover across its products (entered by the team) and alerts at ₹15 lakh in a financial year.
- **Discounts:** there is no introductory or founding discount (removed by the user on 7 Oct 2026). Referral credits are applied as Razorpay offers or credits on specific cycles, computed server-side.
- **Reconciliation:** a daily job matches `payments` against Razorpay payments and settlements; any mismatch alerts the Orelu team.
- **Fees as cost:** Razorpay's per-payment fee, any Subscriptions fee and 18% GST on fees are stored per payment (`fee_paise`, `fee_tax_paise`) and counted in the admin margin view. Rates are confirmed in writing with Razorpay before launch.

### 5.15 File types and the file worker

| Group | Extensions | Notes |
|---|---|---|
| PDF | `.pdf` | Password-protected PDFs are flagged; never guess passwords; staff may save one encrypted |
| Images | `.jpg` `.jpeg` `.png` `.webp` `.heic` `.heif` | HEIC converted to JPEG on ingest, original kept |
| Spreadsheets | `.xlsx` `.xls` `.csv` `.ods` | Registers, computations; parsed for extraction |
| Word | `.docx` `.doc` `.odt` `.rtf` | Letters, draft certificates |
| Government utility files | `.json` `.xml` `.fvu` `.txt` `.csi` | Parsed deterministically; no AI |
| Archives | `.zip` | Extracted by the worker within limits |
| Accounting backups | Tally exports and backups | Stored as files only |

**Rules:**
- Extension allowlist plus magic-byte sniffing; reject executables, scripts and macro-enabled Office files.
- Malware scan (ClamAV in the worker) before a file becomes visible.
- Limits: 50 MB per file normally, 2 GB per file for the first import; ZIP up to 500 MB, 1,000 entries, one level, no traversal or symlinks.
- **Save path:** email attachment or browser upload → short-lived presigned multipart upload to the isolated temporary area of Orelu's workspace bucket, encrypted by the storage provider (24-hour lifecycle, no user visibility) → worker scans and converts → worker reads the file and keeps its text and figures, encrypted with the firm's key → worker saves the file to its client folder in the firm's drive → deletes the temporary object. If the drive cannot be reached, the temporary object is kept for up to 7 days with retries (§5.5.1). Product and legal copy must say plainly that client files rest in the firm's own drive, readable by the owner, and that only Orelu's own data is encrypted with the firm's key.
- **View and download path:** app checks actor, tenant, version, scan state and share policy → the file service fetches the file from the firm's drive with the firm's token and streams it; drive links, tokens and Orelu's storage credentials are never exposed to users. Files within Lambda's verified limits may use Lambda. Larger files use the M0-selected short-lived container service with resumable HTTPS streaming and the same policy checks; Lambda is never assumed to stream a 2 GB response.
- Email attachments sent out: only `auto` documents under 10 MB are attached (PDFs password-protected); everything else goes as a secure link (§8.6).
- The file worker runs on AWS Lambda in Mumbai (D28); the M0 spike tests a 2 GB file through the worker into a drive, ZIP expansion and a streamed view from a drive against Lambda's run-time and response limits, and moves only oversized jobs to a short-lived container task if needed.

### 5.16 First import of past files (D22, D36)

- **Old files are optional (user, 8 Oct 2026: 1,000 to 2,000 GB is too much to ask of an owner).** Orelu works on new files from day one with nothing old brought in. A request for an old paper that was not brought in becomes **Needs team reply**, as today.
- **The "Add old files" screen asks what to bring, newest first:**
  - **Final papers only (recommended):** filed returns, acknowledgements, certificates, audit reports, notices and orders. These are what clients ask for later, and they are a few GB.
  - **One chosen year in full.**
  - **Everything.**
  The raw working data of years already filed (invoices, registers) has no use for Orelu and can stay where it is.
- **Each choice shows its size and a time estimate before the owner starts,** worked out from the files' sizes and a quick test of the office line's upload speed (about 2 days for 1,000 GB at 50 Mbps).
- **The best way in is chosen for the owner:** folders already in a whole-drive OneDrive or Dropbox are only ticked; a hard disk is best sent with the drive's own desktop app, which runs for days by itself, or through Orelu's uploader for smaller sets.
- **Folders are matched to clients by name,** and the owner sees every match and fixes the ones that did not match before anything moves.
- **Nothing has to be uploaded to Orelu.** Past files are either already in the firm's drive or are put there first.
- **Files already in the drive:** the owner only ticks the folders and Orelu sorts them in place (§5.5.1).
- **Files still on a disk** (Paresh bhai's case): the owner either lets the drive's own desktop app copy them into the drive, or drops the folders into **Orelu's uploader**, which sends each file from the browser straight to the firm's drive into an `Incoming` folder; nothing passes through Orelu's servers on the way in. The upload resumes after a break and every file is checked against its checksum.
- **Preview, then approve:** Orelu reads the handed-over files and shows where each one would go (client, work type, year, name). Nothing is moved until the owner approves; a record of every file's original place is kept, so the move can be undone.
- **Placing:** rules use the existing folder names (whatever order the firm used) with a mapping the owner confirms; AI reads only files the rules cannot place; anything unsure goes to `To check`.
- **Then Orelu reads each file from the drive,** scans it, and only after the owner approves the preview moves it from `Incoming` (or from where it was handed over) into its client folder. Moving inside the drive uploads nothing again; the firm's originals are never altered, only moved and renamed.
- **In the first 14 days** only the latest three months of past files are imported; the rest follows after the money-back window (D38).
- **Metering:** the first import is outside the workspace meter, once, for files dated before sign-up; its yearly average sets the starting plan (§5.14).


### 5.17 Access policies (D17)

- Firms differ: some keep every PC in the office, some let staff take laptops home, a solo CA carries one laptop. So access is a **firm setting**, not a fixed rule.

**Each lock is a switch the firm turns on only if it wants it; a policy answers four questions:**

| Question | Options |
|---|---|
| **Where** | On the office connection (§5.8) · office, or approved remote · anywhere · (optional) India-only by IP, best effort |
| **Which device** | Approved devices only · any device (not recommended). Each approved device is marked **Stays in the office**, **Laptop** or **Personal** (one person) |
| **When** | Hours per weekday, holidays, temporary extended hours and Season hours, all editable by the owner · always |
| **What** | Full · view-only (no download, share, export or delete request) · no access; set separately for in-office and off-site, so employees can be view-only even in the office |

- **Extra controls per policy:** idle timeout, maximum session length, 2FA on every sign-in or every N hours, and **owner approval for each remote day** ("Request remote access for today"; the owner approves on the phone).

- **Who a policy applies to:** firm default → role → branch → person; the most specific wins.
- The owner can't be locked out: always at least "anywhere, registered devices, 2FA"; recovery after losing every device goes through the saved recovery codes, then Orelu support with identity checks.

**Presets (one click in Settings, then editable).** **Standard is the default**; every stricter preset is opt-in:

| Preset | Fits | Staff | Owner |
|---|---|---|---|
| **Standard** (default) | Most firms | Any device with 2-step login, anywhere, anytime; no locks | Same |
| **Office only** (Paresh bhai) | Firms that want staff only in the office | Approved PCs + the office connection + office hours; nothing from outside | Anywhere, registered devices, 2FA |
| **Office + approved remote** | Mostly office, some people work from home | Office only, except named people on an approved personal device within hours; remote is view-only; optional owner approval per day | Anywhere |
| **Remote-friendly** | Firms that allow work from home | Approved devices anywhere, within hours; downloads off outside the office by default; India-only | Anywhere |
| **Solo CA** | One CA, one laptop that moves | Staff (if any) office only | Anywhere on registered devices with passkey, 2FA, 15-minute idle lock |

**How PCs are approved (works for 5 to 40+ PCs):**
- **PCs are approved as machines, not per person.** Each approved PC (each browser profile on it) holds a non-exportable device key created in the browser (WebCrypto); every request is signed with it. Any employee can sign in on any approved PC with their own login and 2-step code, so shared desks and new joiners need no device work.
- **Sessions are bound to the PC's security chip where the browser supports it** (Device Bound Session Credentials: Chrome on Windows with a TPM today, macOS to follow), so a stolen session cookie fails on another machine. Elsewhere the signed-request key is the binding.
- **Every new PC needs the owner's or a deputy's tap:** "New PC wants to join (signed in by Ravi, on your office connection): Allow: stays in the office / Allow: laptop / Refuse". On setup day the owner gets one message, "12 PCs signed in from your office today: approve all" (each marked Laptop unless the owner ticks Stays in the office). A manager can never approve a device.
- **Stays in the office** is offered only when the PC can hold a **device-bound passkey** (WebAuthn platform authenticator, not backup-eligible; Orelu checks this by itself at approval). The passkey is created at approval and is the proof used for rule 3 in §5.8; the person at the PC confirms with the PC's own PIN or fingerprint at that moment. If the M0 spike shows this is unreliable on common office PCs, rule 3 is switched off by configuration and an address change needs a tap or a fixed address.
- **Personal devices** (an employee's own laptop or phone) are refused before any client data is shown: "This device is not approved for your firm. Ask the owner." The request goes to the owner or a deputy only: Allow for today / Allow until a date / Refuse. An approval covers one person on one device, view-only with the watermark, no downloads (approved filing files included) unless the owner allows them, within office hours unless the owner sets others; it can be withdrawn at once. A personal laptop brought into the office is still a new device and needs the same tap.
- **The owner's and deputies' own devices** are registered with a passkey; the owner adds devices by QR code (§5.17.3).
- **Limits of the PC key, stated plainly:** clearing browser data, a private window or another browser loses the key, and the PC must be approved again; a skilled person could copy a whole browser profile, which is why the office-connection check always runs together with the device check (a copied key still fails away from the office); remote-desktop tools on an office PC can't be detected and must be removed by the firm.
- **Lost, replaced or retired PC:** the owner revokes it in one click; every session on it ends immediately. Orelu is a browser app with no offline copy of client files.
- **A person leaving the firm:** the owner removes their login; the PCs stay approved for the next person.

**Recommended rules by role (Office only preset):**

| Role | Where | Devices | When | Can do |
|---|---|---|---|---|
| Owner (admin) | Anywhere | Registered personal devices (passkey) + office PCs | Anytime | Everything; grants permissions, approves devices, networks, remote days and deletes |
| Partner / manager | Office; remote only if the owner allows that person | Approved PCs; an approved personal device if allowed | Office hours (owner can extend per person) | Every client, view only, plus rename, the yes/no check and marking forms filed; approves their team's everyday requests once and, where second approval is on, their team's prepared forms; anything else is a request to the owner; remote is view-only |
| Employee (staff, front desk) | Office only | Approved PCs only | Office hours | Every client, **view only**; renames (document type or period); does the yes/no check on extracted figures; marks forms filed with the acknowledgement; downloads approved filing files for the portal; anything else is a request to their manager or the owner |

- **Enforcement:** checked on every request (§4.4) and re-checked in RLS through a server-set session claim.
- Every refusal and policy change is logged; the owner is alerted on repeated refusals and any policy change.
- Settings includes a **policy tester** ("Can Priya open documents now, from here, on this laptop?").
- **Staff never get a drive link:** every view or download is fetched from the firm's drive by the file worker after the policy check; download links are single-use, bound to the user's session and device, and expire in 2 minutes (§8.6).
- **Limits, stated plainly:** no website can stop a photo of the screen, a file already downloaded, or remote-desktop tools on an office PC; the watermark, view-only mode and the firm's own PC policy cover these.

#### 5.17.1 The four checks under Office only

| Check | How | What it stops |
|---|---|---|
| **Login** | Their own email code (D41); the phone code too for the owner, deputies, co-admins and anyone off the office connection; one active session per person | Stolen or shared logins |
| **Approved PC** | Device key signs every request; chip-bound session where supported | Personal laptops and phones; any PC the owner has not approved |
| **Office hours** | Orelu's clock in the firm's time zone; sessions end at closing | After-hours work; a changed PC clock |
| **Office connection** | The server-seen address matches a confirmed office address (§5.8), on every request | An approved laptop used anywhere else, including one that leaves mid-session |

- All four are checked on every request. Failing any one means refused, logged, and the owner told on repeats.
- Applies only to office-based presets; Standard firms need none of it.
- **Not used as proof:** a code by SMS or email (proves who, not where), the Wi-Fi name (a browser can't read it), GPS or a map pin, battery or any other signal the PC reports, provider and city.

**What software can't stop, and is told to the firm plainly:**
- Remote-desktop tools (AnyDesk, TeamViewer) or a proxy left running on an office PC: the request really does come from the office. The firm should remove them. Orelu still enforces hours.
- A PC on a nearby connection of the same provider that happens to share the office's public address (§5.8 stated limit); a fixed address closes this.
- A photo or screenshot can't be prevented; the tiled watermark (name, date, time) across every opened page makes it traceable, and capture attempts are logged (§5.17.2).
- IP-based location is approximate and can be hidden by a VPN, so "India-only" is a supporting check, never the only one.

#### 5.17.3 One switch: "Staff can use Orelu only in the office" ("Office only for staff")

For CAs who want staff to use Orelu only in the office. **Off by default**; firms that don't want it never see a change.

- **What the owner sees (the whole setup):**
  1. Settings → **Staff can use Orelu only in the office** → turn on, and answer "Are you in your office right now?" Yes / No.
  2. As staff sign in that day: "12 PCs signed in from your office today: approve all".
  - That's all. Nothing to install, no calls, no choices between technical options.
- **Rule for the UI:** the owner never sees technical words (IP, static IP, passkey, device types beyond "stays in the office" and "laptop"). Everything else runs inside Orelu; the owner only gets plain messages, e.g. "Ravi asked to download the Mehta GSTR-1 file: Allow / Refuse", "New PC wants to join", "Ravi's laptop is on a different internet connection: Allow for today / Refuse", "Your office internet connection changed today".
- **Defaults instead of questions** (all changeable later under **More options**):
  - Staff template **View only** (edits go to the manager or the owner as requests); **View + prepare forms** available for firms that want fewer requests.
  - Office hours are editable in Settings by the owner, including weekday times, holidays, temporary extended hours and Season hours. Setup starts from Mon–Sat 9:00–18:00 only as an editable suggestion; for Paresh bhai, prefill 9:00–17:00 after he confirms it.
  - Staff may extend up to 1 hour once a day themselves (logged); longer needs one tap.
  - A one-time banner: **Get approvals on your phone** (scan a QR code; the website on the home screen).
  - A one-time prompt: **Name up to 2 deputies** who can answer when the owner can't (§5.17.4 #18).
- **What Orelu does by itself:**
  - Records the office connection from the switch-on request and checks every staff request against it (§5.8).
  - Asks for the owner's or a deputy's tap for every new PC and every personal device (§5.17).
  - Confirms a changed office address through a fixed address or a trusted fixed PC; otherwise asks the owner or a deputy once.
  - Tracks how often that happens for this firm and, when it is frequent, suggests a fixed address in plain words with a **call script** ("Please add a static public IP to our broadband connection, account number ___. We need it for office software access."); the owner taps **Done** from an office PC and Orelu records the address itself.
  - Ends sessions at closing time and refuses everything outside the four checks (§5.17.1).
- **What staff can then do:**
  - Sign in only on an **approved PC**, on the **office connection**, in **office hours**; phones, personal laptops and unapproved PCs are refused.
  - Sessions end at closing time; attempts outside hours or off the office connection are refused and the owner is told.
  - **View only** (§5.17.2): read documents and records to fill portals and check forms; download only approved filing files.
  - **Rename** a document by correcting its type or period (logged, undoable).
  - **Request** anything more (edit figures, upload, download, send, delete); their manager is notified instantly, or the owner for deletes and for a manager's own request (§5.17.2).
- **Late arrivals, absentees, new joiners and new PCs:**
  - Arriving late changes nothing: anyone signs in with their own email code on **any** approved PC (D41), at any time within office hours. PCs are approved, not people.
  - The first person in needs no other device to be on: they get in when their PC is approved and the office address is unchanged, fixed, or confirmed by their own trusted fixed PC (§5.8).
  - A new or replaced PC: sign in on it in the office; the owner or a deputy taps Allow once.
  - A new joiner needs only a login from the owner; they use any approved PC.
- **Working past closing time:** by default staff may extend up to 1 hour once a day themselves (logged, no tap); longer, the staff member taps **Ask for more time** and the owner approves on the phone for that day. Per-person hours (a late shift) can be set in Settings.
- **What the owner can do:** everything, from anywhere, on registered devices with 2-step login.
- **Owner's own devices, smooth and with no calls:**
  - **Add a device:** sign in on the new phone, laptop or home PC; it shows a QR code; scan it with a device already signed in (like linking WhatsApp Web) and it is registered as the owner's device.
  - **Synced passkeys:** passkeys saved in the owner's Google Password Manager or iCloud Keychain work on a new phone or laptop on the same account without re-registering.
  - **Recovery without support:** setup asks the owner to add a second device and save 10 one-time **recovery codes** (download or print); either restores access. Orelu support with identity checks is the last resort, only if every device and the codes are lost.
- **Approvals stay readable:** every message names the person, the PC and the connection; device and network approvals default to "today"; the owner gets a weekly summary of what was approved and by whom.
- **Orelu's own team never approves** a firm's PCs, networks or requests: it cannot know what is really the firm's office, and it must not decide who reaches client data.
- **Turning it off** returns staff to the previous policy at once; nothing is lost.
- **Side doors Orelu can't control (shown as a checklist when the switch is turned on):**
  - **Firm mailbox:** client attachments also sit in the firm's email; don't give staff the mailbox password (Orelu does the email work), or restrict it to the office in Google Workspace or Microsoft 365.
  - **Remote-desktop tools** (AnyDesk, TeamViewer) on office PCs: uninstall them.
  - **Clients sending documents to staff phones:** ask clients to use the firm's email address.
  - **Photos of the screen:** can't be blocked; the watermark (name, date, time) traces them.
- **Guarantee, stated plainly:** inside Orelu the rules are checked by the server on every request, so they can't be bypassed from the PC; the side doors above are the firm's responsibility, and Orelu never claims to prove where a person physically is.

#### 5.17.4 Edge cases for office-only staff (all must pass in M7)

| # | Case | Behaviour |
|---|---|---|
| 1 | Staff arrives late | Signs in on any approved PC within hours; PCs are approved, not people |
| 2 | Different browser, cleared browser data, Windows reinstall | Treated as a new PC; the owner or a deputy taps Allow once |
| 3 | Shared PC, several staff | Own login each; 15-minute idle lock; signing in signs the previous person out |
| 4 | PC left unlocked | Idle lock; a manual **Lock** button |
| 5 | Staff resigns or is fired | Owner disables the login; every session ends within seconds |
| 6 | Switch turned on away from the office by mistake | The switch asks "Are you in your office right now?"; No means no connection is recorded until the owner confirms one from the office. If a wrong one was confirmed, Settings → **This is not my office** removes it and ends staff sessions |
| 7 | Office internet down, phone hotspot used | Not the office connection; the owner or a deputy taps **Allow this network today** |
| 8 | Two internet lines (failover or load-balanced) | The office is a **set of confirmed addresses**; each line is confirmed once (fixed address, a tap, or a trusted fixed PC); switching between confirmed lines mid-session is allowed |
| 9 | IPv6 (e.g. Jio gives each PC a different IPv6 address) | IPv6 matched by the office prefix (/56, falling back to /64), IPv4 exactly; both learned at sign-in (§5.8) |
| 10 | Office moves or changes provider | The new connection is confirmed by the owner's or a deputy's tap, or by a trusted fixed PC with the owner told; old addresses are dropped after 7 unused days |
| 11 | VPN on an office PC | Refused (not an office address) |
| 12 | Spoofed address headers | Address taken only from `CF-Connecting-IP` on requests that reached Cloudflare; anything else ignored |
| 13 | Branch office | Each branch has its own connection, PCs and hours; the switch is turned on from each office |
| 14 | Closing time mid-work | 10-minute warning; unsaved work kept as a draft; session ends at closing |
| 15 | Staying late | Optional self-extend up to 1 hour once a day (logged); longer needs **Ask for more time** and one owner tap for that day |
| 16 | Tax-season Sundays or deadline weeks | **Season hours:** owner opens extra days or hours for everyone over a date range in one tap |
| 17 | Wrong PC clock or time zone | Hours checked on the server in the firm's time zone (IST), never on the PC |
| 18 | Owner travelling, busy or phone off | Owner names up to 2 **deputies** (partners) who can approve requests, devices and networks like the owner; a team's manager already answers everyday requests (§5.17.2) |
| 19 | Request not answered | Expires after 4 hours; staff told; can ask again |
| 20 | Owner gets no phone notifications (iPhone) | Setup asks the owner to add Orelu to the home screen (needed for web push on iPhone); email and dashboard alerts always sent too |
| 21 | Request flooding | Requests rate-limited per person; **Always allow** for that person stops repeats |
| 22 | Firm with two owners | Up to 2 **co-admins** with full rights; every admin action logged |
| 23 | Owner loses phone and laptop | A synced passkey on a new device, the second registered device, or one of the 10 recovery codes saved at setup restores access; Orelu support with identity checks only if all are lost |
| 24 | Switch turned on while staff work from home | Their sessions end at once with a clear message |
| 25 | Switch turned off | Previous policy restored at once; nothing lost |
| 26 | Client emails arrive while staff are locked out | Automation (filing, replies, reminders) keeps running; only human access is limited |
| 27 | Front desk scans paper documents | Owner grants that person a standing **Upload** permission once |
| 28 | Staff sick, must work from home | The owner approves that person's device with an end date; view-only |
| 29 | Approved filing file forwarded from a personal email | Can't be blocked; the download is logged; the data was going to the government anyway |
| 30 | **An approved laptop at home on the same provider, sharing the office's public address** | Refused where the office line has IPv6 (the prefix differs) or a fixed address. On a shared IPv4-only line it can pass in rare cases; Orelu states this limit and suggests a fixed address |
| 31 | Screen photos, the firm's own mailbox, remote-desktop tools, clients messaging staff phones | Outside Orelu; shown as the switch-on checklist (§5.17.3) |
| 32 | Mix of desktops and laptops | Every approved PC works on the office connection; only a PC marked Stays in the office with a device-bound passkey can confirm a changed address; laptops never can |
| 33 | **All laptops, no desktops** | Works on the confirmed connection; after an address change the owner or a deputy taps once; Orelu suggests a fixed address in plain words |
| 34 | **Approved laptop taken home** | A different connection: refused. The owner gets "Ravi's laptop is on a different internet connection: Allow for today / Refuse"; the episode stays logged |
| 35 | **First person of the day** (no other PC on yet) | Gets in when their PC is approved and the request is on a confirmed office address; no other device is needed |
| 36 | **First person of the day and the office address changed overnight** | Fixed address: does not happen. On a trusted fixed PC: confirmed automatically and the owner told. On any other PC: waits for the owner's or a deputy's tap (a deputy who is first in confirms on the sign-in screen); no unconfirmed session |
| 37 | **Only one person in the office all day** | Same as #35 and #36; Orelu never grants an unconfirmed session |
| 38 | **A PC marked Stays in the office is really a laptop, or is carried out** | Its confirmation of a new address tells the owner at once with **Not my office**; undo removes the address, ends the sessions and removes the mark; a second wrong confirmation in 30 days removes the mark automatically |
| 39 | **Login shared with a colleague, or one person signed in on two PCs at once** | One active session per person: a new sign-in ends the previous one; repeated parallel sign-ins alert the owner |
| 40 | **Private / incognito browser window** | Can't keep the PC's device key, so it is treated as an unapproved PC; staff are told to use a normal window |
| 41 | **Coworking space or shared building internet** | Other tenants share the address, so an approved PC and the firm's own logins are still required for everything; the stated limit in §5.8 applies |
| 42 | **A deputy approving their own request** | Not allowed: only the owner or the other deputy can approve it |
| 43 | **Orelu itself is down** | Fails closed: nobody can open data; the owner is emailed and a status page shows progress; the files stay safe in the firm's drive |
| 44 | **A manager raises a request, or tries to approve their own request, a delete, a device or a network** | A manager's own request goes to the owner or a deputy; there is no Approve button for their own requests, deletes, "always allow", devices or networks; the server refuses a forged attempt and logs it |
| 45 | **The team's manager is away, or the employee has no manager** | The request shows on the owner's dashboard at once; the owner and deputies get a phone notification after 30 minutes unanswered (immediately when there is no manager); it still expires after 4 hours |
| 46 | **An employee renames many files, or renames one wrongly** | Only document type and period can change; old and new names are on the document timeline; a manager or the owner undoes it in one click; many renames in a short time alert the owner |
| 47 | **The owner changes role permissions in Settings while staff are working** | Applies on the next request; a removed right stops at once; every change is logged; a grant never widens where or when (PC, connection and hours still apply) |
| 48 | **Personal laptop or phone, at home or in the office** | Refused before any client data is shown; the request goes to the owner or a deputy only; an approval is for one person, one device, an end date, view-only |
| 49 | **Approved laptop leaves the office mid-session** (closed, reopened elsewhere) | The next request comes from a different connection and is refused |
| 50 | **A PC without chip-bound sessions or a device-bound passkey** (Mac, other browsers, older PCs) | Approved and used normally on the signed-request key; it cannot be marked Stays in the office and cannot confirm a changed address; a copied browser profile still fails the connection check |
| 51 | **The owner or a deputy taps Allow without reading** | Messages name the person, PC and connection; device and network approvals default to "today"; a weekly summary lists every approval; any approval can be withdrawn at once |
| 52 | **The office address changes several times a week** | Each change is confirmed by rule 1, 2 or 3 in §5.8; after 3 taps in 14 days Orelu suggests a fixed address by itself; nothing needs measuring or configuring by Orelu's team |
| 53 | **Staff press Print Screen, use a snipping tool or photograph the screen** | A website can't block it. The page blanks on Print Screen, every page carries the tiled watermark, the attempt is logged and repeats alert the owner; firms that need real blocking use a managed browser (§5.17.2) |
| 54 | **An employee tries to change a figure or approve a form; a manager approves a form they checked themselves** | An employee can only confirm or reject a line; changing a figure is a request. When every line is confirmed the form is approved and downloadable. Where the firm has switched on second approval, the manager, partner or owner who gives it must be a different person from the one who did the yes/no check |
| 55 | **Staff signing in on an approved PC in the office** | Email code only (D41); the same person on any other device or connection is refused, or needs the phone code where the owner allowed remote work |
| 56 | **Someone in the office reads a colleague's email code** | Each login is the person's own address, never the firm's shared mailbox; the code expires in minutes and works once; a sign in ends the person's other session and the owner is alerted on repeats |
| 57 | **An approval email opened by a mail scanner** | Nothing happens: the email's buttons only open the request in Orelu, where a signed-in owner or deputy presses Allow |

#### 5.17.2 Permissions: everyone sees every client, view only; managers approve, the owner decides the rest

- **Who sees what (default):** every employee, front-desk user and manager can see **every client's folders** and open **any document**, including sensitive ones (identity, bank, financial statements, audit reports). Visibility is `open` by default (§5.9); `restricted` remains an optional owner setting.
- **How they see it: view only.** Documents open in Orelu's viewer: every page, spreadsheets included, is rendered as an image **on the server with the user's watermark drawn into the image itself**, never laid over it in the browser, so it can't be removed with the browser's own tools; spreadsheets shown read-only; no download, print, copy, share or link buttons. No other file and no link ever reaches the PC.
- **Screenshots and photos, stated plainly:** no website can block the operating system's screenshot tools or a phone camera, so Orelu deters and traces instead of promising prevention.
  - **Tiled watermark:** the viewer draws the user's name, date and time repeatedly across every page, so any screenshot, crop or photo carries it.
  - **Capture deterrents:** printing is off and prints blank; right-click, text selection and drag are off; a Print Screen key press blanks the page for a few seconds and, where the browser allows, clears the clipboard.
  - **Logged and alerted:** each suspected capture attempt is written to `activity_log` (`capture_attempt`); repeats alert the owner.
  - **Optional, off by default:** "Hide documents when Orelu is not the active window" (per firm or role). Off by default because staff read a document in Orelu while typing in the portal or filing software beside it.
  - **For firms that need real blocking:** a managed browser on the office PCs with screenshot protection (for example Chrome Enterprise Premium) is the firm's own purchase and setup; Orelu documents the steps but cannot do it for them. Showing documents through video DRM was considered and left out: it blocks capture only on some PCs and browsers.
- **Built-in exception 1: rename.** Employees and managers may correct a document's **type** (from the catalog and the firm's saved types) and **period**; Orelu rebuilds the canonical name (§5.5.0).
  - The file may move to the matching work-type or financial-year folder of the **same client**; the stable id, contents and version are unchanged; nothing is re-read; 0 AI credits.
  - Not changeable this way: the client, received date, contents, version number, or the names of prepared and filed forms (§5.7.4). Moving a file to another client is a request.
  - Accepting or correcting the suggested type and period on a `To check` file is a rename, so employees can clear `To check` without a request.
  - A name clash gets the short id; a match with an existing document is flagged as a possible duplicate (§5.5.0).
  - Every rename is in `activity_log` and on the document timeline (old name, new name, who, when); a manager or the owner can undo it in one click; many renames in a short time alert the owner.
  - A rename updates that client's remembered mapping (D29); an undo reverses it.
- **Built-in exception 2: approved filing files.** An employee can download the **approved** version of a prepared form (official GST / ITR file or TaxPower / KDK Spectrum import file, §5.7.4) to upload it on the portal or into the filing software: only after approval (every figure has passed the yes/no check, plus the second approval where the firm requires one), only under the employee's access policy (in the office for Office only), through a single-use link, and logged. Drafts and source documents stay view-only.
- **Built-in exception 3: the filing work itself.** Every employee may confirm or reject extracted figures line by line (the yes/no check; they cannot type a different value), mark a prepared form as filed, and attach its acknowledgement or enter its number, including confirming a portal confirmation that Orelu matched from the mailbox. Each of these is logged with who and when. The yes/no check is the approval: when every figure has passed it, the filled form is ready and the employee downloads it for the portal (exception 2). Changing a figure stays a request.
- **Default rights by role** (the owner can change the Employee and Manager columns in Settings → Permissions):

| Action | Employee (staff, front desk) | Manager | Owner (admin) |
|---|---|---|---|
| See every client folder; open any document (view only, watermarked) | Yes | Yes | Yes |
| Rename (correct document type or period) | Yes, logged | Yes, logged | Yes |
| Download the approved filing file | Yes | Yes | Yes |
| Confirm or reject extracted figures (the yes/no check, which approves the form) | Yes, logged | Yes, logged | Yes |
| Mark a form filed and attach its acknowledgement | Yes, logged | Yes, logged | Yes |
| Add recognised portal files (GSTR-2B, Form 26AS, AIS, acknowledgements; §5.3.1) | Yes, logged | Yes, logged | Yes |
| Second approval of a prepared form, only where the firm has switched it on | No | Yes, for their team's work | Yes |
| Change a figure, upload other files, download other files, send or share with a client | Request | Request | Yes |
| Approve everyday requests | No | Yes, for their team, once; never their own | Yes, all |
| Delete (30 days in the Deleted folder) | Request, owner only | Request, owner only | Yes |
| Give standing ("always allow") permissions | No | No | Yes |
| Bulk download or export | No | No | Yes |
| Settings, hours, devices, access policies, billing | No | No | Yes |

- **Owner and manager stay different:** a manager's only extra rights over an employee are approving their team's everyday requests and, where the firm has switched on second approval, their team's prepared forms. Partners follow the Manager column unless the owner grants more; a partner named as a deputy (§5.17.4 #18) approves like the owner.
- **The owner (admin) can do everything**; settings, access policies, devices, permissions, deletes and exports stay owner-only.
- **Settings → Permissions (owner only):** shows the table above with a switch per row for Employee and for Manager. A new firm changes nothing and gets the defaults.
  - **Can switch on**, for a role or one person, optionally limited to some clients and an end date: edit figures and prepare forms; upload; download other files (one at a time, watermarked); send or share with a client; for managers, more request types to approve.
  - **Can switch off:** rename; adding portal files; the yes/no check and marking filed for employees; a manager's right to approve requests. **Second approval** of forms is its own switch, off by default.
  - **Never switchable (owner only):** approving deletes; bulk download and export; settings, hours, devices, access policies and billing; giving permissions to others; approving your own request; editing or deleting logs.
  - A grant widens **what** a person may do, never **where or when**: under Office only, granted actions still need an approved PC, the office connection and office hours. Read-only billing status (§5.14.1) overrides every grant.
  - Every change is logged in `activity_log`; **Reset to defaults** restores the table.
  - **View + prepare forms** (More options) stays as a one-tap shortcut that switches on "edit figures and prepare forms" for employees.
- **Requests:** the employee taps Request (edit figures, upload, download, send, delete) on one file or action and may pick a reason code.
  - **Routing:** an employee's everyday request goes to their team's manager. An employee with no manager, and any manager's own request, go to the owner or a deputy. A delete request, or a request for "always allow", goes to the owner or a deputy only.
  - **Answers:** a manager may Allow once or Refuse. The owner or a deputy may Allow once, Always allow for this person, or Refuse.
  - **Notifications:** the approver is notified **instantly** (phone notification from the website saved to the home screen, email and a dashboard alert; there is no app to install). **Allow and Refuse in an email only open the request in Orelu:** the approver must be signed in and press the button there, because mail security scanners open every link in an email by themselves, and a link alone must never approve anything. Manager-routed requests also show on the owner's dashboard; the owner and deputies get a phone notification only if one is still unanswered after 30 minutes.
  - A one-time grant covers that use and lapses after use or 1 hour; an unanswered request expires after 4 hours; requests are rate-limited per person; nobody approves their own request.
  - A manager approves inside Orelu under their own access policy (in the office and in office hours under Office only); the owner approves from anywhere.
- **Standing grants (owner only):** for a person or role, optionally limited to some clients and an end date (e.g. a partner may download approved filing files).
- Every request, grant, refusal and use is logged in `activity_log`; the owner sees all grants and all manager approvals in Settings → Permissions and can revoke any at once.
- Client-facing sends that Orelu makes on its own (routine record replies, acknowledgements, reminders) don't need an employee permission; sensitive sends still need an approver.
- Prepared forms (§5.7.4): adjusting figures needs "edit figures and prepare forms"; downloading the approved filing file is allowed for every employee (built-in exception 2).

### 5.18 AI account, usage and limits

- **Orelu owns the AI account;** firms never bring or see an API key. All calls go through `/src/ai/providers` from the server. Separate OpenAI projects for `production`, `staging` and `evals`, each with its own key and spend limit.
- **When AI runs:** triage labels only for client emails that rules and confirmed mappings leave unresolved or conflicting (D29, §5.5); replies and document lookups for the assistant; **the deterministic extraction pipeline runs automatically on data emails** (GST, income-tax, tax-audit labels) for clients with that service, and on demand when staff start a form, with an AI step only for unresolved fields. The first import of past files is placed from folder names first; AI reads only files it cannot place.
- **Cost control:** cheapest model that passes the evals for each job (`gpt-5-nano` for unresolved labels and optional reminder personalisation, `gpt-5-mini` for unresolved extraction and replies); spreadsheets and utility files are parsed without AI; scans are read page by page with a page cap per document.
- **AI credits.** Every AI action spends credits from the firm's monthly allowance (§5.14). Weights are set from real token counts **including reasoning tokens** (GPT-5 mini and nano bill them as output), so that one credit covers at most about ₹0.05 of model cost; every job has a fixed reasoning effort and `max_output_tokens`, so no single action can run far past its weight. The workspace and returns figures only size the plan: they do not predict pages or AI usage. Before Paresh bhai's plan is fixed, measure representative scans, PDFs, spreadsheets, emails, retries and page counts; adjust his allowance or price if 81,000 credits does not cover measured use with headroom.

| Action | Credits |
|---|---|
| Email classified by AI after rules and mappings are unresolved; attachments filed | 1 |
| Smart reminder personalised by AI (only if the firm enabled it and no approved template fits; `gpt-5-nano`, dates checked in code) | 1 |
| Page read for figures, now (PDF or scan) | 8 |
| Page read for figures, overnight (flex processing, half price; results by next morning) | 4 |
| AI reply to a client email (lookups included) | 6 |
| File placed by AI during the first import | 1 (from the setup allowance) |
| Rule/mapping email classification; indexed document search; cache hit; duplicate detection | 0 (no AI) |
| OCR; spreadsheet, Tally export or utility file parsed | 0 AI credits (compute is separately metered and capped) |
| Template reminder; rule-based filing | 0 |

- **Weights are checked against reality:** the ledger stores the actual cost of each action beside its credits; the admin console alerts if a week's cost per credit goes above ₹0.05 for any action, and weights are re-set (for new periods only) when model prices or measured usage change. Measured in the pilot before launch.
- **Overnight reading:** non-urgent extraction (the first import, bulk scans, data not needed today) runs overnight with OpenAI **flex processing** (`service_tier: "flex"`): an ordinary synchronous Responses call with `store:false`, priced at Batch rates, so it stays within D13 (the Batch API itself is not used: it stores files and isn't covered by zero data retention). Staff can choose "read now" for urgent work. Confirm in M0 that `gpt-5-mini` is on OpenAI's flex list; if not, overnight pages cost 8 credits like the rest.
- **Reserve, then settle:** before each AI call the server reserves the action's maximum credits in `usage_ledger` (an atomic check against the balance; `max_output_tokens` is set on every call) and settles to the actual afterwards. No reservation, no call: this is the only path into `/src/ai/providers`.
- **Pausing in order:** at 80% the owner is alerted. At **90%** the last 10% is kept for sorting emails and notices: automatic extraction and AI-written reminders pause (reminders go out as templates; staff can still start extraction by hand). At **100%** all AI stops: emails are still filed by rules (known sender → that client's `To check`), notices are flagged by keywords, and client questions go to Needs team reply. Nothing is lost; paused work shows on the dashboard.
- **Rollover and top-ups:** unused credits roll over for one month (balance capped at 2× the monthly allowance), so quiet months cover the September tax-audit peak. The owner can buy a top-up by Razorpay link, or switch on auto top-up with a monthly maximum (default off). Top-ups last 12 months. Monthly blocks and top-ups together stay inside the plan's AI block cap (§5.14).
- **Runaway guards:** at most 20% of the monthly allowance in one day unless the owner raises it; at most 3 AI replies per email thread per day; at most 30 AI-read pages per document (staff choose pages beyond that); per-contact rate limits (§5.11).
- **Orelu-wide guards:** a global daily AI spend cap (`AI_GLOBAL_DAILY_CAP_USD`) pauses all AI and alerts the Orelu team; each OpenAI project has its own budget alert. The ledger, not the provider's dashboard, is the source of truth.
- Usage per firm is shown in the admin console to check plan margins during the pilot.

### 5.19 Future add-ons: WhatsApp assistant and AI calls (designed now, not built)

- **Future features**, not in the launch (D3); designed now so the channel layer, meters and plan builder already have room for them.

- **Sold as monthly packs.** The firm owner buys them in **Settings → Plan and add-ons** (and can tick them in the Custom plan builder): a WhatsApp pack (a number of messages a month) and an AI call pack (a number of minutes a month). Paid by Razorpay link like every other add-on. Clients have no login, so the firm buys the pack; it may pass the cost on through its own invoices to clients.
- **A pack is a hard limit.** When it runs out, that channel stops and work falls back to email; nothing is charged on top. The owner can buy another pack at once or turn on auto-renew with a monthly maximum (default off). Unused messages or minutes roll over for one month. The dashboard shows what is left; the owner is emailed at 80% and 100%.
- **WhatsApp assistant:** official WhatsApp Business Platform only (Meta Cloud API, with Orelu registered with Meta as a technology partner). The firm connects its own number. Meta charges per message (India from 1 Oct 2026: about ₹0.115 for utility, authentication and service messages, about ₹0.86 for marketing); the pack price includes this. Whether Meta's fee is carried through Orelu's partner credit line or the firm's own Meta payment method is settled at build time (§12). Orelu sends only utility templates (reminders, document ready, receipts) and replies inside the 24-hour window; no marketing templates. The pack covers the AI for WhatsApp replies, so it doesn't use the plan's AI credits. Same rules as email: no message text stored (D6), same guardrails and Needs team reply. Never unofficial WhatsApp or WhatsApp Web automation.
- **AI phone calls:** outbound reminder calls and inbound "what is my status" calls through a telephony API (e.g. Exotel or Plivo) with an Indian-language voice AI, costing Orelu about ₹5–8 a minute in all (telephony about ₹0.55–1.15 plus voice AI about ₹4–7). Limits: at most 4 minutes a call; an owner-set daily cap; calls only 10:00–19:00 IST, only to verified contacts of existing clients; the voice says it is an automated assistant for the firm; opt-out honoured; never asks for OTPs, passwords or payments. No recording or transcript is stored, only the outcome code and duration. Telecom rules (TRAI commercial-communication rules, registered numbers, DLT where required) are confirmed before building (§12).
- **Reserved now:** `whatsapp` and `voice` values in the channel enum on `jobs` (unused at launch); meters `wa_message` and `call_minutes` in `usage_ledger`; hidden pack switches in the plan builder and the add-ons page.

### 5.20 Features planned after launch (designed now, not built)

- **Not in the launch (D40).** Seven additions chosen on 10 Oct 2026 from what competing practice tools sell and what CA firms say costs them time. Written here so the data model and the reminder engine keep room for them.
- **Rule for all seven: nothing outside Orelu.** Each feature gets its data only from the firm's mailbox, the firm's drive, the portal files drop box (§5.3.1) and dates the firm enters. No paid data provider and no restricted programme. Never a portal password or OTP (D39).
- **No AI credits by default.** Every item below is dates, lists and fixed templates. AI is called only when a document cannot be read by rule, with a reason code, as everywhere else (D24, D29).
- **Price to the firm: not decided.** Whether these are included in every plan is a business decision still to make; nothing here assumes either way.

| # | Feature | What the firm sees | Where the data comes from | Limits to state plainly |
|---|---|---|---|---|
| 1 | **DSC expiry tracker** | A list of clients' and partners' digital signature certificates with expiry dates; reminders to the firm, and to the client if the owner allows, well before expiry | The validity dates inside the certificate of any digitally signed PDF that passes through Orelu, read by rule; otherwise staff enter the date once | Covers only signatures Orelu has seen or been told about. Reading the dates from real Indian DSC-signed PDFs is **not yet tested** |
| 2 | **Notice register** | Every tax notice in one list: client, type, date received, reply due date, who is handling it, status, days left | **Income tax:** the department emails the section 143(1) intimation as a password-protected PDF whose password is the PAN in lower case followed by the date of birth or incorporation (DDMMYYYY); Orelu holds both for the client, so it opens the file itself. **GST:** the email is only an alert, so Orelu logs it and gives staff a task to download the notice and drop it in (§5.3.1); the reply date is then read from the file | Only notices that reach the firm's mailbox or are dropped in. A notice that exists only on a portal is unseen until staff drop it. The PAN and date-of-birth rule is from press guides, to be confirmed on real intimations |
| 3 | **Owner's morning summary** | One email each morning (and the same block on the dashboard): what came in yesterday, what is due this week, what is stuck, open notices | Orelu's own records | Sent through Orelu's system email, the only running cost. The owner can switch it off or choose the hour |
| 4 | **UDIN register** | Every certificate and audit report with its UDIN, signing partner and signing date; a reminder before day 60 when a UDIN is missing | Staff enter the UDIN when marking a document signed, or Orelu reads it from the signed report where it is printed. Orelu checks the format itself: 18 characters, two digits of the year, the partner's six-digit membership number, then ten letters and digits | Orelu cannot confirm a UDIN with ICAI (no public interface found); it checks the format and the dates only |
| 5 | **"Same as last year" checklist** | At the start of each period every client's paper list is prepared from what that client sent in the last one; reminders then go only for what is missing (§5.2) | Orelu's own records of documents received | A client whose work changed needs staff to adjust the list. Check overlap with the carry-forward already in the reminder design before building |
| 6 | **Renewal reminders** | Licences, registrations and other items with an end date, per client, with reminders to the firm and the client | Dates the firm enters; or a "valid till" date read by rule from a document that passes through, where the layout is known | Orelu does not know a renewal exists unless a date was entered or a document was seen |
| 7 | **Due-date changes** | When a government due date moves, the firm's calendar and reminders move with it, and the owner can tell every affected client in one click with a fixed template | Orelu keeps one shared table of statutory dates. An Orelu person confirms each change once and it applies to every firm. The Income Tax Department's public press-release feed is watched as a prompt; GST changes are entered by hand (no free feed found) | **Never applied without a person at Orelu confirming it**, because a wrong date is worse than a late one. A firm can override a date for itself |

- **Left out of these seven.** Direct portal integration stays a separate later option (§2, After launch) and none of the seven depends on it. Automatic fetching of notices, filing status or returns from the GST portal (possible only through a licensed GST Suvidha Provider, billed per call, with each taxpayer's OTP consent) and from the income tax portal (needs registration as an e-Return Intermediary with an auditor's certificate on Orelu's systems and an approved server address). Also left out: a vault of clients' portal passwords, which competitors offer and D39 forbids.
- **Data model.** No table is added now (D34). At build time these are expected to fit existing structures: dated items and their reminders in the reminder and job tables, notices as documents with a due date and an owner, the shared statutory dates as one platform-level table. The exact columns are decided when the feature is built.
- **Order to build, by value against effort:** notice register, DSC expiry tracker, morning summary, then UDIN register, checklist, renewals, due-date changes.
- **Sources read on 10 Oct 2026** (competitor listings and ICAI pages; mostly vendor material, no survey of Indian CA firms was found): Vider ATOM and ATOM Pro, MyTask, QwikCA, Turia and Jamku feature listings; ICAI UDIN FAQ and the 60-day time limit; Income Tax Department e-Return Intermediary pages; GST Suvidha Provider pages; a CAclubindia thread where one practitioner puts document collection at 30 to 40 percent of total effort.

---

## 6. Data model

**Rules (D34: minimal by design):**
- **One table per real thing.** A kind, status or stage is a column, never another table.
- **Nothing is stored twice.** A value that can be read from another row is read with a join, a view or a function; it is not copied.
- **Small settings live in one `settings` or `details` jsonb** on the row they belong to, each with a zod schema and tests; no side tables for settings.
- **Who did what, and when, is in `activity_log` only.** Other tables do not repeat `approved_by`, `confirmed_at`, `last_seen_at` and the like.
- **The one deliberate repeat is `firm_id`** on every tenant table, because row-level security depends on it. No table has `updated_at`, and `created_at` sits only where a rule needs it (a pending firm is removed after 7 days): when something changed, and who changed it, is read from `activity_log`. A row that is never addressed on its own (a log line, a membership) has no surrogate `id`; its natural key is the primary key. A firm is reached through its member row, not a web address, so app routes carry no firm slug (step 2, 14 Oct 2026).
- **Before adding a table or a column,** show that it cannot be a kind, a jsonb key or a view.
- **30 tables** (71 before this rule).

**Security rules (unchanged):**
- RLS by firm membership on every tenant table; client-scoped tables also use `can_access_client(client_id)`.
- Separate SELECT/INSERT/UPDATE/DELETE policies by role and scope, `WITH CHECK` on writes, composite foreign keys `(firm_id, id)`, protection against self-escalation.
- **Staff roles have no DELETE policy on documents.**
- Access rules (§4.4, §5.17) are enforced in the app and re-checked in RLS through a session claim `access_ok` (with the allowed capability), set only by the server after the checks pass.

| Table | Columns | Replaces |
|---|---|---|
| `firms` | name, gstin, state_code (only when there is no GSTIN; a GSTIN starts with the state code, read with `firm_state()`), status (pending/active/grace/read_only/suspended/closed), created_at, settings jsonb (legal name; reminder stages, quiet hours, reminder_writer `ai`\|`template`; activity_log_months 12\|24\|36, default 36; client_visibility `open`\|`restricted`, default `open`; ai_enabled; auto_send_auto_docs; holidays; firm-wide and per-role access rules (§4.4); role permission defaults (§5.17.2); enquiry forms (§5.12)) | `signups`, `office_holidays`, `role_permissions`, `lead_forms`, firm and role rows of `access_policies`, the billing grace state |
| `groups` | firm_id, kind (branch/team/client_group), name, settings jsonb (a branch's own access rules and office hours) | `branches`, `teams`, `client_groups`, `office_hours`, branch rows of `access_policies` |
| `firm_members` | firm_id, user_id (together the primary key), role, branch_id, team_id, status (invited/active/deactivated), access jsonb (only when this person's rules differ) | `team_members`, user rows of `access_policies` |
| `client_assignments` | firm_id, client_id, user_id or team_id, role (partner_in_charge/manager/staff) | — |
| `office_connections` | firm_id, branch_id, ipv4, ipv6_prefix, status (confirmed/fixed/today_only/removed), confirmed_by_kind (owner_switch_on/owner_tap/deputy_tap/fixed_address/trusted_pc/family_continuity), expires_at | — |
| `devices` | firm_id, user_id (null for a shared office PC), kind (stays_in_office/laptop/personal), public_key, passkey_id, session_binding (dbsc/signed_requests), label, status (pending/approved/refused/revoked/expired), valid_until | `registered_devices`, `device_requests` |
| `requests` | firm_id, kind (permission/delete/remote_access/team_reply/support_access/alert), raised_by, client_id, entity_type, entity_id, reason_code, assigned_to, status (pending/approved/refused/expired/used/revoked/done), expires_at, details jsonb (by kind, below) | `permission_requests`, `permission_grants`, `delete_requests`, `remote_access_requests`, `team_reply_requests`, `support_sessions`, `alerts` |
| `activity_log` | firm_id, actor_id, action, entity_type, entity_id, at, details jsonb; no id, since a line is never addressed alone (changed field names; old and new name for a rename; ip; device id hash; watermark id; office-connection address and wait time; AI model, tokens and latency; never content); append-only, no update or delete grant for any role; partitioned by month, with the partitions in a `private` schema the API never exposes; once a day a firm's rows past its `activity_log_months` are removed and whole months past 36 are dropped | `audit_log`, `access_log`, `office_connection_events`, `document_reclassifications`, `ai_runs` |
| `clients` | firm_id, branch_id, group_id, name, kind (individual/business/tax_audit/company/llp/trust), stage (lead_new/qualifying/proposal/client/lost/cold), email_enc, email_bidx, state_code, notes_enc, details jsonb (enquiry fields: service, urgency, score), archived_at (M1 step 1 built id, firm_id, name and kind; each other column arrives with the step that uses it) | `leads`, `client_group_members` |
| `client_registrations` | firm_id, client_id, kind (pan/gstin/tan/cin/llpin), number_enc, number_bidx, state_code, scheme, services text[] (compliance codes) | `client_gstins`, `compliance_subjects`, `client_services`, the PAN columns on `clients` |
| `contacts` | firm_id, name_enc, email_enc, email_bidx, language | — |
| `contact_clients` | firm_id, contact_id, client_id, relation, can_view_status, can_receive_documents | — |
| `compliance_types` (global) | code, period_key (empty = the default rule; set = a government extension for that period), name, frequency, due_rule jsonb, source_url, verified_on, approved_by (the CA who checked it), effective_from, effective_to | `due_date_overrides` |
| `tasks` | firm_id, client_id, registration_id, kind (compliance/notice/review_deadline/work_request), code, period_key, due_on, status, assigned_to, document_id, details jsonb (notice: authority, custom name, reference number and date received; filing: filed on and acknowledgement number; sensitive values encrypted) | `compliance_tasks`, `notices`, `work_requests`, the filing columns of `outputs` |
| `document_requests` | firm_id, client_id, task_id, upload_token_hash, expires_at, status, items jsonb (document type or custom name, status, document_id) | `document_items` |
| `documents` | firm_id, client_id, registration_id, direction, work_type, document_type, custom_name_enc, period_key, stable_short_id, version, parent_document_id, share_policy, drive_file_id, original_filename_enc, detected_mime, size, sha256, fingerprint, status (quarantined/waiting_for_drive/to_check/filed/draft/approved/rejected/deleted/changed_outside/missing), source (upload/email/migration/staff/system/generated), source_ref, details jsonb (text artifacts: kind `parsed_text`/`ocr_text`/`page_map`, engine and version, languages, confidence, the key of the encrypted text in Orelu's workspace store; safety copy: its key in the workspace store and the day it is removed; generated forms: dataset_id, template, target, checks_passed, change_reason_code) | `document_artifacts`, `outputs` |
| `document_search_tokens` | firm_id, document_id, token_bidx (keyed HMAC), field_scope, position_bucket; no plaintext extracted text | — |
| `document_mappings` | firm_id, client_id, source_signature, work_type, document_type, period_rule; reusable only inside the same firm and client | — |
| `shares` | firm_id, document_id, contact_id, email_event_id (when it answers an email), delivery (attachment/link), status (pending_approval/approved/sent/rejected/expired), link_token_hash, link_expires_at; rendered text is not stored | `document_shares`, `reply_drafts` |
| `connected_accounts` | firm_id, branch_id, kind (mail/drive), provider, address_enc, identity_hash (a platform-keyed hash of the address, so the same mailbox or drive account in two firms can be found, D38), credentials_enc, sync_cursor, status (connected/needs_reconnect/removed), settings jsonb (mail: hosts, capture_enquiries; drive: root folder id, sharing last checked) | `email_accounts` |
| `email_events` | firm_id, account_id, provider_message_id, thread_id, contact_id, received_at, label, decision_source (`rule`/`confirmed_mapping`/`ai`/`staff`), reason_code, outcome_code, status; **no subject, body, sender copy or attachment payload** | — |
| `datasets` | firm_id, client_id, form_code, period_key, source_document_ids, source_kind (tally_export/excel/pdf/scan/email_text), fields_enc (jsonb, encrypted), line_status jsonb, status (extracting/draft/confirmed/rejected) | `extraction_jobs` |
| `templates` (global) | form_code, version, period_scope, source_url, file_sha256, effective_from, effective_to, status, validation_rules jsonb, mappings jsonb (per target official/taxpower/kdk: the mapping and tests_passed_at) | `template_versions`, `template_mappings` |
| `platform_settings` (global, admin only) | key (plan_formula/tax/document_types/notice_types), version, active_from, value jsonb. `plan_formula`: presets (code, price_paise, users_included, workspace_gb_year, returns_year, ai_credits), user_addon_paise, custom_rule (from_users, from_workspace_gb, user_slabs [up_to, paise], work_slabs [up_to, paise], returns_per_gb, ai_credits_per_gb, min_margin), rounding_rule, ai_block (credits, paise), block caps, fit_enforced (off until the sizes are measured), growth_cushion (share over the plan allowed within a year), estimator (returns per client for each practice type), workspace_counting_rule (what counts, with its own version), setup_rule, addon_prices, yearly_months. `tax` (D32): registered, gstin, state_code, sac_code, effective_from | `plan_formulas`, `plans`, `orelu_tax_settings` |
| `subscriptions` | firm_id, razorpay_customer_id, razorpay_subscription_id (a subscription id for card firms, a mandate token id for UPI AutoPay and eNACH firms), formula_version, cycle (monthly/yearly), method (card/upi/emandate), status (created/authenticated/active/pending/halted/cancelled), current_period_end, plan jsonb (plan code, extra users, workspace GB a year and returns a year for Custom, extra AI blocks, add-ons, the owner's cap, the mandate's maximum amount) | `firm_plans`, `billing_subscriptions` |
| `payments` | firm_id, kind (plan/renewal/extra_user/ai_block/topup/addon/setup/refund), amount_paise, gst_paise, fee_paise, fee_tax_paise, razorpay_id, event_id, refund_of, reason (refunds: money_back/duplicate/charge_error), invoice_no, status, settled_at | `plan_payments`, `plan_refunds` |
| `guarantee_claims` | identity_hash (one row each for the PAN, GSTIN, mailbox and owner-email hash), claimed_at; no firm data; outlives firm deletion to enforce once per firm (D33) | — |
| `usage_ledger` | firm_id, meter (ai_credits/setup_credits/workspace_bytes/download_bytes/system_email/wa_message/call_minutes), quantity, kind (grant/reserve/settle/release/rollover/topup), ref_type, ref_id, at; append-only | `usage_balances`, `storage_usage_daily` |
| `jobs` | firm_id (null for platform work), kind (reminder/send/extract/ocr/drive_save/drive_check and others), entity_type, entity_id, schedule_version, idempotency_key, run_at, state, claimed_until (the lease), attempts, last_error_code; no message content. Added by the step that brings the job kind needing them, not before: provider_id (sends) and skip_reason_code (reminders: filed, docs_received, data_received, staff_handling, paused, replied_recently). `channel` dropped: email is the only channel at launch, and the kind says it | `outbox` |
| `firm_keys` | firm_id, wrapped_key (one wrapped value: the firm's blind index key and its encryption keys, newest last; KMS keeps its own key versions inside it, and when a key was rotated is in `activity_log`) | — |

**What `requests.details` holds, by kind:**
- `permission`: capability, scope (file/client/all), grant (one_time/standing), routed_to (manager/owner), used_at. An approved request **is** the grant; a standing grant from the owner is created already approved.
- `delete`: purge_after (the day the file leaves the Deleted folder). `remote_access`: for_date. `support_access`: the Orelu user and the start time.
- `team_reply`: missing_field_codes and outcome_code; the entity is the email event; **no question or reply text**.
- `alert`: severity.

**Read when needed, never stored:**
- **Balances:** a `usage_balances` view sums `usage_ledger` per meter and period (included + rollover + top-ups − used − reserved). The reserve check takes a per-firm lock and reads this view.
- **Workspace used in the year:** summed from `usage_ledger` (meter `workspace_bytes`, written by the counting rule when a file is read). **Returns in the year:** counted from `tasks` of kind `compliance`. Neither is stored as a total.
- **Whether a file is still in the drive:** its `drive_file_id` is checked by the daily drive check and on the provider's change notices; the result is the document's status.
- **What a plan includes** (people, workspace, returns, credits): from the formula version and `subscriptions.plan`.
- **Canonical folder and display name:** a function of the client, work type, document type and period.
- **Overdue:** `due_on` has passed and the task is not filed.
- **Who approved, when, and last seen:** the latest matching `activity_log` row.
- **A person's access rules:** one function over `firms.settings`, the branch's `groups.settings` and `firm_members.access`; the most specific wins.

**Kept apart on purpose:**
- `firm_keys`, so that only the server role can read keys.
- `activity_log`, because it is append-only.
- `guarantee_claims`, because it holds no firm data and must outlive a deleted firm.
- `client_assignments` and `contact_clients`, because they are real many-to-many links.

**Simplifications this brings:**
- **One team per person** (`firm_members.team_id`); someone who works across teams is assigned clients directly.
- **A lead is a client at an earlier stage;** Won changes `stage` to `client`, nothing is copied.
- **Sign-up creates the firm row at once** with status `pending`; the first debit's webhook makes it `active`; a pending firm with no payment is removed after 7 days.
- **A sent email is a job** of kind `send`, written in the same transaction as the change that caused it.
- **Catalogues** (document types, notice types) are lists in `platform_settings`; rows store the code.

- Encrypted columns (`*_enc`) use per-firm envelope encryption (§8.4); searchable identifiers also get a keyed blind index (`*_bidx`). Encrypted values inside a jsonb are encrypted the same way.

---

## 7. Milestones

- Internal build steps; **nothing is released until M12 passes**.
- **Target (user, 7 Oct 2026):** everything, up to and including final setup at Paresh bhai's firm, within **1 month at most**, so by 7 November 2026. The scope removed from the launch (client fee billing, the beacon and same-Wi-Fi check, the tax-audit report form) is what makes that possible; the acceptance checks below still decide the date. **Re-check needed (8 Oct 2026):** moving client files to the firm's own drive (D36) and re-basing the plans (D37) replaces the upload tool and the per-firm storage work with drive adapters; the date is confirmed only after the M0 drive spike.
- **Start now, because they have their own lead time and are outside the build:** Orelu's Razorpay account with Subscriptions and eNACH enabled (Razorpay activates it only when the website has live Terms, Privacy, Contact, Pricing and Cancellation and Refunds pages, so these go up first); OpenAI zero-data-retention approval; the lawyer's approval of the Privacy Notice, DPA and Terms; the external penetration test; the domain; and the first import of past files into the drive, which itself runs for a few days.
- **Not waiting on Paresh bhai (user, 7 Oct 2026):** the build and its tests run on a **synthetic sample pack** made by the coding agents (emails for all six labels in English, Hindi and Gujarati; Tally-style Excel and XML exports; sales and purchase registers; text PDFs and scanned-style images; bank statements; all with invented clients) plus the public official samples (the GST offline tool's templates, the Income Tax Department's schemas and utilities, Tally's own sample company data). His real sample emails and data files are needed only for the **final accuracy check** in the last week, because only they show his clients' actual layouts.
- **Import proof without him:** every generated file is validated in automated tests against the government's own schema and offline-utility rules. KDK Spectrum Cloud offers a free trial, so Orelu can run a test import there itself; no public trial of TaxPower GST was found, so that import is tested in a vendor demo or on his PC during setup.
- Each milestone is a reviewable PR (or a few); don't start one until the previous one's acceptance checks pass.
- **Real client data only after the real-data gate**, in an isolated pilot environment with consent; coding agents and dev/test environments never receive it.

### Phase 0 and the real-data gate

- [ ] Readiness register (owner: Utsav): OpenAI ZDR, Google verification/CASA (or app-password route), Microsoft admin-consent flow, Backblaze account and region (workspace store only), the access checks on OneDrive and Dropbox (personal and business accounts), AWS KMS, Office only for staff switched on and office PCs added at Paresh bhai's office, sample emails and data files from his office, one sample file from each of his TaxPower GST and KDK Spectrum (a file he imports into each today), and one test import in each. Status, evidence and next review date; no invented approval dates.
- [ ] Synthetic sample pack in `/tests/fixtures/samples` (no real client data): at least 60 emails across the six labels and three languages, Tally-style Excel/XML exports, registers, text PDFs, scanned-style images, bank statements and portal-file layouts (GSTR-2B, Form 26AS, AIS) with invented data, each with its expected label, client, type, period and figures, so parsers, triage and extraction are tested from day one
- [ ] Paresh bhai confirms: folder order (default Financial year / Client / Work type), which 2–3 forms to start with, samples of each input (anonymised emails, Tally/Excel/PDF/scans), office hours and holidays, and the checklist catalog.
- [ ] Before any real data: DPA and consent; access rules and 2FA; encryption and key checks; scan/quarantine and safe download; owner-approved support sessions; log redaction; restore and deletion drills; incident runbook; owner sign-off.

### M0: Foundation
- [ ] Next.js + TypeScript strict + Tailwind + shadcn/ui with InboxCA tokens (§9.1)
- [x] Supabase local dev, migrations, generated types; `jobs` + Supabase Cron wiring with a test harness
  - [x] Step 2 (14 Oct 2026): Supabase local dev (`supabase/config.toml`, with realtime, storage, edge functions and log analytics off, since InboxCA uses none of them) and the first migration: `firms`, `groups`, `firm_members`, `activity_log`, with row level security on each. Runs on Docker through Colima on this Mac.
  - [x] Step 3 (14 Oct 2026): generated types (`src/db/types.ts`, `npm run db:types`, checked in CI), the `jobs` table with `claim_jobs`, `mark_job_sending`, `finish_job` and `cancel_jobs` (server only), and the runner with retries (`src/jobs`).
  - [x] Step 6 (14 Oct 2026): the `/api/jobs` worker endpoint (checks `JOB_WORKER_SECRET`, runs one sweep through Supabase's API with the server key, so the app holds no database password) and the Supabase Cron schedule that calls it every minute through pg_net, only while a job is due. The worker's address and secret are read from Supabase Vault, so nothing is called until they are stored. The list of job kinds (`src/jobs/handlers.ts`) is empty until the first kind is built.
- [x] Auth, invites, roles, mandatory TOTP 2FA
  - [x] Step 4 (14 Oct 2026): sign in with a code or a link sent by email, then a 2 step code from an authenticator app, set up on first sign in (`/sign-in`, `/sign-in/two-step`, `/auth/confirm`). Only existing members can sign in: there is no open sign up, and an unknown address gets the same answer and no email. The database shows firm data only after the 2 step code (`member_role` requires `aal2`). The app's first page shows the firm and the person's role. Browser tests run the whole flow against local Supabase, its mail catcher included, in CI.
  - [x] Step 8 (14 Oct 2026): invites. The owner invites a person with a role on the People page (`/app/people`); everyone in the firm sees its people. A person new to InboxCA gets a sign in with no password, and everyone invited gets the usual sign in code email (Supabase's own invite link was dropped: it stops working once the address is confirmed, so it could not also allow a code typed on another device). After both sign in steps the person sees the invite and joins with one press. Inviting and joining go through `invite_member` and `accept_invite`, which write `member.invited` and `member.joined` to `activity_log` in the same statement; direct inserts into `firm_members` are no longer granted. An invite email that names the firm comes with Orelu's system email on Amazon SES (before launch; SES is paid, so it waits for the user's go ahead).
  - [x] Step 9 (14 Oct 2026): the owner changes a person's role, removes them (an invite not yet accepted is withdrawn; a member is deactivated and sees nothing of the firm) and brings them back, on the People page. Each change goes through `change_role`, `remove_member` or `restore_member`, which log it in the same statement; direct updates of a member's role or status are no longer granted. The owner never changes their own row and never makes another owner. What each role may do inside the firm comes with the access policies (§5.17.2).
- [ ] **Sign-up, billing and activation (D5, §5.14.1):** public sign-up with plan and billing-cycle choice and click-through acceptance of terms, privacy notice and DPA; Razorpay Subscriptions with card / UPI AutoPay or eNACH by amount; webhook-verified activation that makes the pending firm active and invites the owner; automatic renewals, failed-payment grace and read-only states, prorated upgrades, top-ups paid before they apply, invoices, daily reconciliation; admin override for pilots
- [ ] **Money-back guarantee (D33, §5.14.1):** eligibility check, self-serve cancel and refund, Razorpay refund and its webhooks, `guarantee_claims`, the read-only state and the owner's download of the client list, records and logs, the window's last day shown at sign-up and in Billing, admin refund report
- **Billing acceptance (Razorpay test mode):** a monthly plan above ₹15,000 offers eNACH by default; a top-up adds credits only after `payment.captured`; inviting a person at the user limit adds the seat only after `payment.captured`, and deactivating a user frees the seat at once; a replayed or forged webhook changes nothing; a failed renewal moves the firm to grace, then read-only, and never deletes data; cancelling AutoPay stops the next debit. Money-back: a request on day 14 refunds the first plan payment in full, cancels the mandate and makes the firm read-only; a request on day 15 is refused with the reason; a second claim from the same PAN or mailbox is refused; a replayed request creates one refund; the setup fee stays once the first import has started; a failed refund retries and alerts the admin.
- [ ] **Access policies (§5.17):** policy editor with the presets (Standard by default; Office only, Office + approved remote, Remote-friendly, Solo CA), firm/role/branch/user scopes, office connections (§5.8), PC device keys with owner or deputy approval of every new PC (batch approval on setup day), chip-bound sessions where supported, passkeys for personal and owner devices, one-click revoke, hours and holidays, off-site view-only mode, remote-day requests, idle and session limits, policy tester, logging and owner alerts
  - [x] Step 11 (14 Oct 2026): office hours, the "When" question. The owner sets hours per weekday and holidays in Settings (starting from Mon to Sat 9:00 to 18:00) and can switch on "everyone except you only during office hours". The database enforces it in `member_role` through `open_to()`, so outside hours nothing of the firm is shown or changed; the owner is never locked out; a role or a person can be excepted, the most specific setting winning. It all lives in `firms.settings` and `firm_members.access`, with no new columns. A trigger logs every change to a firm's name or settings, naming the settings that changed. Still open: see step 12.
  - [x] Step 12 (14 Oct 2026): signing in limits. In Settings the owner can sign people out after 15, 30, 60 or 120 minutes without activity and ask for the 2 step code again after 4, 8, 12 or 24 hours; both apply to the owner too, and follow the same person, role, firm order. The database enforces the session limit from the time of the 2 step code in the sign in token (`two_step_at()` in `member_role`). Only the app sees activity, so a browser timer signs out an unattended screen and a signed, person bound cookie lets the server refuse a tab reopened later. Signing out now ends only that browser's session; the sign in page says why someone was signed out. Still open: see step 13.
  - [x] Step 13 (14 Oct 2026): special hours, covering both temporary extended hours and Season hours as one idea: a date range with its own opening and closing time (`firms.settings.special_hours`), which replaces the weekly hours on every day in it; holidays still close. Added and removed in Settings; `open_to()` uses it, so the database enforces it like office hours. Still open: where (office connection, with M7), which device (approved PCs and passkeys), what (view only), presets and the policy tester.
- [ ] `/src/lib/crypto`: KMS envelope encryption, per-firm keys, encrypted columns, blind indexes, chunked file encryption, with tamper, wrong-context and rotation tests
  - [x] Step 10 (14 Oct 2026): `src/lib/crypto.ts` with per-firm key sets in `firm_keys` (made on first use, server only, deleted with the firm), the 5 minute in-memory cache, values bound to firm, record and field, blind indexes that ignore case and spacing, chunked file encryption that refuses reordered, dropped or cut off chunks, and key rotation that keeps older values readable and blind indexes unchanged. The outer key is an interface: a local key for development and tests now. Still open: the AWS KMS outer key (KMS is paid, so it waits for the user's go ahead), and the job that re-encrypts old values after a rotation.
- [ ] Workspace store on Backblaze B2 (S3 API): one private bucket, 24-hour temporary area, object lock for the 30-day safety copies; **drive adapter spike**: own-folder and whole-drive access on OneDrive and Dropbox (personal and business), the browser-to-drive uploader, the app folder, change notices, sharing read-back; file-worker spike (a 2 GB file into a drive, ZIP, streamed view from a drive) and host decision
- [x] zod env, redacting logger, Sentry scrubbing, `activity_log` (append-only; no update or delete grant for any role; retention by the firm's setting)
  - [x] Step 1 (14 Oct 2026): zod check of the server settings (`src/lib/env.ts`) and the redacting JSON logger (`src/lib/logger.ts`), with unit tests.
  - [x] Step 2 (14 Oct 2026): `activity_log` in the first migration, append only (no update or delete grant for any role, and a trigger that refuses changes even from the database owner), partitioned by month.
  - [x] Step 5 (14 Oct 2026): retention by the firm's setting. `maintain_activity_log()` runs daily at 02:00 India time through pg_cron: it makes this month's and next month's partitions, removes a firm's rows older than its 12, 24 or 36 months, and drops whole months older than 36. The partitions moved to a `private` schema, so nobody reaches them around row level security and the generated types stay the same each month.
  - [x] Step 7 (14 Oct 2026): Sentry scrubbing. Every server error (pages, route handlers, server actions, the proxy, through Next's `onRequestError`) and every job that throws is sent to Sentry with its type, its code frames and the route's pattern only; never its message, the visited path, headers or cookies (`src/lib/error-report.ts`). No Sentry SDK, so the public pages carry no extra code. Off until `SENTRY_DSN` is set, so nothing is sent or paid for in development.
- [ ] CI: lint, typecheck, unit tests, **RLS isolation test** (grows with every table)
  - [x] Step 1 (14 Oct 2026): GitHub Actions on every pull request and on main: lint, typecheck, unit tests (Vitest), build, browser tests.
  - [x] Step 2 (14 Oct 2026): a `database` job starts local Supabase, applies the migrations and runs the RLS isolation tests (`tests/db`, `npm run test:db`). It grows with every table.
- **Acceptance (permissions):** an employee with default permissions can view assigned documents but can't download, edit, upload, share, get a link or delete them, except that a recognised portal file can be added (§5.3.1); the same employee can download an approved filing file in the office (single-use link, logged) but not a draft; a one-time grant allows exactly one use and is logged; the owner can do everything.
- **Acceptance:** two firms are isolated. Under **Office only for staff**, setup takes the owner's switch and one batch approval of the PCs that sign in, then staff simply sign in; office proof works with a fixed address, with the owner's or a deputy's tap after an address change, and with a trusted fixed PC (movable devices never confirm a new address); a staff user is refused off the office connection, on an unapproved device and outside hours, and an approved laptop seen on another connection is refused with an owner message. Under **Office + approved remote**, a named user on a registered laptop at home gets view-only access within hours, and nothing outside hours. Under **Solo CA**, the owner signs in anywhere with a passkey and is locked after 15 idle minutes. Thirty office PCs are approved with one owner tap after staff first sign in on them, and any employee can sign in on any of them. Lock spikes pass: chip-bound sessions on Chrome for Windows with the signed-request fallback, the device-bound passkey check for a trusted fixed PC (rule 3 in §5.8 stays off by configuration if it is unreliable), and the IPv4-only and IPv6-only sign-in probes on a shared-address (CGNAT) line. Revoking a device ends its sessions at once. The owner can never lock themselves out. CI is green.

### M1: Client register
- [ ] Clients CRUD with client kind, GSTINs, subjects, services; CSV/XLSX import with preview and row errors
  - [x] Step 1 (14 Oct 2026): `clients` (name, kind) and `client_registrations` (PAN and GSTIN so far; the number encrypted with the firm's key and bound to the client and field, a blind index to find it and to refuse the same number twice in a firm, the GSTIN's state code). Owners, partners and managers add clients through `add_client`, which logs `client.added`; staff view only; every member sees every client (open visibility). The Clients page finds a client by name, or by a whole PAN or GSTIN through the blind index; a GSTIN is checked with its check character and gives the PAN by itself. Encryption uses a local key (`LOCAL_KEK`) in development and tests; production needs AWS KMS first. Still open: see step 2.
  - [x] Step 2 (14 Oct 2026): editing (name and kind), numbers (several GSTINs, TAN, CIN and LLPIN, each checked; one PAN per client, and every GSTIN must hold it) and archiving with restore (`clients.archived_at`; archived clients leave the list but nothing is deleted). Owners, partners and managers only, through row level security; one trigger (`log_change`) logs every change to clients and their numbers whichever way it is made, naming changed columns and the kind of number, never a number. GSTIN is optional: many small clients have only a PAN. Still open: see step 3.
  - [x] Step 3 (14 Oct 2026): import from Excel (.xlsx) or CSV with a check first. The first row names the columns (common headings such as Client name, Constitution, GST No are read); kinds are read as people write them (Pvt Ltd, Proprietor, LLP; blank means Business with a GSTIN, else Individual). Every row is checked (numbers, a number repeated in the file, a number already in the firm through the blind index) and every problem is listed by spreadsheet row; then the good rows are added in one batch (`add_clients`, which replaced `add_client`), never half added. Up to 2,000 rows a file. The spreadsheet reader is about 70 lines of our own on Node's zlib, with no package. Acceptance met for import: 500 clients with 5 bad rows imports the 500 and lists the 5. Still open: see step 4.
  - [x] Step 4 (14 Oct 2026): the client's email address (`clients.email_enc`, `email_bidx`), optional, encrypted and found by search through its blind index; not unique, since one person often writes for several clients. In the form, on the client page and in the import (an Email column). **Onboarding rule (user, 14 Oct 2026): only the name is required;** email, PAN and GSTIN are optional and the form says why they help (InboxCA recognises a client's emails and documents by them). The smoothest start is importing the list the firm already keeps (Excel, Tally, TaxPower or KDK exports); missing numbers are later suggested from the client's own documents for one tap to confirm (M4 and M6; that reading uses AI, which is paid, so it waits for the user's go ahead). Still open: see step 5.
  - [x] Step 5 (14 Oct 2026): client assignment and restricted visibility. `client_assignments` (person, and what they do: partner in charge, manager or staff; teams later); Settings → Who sees which clients (open by default, or restricted: the owner and partners see every client, everyone else only those assigned to them). Enforced in row level security by `can_access_client(firm, client)` on clients, their numbers and assignments. Owners, partners and managers assign on the client page; each change is logged. Acceptance met: in open mode every employee sees every client; restricted mode hides unassigned clients at the database level. Still open: see step 6.
  - [x] Step 6 (14 Oct 2026): teams. The owner adds and removes teams on the People page (`groups` of kind team) and puts each person in at most one (`firm_members.team_id`; removing a team clears it). A client can be assigned to a whole team as well as a person (`client_assignments.team_id`, exactly one of the two), and in restricted mode everyone in the team sees it. Team and membership changes are logged (the shared `log_change` trigger, now with the entity type as an argument). Still open: see step 7.
  - [x] Step 7 (14 Oct 2026): client groups (a family or a business group): `clients.group_id`, a group of kind client_group; removing a group ungroups its clients. On the client page pick a group or name a new one (owners, partners and managers may make client groups; teams and branches stay the owner's). The Clients list shows each client's group, and a group's link lists the whole group. Still open: see step 8.
  - [x] Step 8 (14 Oct 2026): contact persons. `contacts` (name and email encrypted, the email's blind index unique in the firm, so one person is one contact) and `contact_clients` (what they are to the client, whether they see work status and receive documents). On the client page: add a contact (an email already known links the same person), set what they may receive, remove the link. Links follow the client's visibility; owners, partners and managers change them; each change is logged. The contact's language comes with replies (M5). Still open: see step 9.
  - [x] Step 9 (17 Oct 2026): branches. The owner adds and removes branches on the People page (`groups` of kind branch) and puts each person at most at one (`firm_members.branch_id`); a client is served from at most one (`clients.branch_id`, set on the client page by owners, partners and managers). The Clients list shows each client's branch and filters by it. Removing a branch clears it from its people and clients. Each branch's own office connection, PCs and hours come with the Office only switch (M7). Still open: subjects and services (with M2), the client page tabs (each arrives with its milestone), and the active-client count (with the dashboard).
- [ ] Client page tabs: calendar, documents, notices, extraction, outputs, activity
- [x] Teams, assignment, visibility modes, branches, groups, contacts with permissions (§5.9)
- [ ] Active-client count on the dashboard (information only; clients are unlimited, §5.14)
- **Acceptance:** importing 500 clients works; invalid rows are reported; in the default `open` mode every employee sees every client; restricted mode hides unassigned clients at the database level.

### M2: Compliance calendar
- [x] Catalog seed + overrides; the generator with table-driven tests; nightly rolling top-up
  - [x] Step 1 (17 Oct 2026): `compliance_types` seeded with the statutory defaults above, **all unverified**: a rule counts as verified only with its official source, the day it was checked and the CA who approved it, and the client page marks each date from an unverified rule "Date not yet confirmed"; reminders (M5) use verified rules only. A period's extension is a row with that period_key and moves the date only once verified. Services sit on a number (`client_registrations.services`: GST returns on a GSTIN, TDS on a TAN, income tax on the PAN, LLP forms on an LLPIN) and are ticked on the client page by owners, partners and managers; services on the wrong number, two frequencies of one return, or composition with regular returns are refused. `tasks` holds the next 12 months, made when services change and topped up every night at 00:30 India time; removing a service drops its tasks not yet started, and filed tasks never change. Every member may mark a task in progress or filed (5.17.2), never move its date; tasks follow the client's visibility. AOC-4 and MGT-7 follow the AGM date and come when that date is recorded. Acceptance met for generation: a client with monthly GST, TDS and a non-audit ITR gets its 41 tasks for the 12 months. Still open: see step 2.
- [x] Calendar and tracker UI; mark filed with acknowledgement number; bulk actions
  - [x] Step 2 (17 Oct 2026): the Calendar page (`/app/calendar`, in the app bar for everyone): overdue, due in 7 days, due in 30 days (the default) and filed in the last 30 days, filtered by return, with the client, period, due date and status of each, and dates from unverified rules marked. Tick any number of returns and mark them in progress or filed in one press, each filed one with its own acknowledgement number (optional) and today's date in India; a return marked filed by mistake is marked not filed from the filed view. Row level security limits it to clients the person may see, and every change is logged. Verifying a rule (source, date, approving CA) is done in the database until the Orelu admin console (M11); the M2 acceptance's reminder half is checked when reminders arrive (M5).
- **Acceptance:** a client with GST monthly + TDS + ITR non-audit gets the right 12 months of tasks; unverified rules can't send reminders.

### M3: Email foundation
- [ ] Mailbox adapters (IMAP/SMTP with auto-detected settings, Microsoft Graph with admin consent, Zoho, Gmail OAuth behind a flag) and `fake.ts`
  - [x] Step 1 (17 Oct 2026): IMAP and SMTP. The owner connects the firm's mailbox in Settings → Firm email with its address and password (Gmail, Google Workspace and Zoho need an app password). InboxCA finds the servers from where the domain receives mail (Google, Zoho India and Zoho; Outlook and Microsoft 365 are told they connect with Microsoft sign in, which comes next), then Thunderbird's public provider list, then the usual names; the owner types server settings only if asked. Both sign ins are checked before anything is saved, always over TLS; a typed server on a private network is refused. `connected_accounts` keeps the address and password encrypted with the firm's key; members see only that a mailbox is connected and its state, and nobody reads the password back through the API. Reading starts from the next new message (no backfill). Disconnecting deletes the password at once. Libraries: imapflow and nodemailer (versions at least two weeks old). Tests run against the free GreenMail test server in CI (`MAIL_ALLOW_LOCAL` lets only the tests use it without TLS). Still open: see step 2; Microsoft Graph and Gmail OAuth.
- [ ] `mailbox.connected` workflow, no backfill, contact matching, reconnect banner, send pacing
  - [x] Step 2 (17 Oct 2026): reading new mail. Every 2 minutes each connected mailbox gets one `mail_poll` job (Supabase Cron); the worker reads only the inbox's messages after its cursor, as envelopes (never the body), up to 200 a time, and starts fresh rather than re-reading if the mailbox was rebuilt. A sender is matched by blind index against the firm's contacts and clients' own emails; mail from anyone else is skipped and nothing about it is kept. `email_events` keeps, for client and contact mail only, the provider's message and thread ids, the sender's blind index, the contact, the client when there is exactly one, and the time: no subject, body, address or attachment (D6). A refused password marks the mailbox "needs to be connected again" and stops polling. Finished jobs are removed after 7 days, failed ones after 30. Still open: the reconnect banner and owner alert, send pacing (with M5), triage (step 3).
- [ ] Metadata-only `email_events`; triage classifier (§5.5) with label correction; Needs team reply queue with Open mailbox links
  - [x] Step 3 (17 Oct 2026): triage by rules. Mail from a client or contact is opened in memory only (mailparser) for its subject, text and attachment names, and labelled by words in English, Hindi, Gujarati and Hinglish (`src/lib/triage.ts`, 0 AI credits): notice words first; files with words for one kind of data give that data label; a request for a record without files gives past or this year's records (by "last year" words or an older FY or AY); anything else, or data for more than one kind of work, is `other`. `email_events` keeps the label, who decided (`rule`, later `ai`, or `staff`) and a reason code. `other`, and mail from a contact who writes for several clients, become a Needs team reply request (`requests`, kind `team_reply`). The Inbox page (`/app/inbox`, in the app bar) lists what waits for the team, with Done once replied from the mailbox, and the latest client email, whose label anyone may correct (logged, marked Corrected). The synthetic sample pack (`tests/fixtures/samples/emails.json`, 63 invented emails across the seven labels and the four languages) is labelled 63 of 63 right; it was written alongside the rules, so the real measure is Paresh bhai's anonymised emails in the final check. Still open: Open mailbox links, AI for unresolved mail (paid, off), feeding corrections to the eval set.
- [ ] Email template registry (English, Hindi, Gujarati)
- **Acceptance:** a test mailbox connects; 50 labelled test emails are triaged with ≥ 90% correct labels and every low-confidence one goes to the team; distinctive body strings never appear in the database, storage, logs, jobs or backups.

### M4: Documents and the firm's drive
- [ ] Upload → client/registration/type/period/work type → confirm; Other + custom name; folder paths; versions; read-only originals; rename by document type or period for employees and managers, with a timeline entry and one-click undo (§5.17.2); owner-approved deletes with the 30-day Deleted folder and Orelu's locked 30-day safety copy
- [ ] File worker: temporary store, scan, conversion, reading, save to the firm's drive, ZIP limits, streamed view and download from the drive with watermark (approved filing files from §5.7.4 download without a visible watermark, logged in `activity_log`)
- [ ] Deterministic document pipeline (D29): canonical folder/name builder; raw and normalised fingerprints; parsers for PDF text, Excel/CSV, XML and supported Office/utility files; one-time OCR for image-only pages; encrypted derived artifacts; keyed search-token index; confirmed mapping reuse; per-version invalidation
  - [x] Step 11 (18 Oct 2026): finding a file by its words. After a file is filed, uploaded or renamed, a `read_document` job reads it once from the drive: PDF text with pdf.js (up to 200 pages, run outside the server bundle), spreadsheets and CSV with the sheet reader, plain text, JSON and XML (`src/lib/search.ts`). Its words, with those of its name, type and the name it came with (letters with their vowel signs and digits in any script, at most 5,000), are kept only as `documents.search_tokens`: 8-character hashes keyed with the firm's own key, in a GIN index. The text itself is never stored. The Files tab has Find, and ⌘K finds files across the clients a person may see; both hash the words typed the same way and need every word. A password-protected or damaged file is found by its name only. The pdf.js worker for the viewer is copied into `public/` on install. Still open: OCR for scans and pictures (a non-generative engine, once per file), the encrypted text kept for reuse by extraction (M6), fingerprints for changed versions, and searching across a client's files by period and type together.
- [ ] Checklists, requests, `/u/[token]` upload page, review inbox for email attachments
  - [x] Step 8 (18 Oct 2026): asking a client for files. **Ask for files** on the client's Files tab: tick from the usual lists (GST: sales and purchase bills, bank statement; income tax: Form 16, interest certificate, capital gains, investment proofs, rent receipts, bank statement; tax audit: trial balance, ledger, bank statement, stock statement, fixed asset register; the lists for the client's services come ticked, `src/lib/checklists.ts`), name anything else, and choose the period. Every member may ask. A `requests` row of kind `documents` keeps the items, the period and the hash of a private link's 32-byte token, and expires in 30 days (`requests.expires_at` and `details` added). The link is emailed from the firm's own mailbox to the client's registered address when both exist, or shown once to send by hand. `/u/<token>` needs no sign in and shows only what was asked: the client uploads a file against each item (up to 25 MB, 100 a request), it is saved into the client's folder named by the item and period, the item is ticked, and the request closes when every item has a file. The Files tab lists open requests with what has arrived. Still open: reminders for what is still missing (M5), a malware scan before a file is shown (file worker), rate limits on the link page (M11), and items for a form's portal files.
- [ ] Vault with share policies, `shares`, secure links with one-time codes
  - [x] Step 9 (18 Oct 2026): sending a document out. **Send** on a filed document (owner, partner or manager) emails it from the firm's own mailbox to the client's registered address or to a contact allowed to receive documents, as a secure link that works for 7 days and 5 downloads. `shares` keeps the document, the contact (none for the client's own address), the hash of the link's 32-byte token, its end and the downloads; the email text is not kept. `/s/<token>` names the file and offers its download, no sign in; `use_share` counts each download first and refuses an expired or used-up link; the file is always downloaded, never shown on InboxCA's address. Each send and each client download is logged. Still open: share policies (auto, approval, internal) and the one-time code for approval documents (with the records auto-reply, M5), bulk sends after the season, and password-protected PDF attachments.
- [ ] Drive connection (§5.5.1) for OneDrive and Dropbox: the three-click connect with Orelu's own setup checks, one-sentence-one-button prompts for anything the owner must do, the free-space watch, names kept inside each provider's limits, connect and reconnect, own-folder permission, folder building, save-to-drive with the 7-day wait when the drive is unreachable, the daily and change-notice watch for sharing and outside changes, owner alerts
  - [x] Step 1 (17 Oct 2026): the drive interface (`src/lib/drive.ts`: make folders, save without ever overwriting, read; paths kept inside InboxCA's own folder), the folder builder (Financial year / Client / Work type by default, or the firm's order) and the name builder (`Patel Textiles - Purchase bills - Sep 2026.pdf`, names cleaned of characters a drive refuses). Settings → Firm drive: the owner chooses the drive, reads that InboxCA can read the whole drive but touches only the folders they choose, reads what InboxCA may do, and ticks the Drive access terms (a new "Drive access" section of the Terms; the box is never pre-ticked and the server checks it); `connect_drive` saves the account and writes the `drive.consent` entry (provider, level, terms version) in one statement. Disconnecting deletes the access at once. Only a test drive on the developer's computer can be connected for now (`DRIVE_LOCAL_DIR`, tests and development only); OneDrive and Dropbox wait for InboxCA's apps (§13.2). Dropbox fixes an app's access when it is made; the development app "InboxCA Dev" was made on 17 Oct 2026 with Full Dropbox, PKCE sign in (no secret) and the scopes files.metadata.write, files.content.write, files.content.read and sharing.read. OneDrive waits for a Microsoft Entra directory (§13.2). Still open: see step 2.
  - [x] Step 2 (17 Oct 2026): Dropbox. Connect sends the owner to Dropbox's own page with a PKCE challenge (the verifier and state wait in a 10-minute, httpOnly cookie scoped to `/api/drive`); `/api/drive/callback` checks the state, exchanges the code for a refresh token, makes InboxCA's `/InboxCA` folder, and saves the token encrypted with the firm's key together with the consent. The Dropbox drive (`src/lib/dropbox.ts`) gets a short access token from the refresh token for each use, makes folders, uploads with `mode: add` so nothing is overwritten, and reads files. Settings shows Dropbox once `DROPBOX_APP_KEY` is set; there is no app secret. Tried by hand on 17 Oct 2026: a real Dropbox connected to the local demo firm, and a test file was saved into `/InboxCA/FY 2026-27/Demo Client/GST/`, read back, and a second save under the same name refused. `npm run demo` makes a local demo firm with invented data to sign in to and show the app (its 2 step key stays in `.env.local`; `npm run demo:code` shows the code). Still open: see step 3 onwards; OneDrive (§13.2).
  - [x] Step 3 (18 Oct 2026): filing email attachments. When the mail poll keeps a known client's email with attachments, it queues one `file_mail` job for it, so a slow or absent drive never holds up reading mail. The job finds the message again by its Message-ID, opens it in memory, leaves out pictures shown inside the text, and saves each file into the client's folder (Financial year / Client / Work type) as `Client - Type - Period.ext`; a taken name gets the received date, then a short id, and nothing is overwritten. Type, work and period are read by rules from the file's name and the subject (`src/lib/documents.ts`: GSTR-1, 2A, 2B and 3B, purchase and sales bills, Form 16, 26AS, AIS, bank statements, ledgers and more; a month, an FY or an AY), with no AI; a file whose type or period is not found goes under `To check`. `documents` keeps only where the file is in the drive, its type, work, period, status, size and checksum, the name it was saved under, and the name it came with encrypted; a retried job skips files already filed by checksum. The client page has a Files tab (name, work, received, Filed or To check). For now only the owner opens a file, through InboxCA's server: shown in the browser for PDFs and pictures, sandboxed, and downloaded for anything else, so a file a client sends can never run on InboxCA's address. `npm run demo:data` also saves eight invented one-page PDFs into the demo firm's connected drive, filed as the job would. Still open: see step 4.
  - [x] Step 4 (18 Oct 2026): checking files. A file under `To check` has Confirm (keeps its type and period) and Change, which opens in place: type from the list or Other with a name ("HDFC loan sanction letter"), work and period (the last 18 months or four financial years). Every member may do this (a rename, §5.17.2). The file moves in the drive to the folder and name its values give (`move` on both drives, never over another file), then `rename_document` records the new place and logs the old one in the same statement; Undo puts it back. Only the server calls `rename_document`, and nobody signed in reads where a file sits, so no one can point a document at another file in the drive. **The same document again:** a file the client already has (same checksum), or another of the same type and period, is filed under `To check` and shown with "Same file as" or "Same type and period as"; Confirm keeps both. The Inbox lists every file to check. Still open: see step 5.
  - [x] Step 5 (18 Oct 2026): uploads and removing. The owner, a partner or a manager uploads a file on the client's Files tab (up to 25 MB until the file worker takes larger ones), choosing its type, work and period; it is saved into the client's folder under its name, logged, and refused if the client already has the same file. `documents.received_at` now keeps when a file arrived, since an upload has no email. The owner removes a file (an unwanted copy, say): it moves to the drive's `Deleted and old versions` folder, `remove_document` records it and logs where it was, and "Put back" returns it within 30 days. Each night `drive_purge` sends files removed more than 30 days ago to the drive's own bin and forgets them, logging each. Still open: see step 6.
  - [x] Step 6 (18 Oct 2026): the view-only viewer (D18). A file's name opens it in InboxCA for everyone who may see the client: PDFs (pdf.js 6.3.289, drawn in the browser) and pictures are drawn page by page with the viewer's email, the firm and the time across every page, and nothing to download; other kinds say they cannot be shown yet. The server hands a file to the viewer only when it asks with its own header, as plain bytes a browser never shows by itself; only the owner opens or downloads the file itself. Every view and download is logged (`document.viewed`, `document.downloaded`). A watermark discourages copying; it cannot stop a photo of the screen, which is why it names who looked and when. Still open: see step 7.
  - [x] Step 7 (18 Oct 2026): the portal files drop box (§5.3.1, D39). **Add portal files** on Home and on each client's Files tab takes one file or many, for one client or many. A file is known by its own contents, never its name (`src/lib/portal-files.ts`): for now the GST portal's JSON downloads of **GSTR-2B** (`data.gstin`, `data.rtnprd`, `data.docdata`) and **GSTR-2A** (`gstin`, `fp` and its sections), in the layout the portal publishes, to be checked against real files in the pilot. The client comes from the GSTIN inside, found by blind index among the clients the person may see, and the month from the return period; the file is saved as `Client - GSTR-2B - Sep 2026.json` in the client's GST folder. Every member may do this. A file already there is counted, not saved again; anything else is filed under the client's To check only when the owner, a partner or a manager drops it on that client's page, and otherwise left out; the summary says which. Still open: see step 8, and Form 26AS, AIS, TIS, ITR-V and GST acknowledgements (recognisers follow once real samples are in hand), Excel downloads, password-protected files, handing figures to the parser (M6), closing "still missing" items, and each form's list of portal files it still needs. Earlier still open: spreadsheets and Office files in the viewer, removing as a request from staff and managers (with the approvals of §5.17.2), Orelu's locked 30-day safety copy (paid storage, waits for the user's go ahead), mail from a contact for several clients, and the 7-day wait while the drive is away.
  - [x] Step 10 (18 Oct 2026): the daily drive check. Each night (02:30 India time) `drive_check` reads InboxCA's folder in every connected drive once (Dropbox: the folder listing, its sharing and links, and the space left; the test drive: its files and free space). A document whose file is gone is marked **Missing in the drive** and logged; one found again is put back; one renamed or moved in the drive is followed by its id to the new name and logged as changed outside. The owner sees an alert on Home when InboxCA's folder is shared or has a link, when the drive has under 1 GB free, or when files are missing; the next check that finds all well clears it (`requests` of kind `alert`, one per firm and reason). Still open: the drive's change notices for a check within minutes, the setup ticks on Connect, a safety copy of files changed or deleted outside (paid storage), the 7-day wait for a drive that is away, and OneDrive.
- [ ] Workspace and returns meters (§5.14): the counting rule, the owner's two meters with a projection, notice and pro-rated move-up, monthly accrual for monthly payers
- [ ] First import (§5.16): the three choices (final papers, one year, everything) with size and time estimates, the folder-to-client matching screen, the browser-to-drive uploader (resumable, checksum-verified, into `Incoming`), hand-over by ticking folders (whole drive) or by the app folder (own folder), preview, approval, move and sort, undo record, the three-month limit in the first 14 days
- [ ] Portal files drop box (§5.3.1): signatures for the listed portal files, client and period read from inside the file, save to the drive, hand-off to the parser, closing the "still missing" item, the per-form list of portal files still needed
- **Acceptance:** a GSTR-2B file dropped by an employee lands in the right client's folder with the right period, feeds the GSTR-3B draft and closes its "still missing" item, while an unlisted file dropped by the same employee becomes an upload request; `scan001.pdf` can be labelled Form 16; Other → "HDFC loan sanction letter" is searchable; a staff user can't delete or overwrite an original; a 2 GB file and a 1,000-file ZIP upload and verify; a saved file lands in the right client folder in the drive and its temporary copy is gone; a file deleted through Orelu waits 30 days in the Deleted folder; a file deleted directly in the drive is copied from the drive's bin into Orelu's safety store and can be restored after the bin is emptied; a file whose bin was emptied first is reported to the owner by name; Connect stays disabled until the consent box is ticked, the box is never pre-ticked, and the `drive_consent` entry holds the owner, time, access level and terms version; a deputy cannot connect a drive; an owner sees the drive's top folders, ticks two, and only those two are sorted; an unticked folder is never opened; connecting either drive (OneDrive or Dropbox) follows the eight owner steps and ends with every setup tick green, with no step that sends the owner to look something up; a work account needing its administrator shows one ready link; too little free space shows the size needed and one link; sharing the folder with a second account alerts the owner within a day; a file renamed in the drive is still found and flagged; with the drive disconnected, new files wait and none is lost. Reopening or searching an unchanged scan reuses its encrypted OCR/index and makes no AI call; an exact duplicate makes no OCR, parser or AI call; a changed version processes only changed content; ordinary search never sends the firm's archive to an AI provider.

### M5: Email automation
- [ ] Records auto-reply (§5.5.2): automatic for `auto` documents, one-click approval for `approval` documents, password-protected PDFs or secure links, `not_in_drive` handoff
- [ ] Notice tracker (§5.6)
- [ ] Automatic filing and naming of every email attachment into the client's folder (§5.5.0), `To check` for uncertain files, naming pattern and folder order in Settings; acknowledgement emails after filing
- [ ] Smart reminders by email (§5.2, §5.2.1): pre-send checks and skip reasons, missing-items-only content, AI-written drafts with fact check and template fallback, jobs, cancellation, quiet hours, escalation, send reconciliation
- **Acceptance:** a "send my ITR for AY 2025-26" email from the registered address gets the right ITR-V automatically as a password-protected PDF; a request for financial statements waits for approval; a request from an unregistered address sends nothing; a duplicate attachment is flagged beside the existing file; a request for a file that is not in the firm's drive folder becomes a team item; filing a task cancels its reminders; a client who already emailed their GST data for the month gets no reminder for it; a client missing one of three documents is asked only for that one; an AI draft with a wrong date is blocked and replaced by the template; a crash after possible send is reconciled without a duplicate.

### M6: Extraction and government templates
- [ ] Extraction from Excel/CSV (deterministic), PDFs, scans and email text into encrypted draft datasets
- [ ] Fixed parsers for portal files (§5.3.1): GSTR-2B and GSTR-2A, Form 26AS, AIS and TIS, feeding the GSTR-3B and ITR drafts; no AI
- [ ] Review screen side by side with the source; totals cross-checks
- [ ] Template library, mappings and validators for GSTR-1 and GSTR-3B data, then ITR-1 to ITR-4; official output files
- [ ] Official-format outputs verified as importable: compared with one sample file from each of TaxPower GST and KDK Spectrum, then one test import in each at Paresh bhai's office; the self-serve column mapper for a tool's own layout (§5.13)
- [ ] Prepared forms (§5.7.4): `Prepared` folder, in-browser view, adjust → new version → re-check, approval reset, approved-only download, uploaded-edit fallback, filed → acknowledgement flow; the daily rules and forms check with self activation and admin alerts (D42)
- **Acceptance:** on Paresh bhai's anonymised samples, every generated file validates against the official utility or schema and imports into TaxPower / KDK Spectrum; no output is possible from unconfirmed data; a simulated new template version raises an alert and outputs keep using the last active version until the new mapping passes tests; a simulated version that changes no filled field activates by itself; a late return for an earlier year is built on that year's form while current work uses the new one; a simulated extension changes no date until a CA verifies it; every prepared form appears in the client's `Prepared` folder in the firm's drive; changing one figure after approval creates v2 and clears the approval; a draft cannot be downloaded for filing; uploading the acknowledgement marks the form Filed, closes the task, stops its reminders and emails the client.

### M7: Office connection and the Office only switch
- [ ] **Office connection (§5.8):** first connection from the owner's switch-on ("Are you in your office right now?"); IPv4 exact and IPv6 prefix, both learned at sign-in; changes only by fixed address, owner or deputy tap, trusted fixed PC, or one-family continuity; no unconfirmed session; **Allow this network today**; 7-day housekeeping
- [ ] **One-switch owner flow (§5.17.3):** switch, batch approval of the day's PCs, deputies named, editable suggested hours, side-door checklist; no technical words shown
- [ ] **Staff sign in (D41):** email code only on an approved PC on the office connection, through the server-set office claim that `member_role` checks; the phone code for the owner, deputies, co-admins and anyone off the office connection; the connected mailbox refused as a login
- [ ] **PC approval (§5.17):** every new PC needs the owner's or a deputy's tap (Stays in the office / Laptop / Refuse); personal devices refused until approved for one person with an end date; device-bound passkey for Stays-in-the-office PCs; chip-bound sessions where supported
- [ ] **Self-adjusting (§5.8):** office-connection entries in `activity_log`; fixed-address suggestion with the call script after 3 confirmation taps in 14 days or when no trusted fixed PC exists (thresholds in admin configuration); **Done** from an office PC records the fixed address; admin view of changes and taps per firm and provider
- [ ] Instant notifications: device and network requests to the owner or a deputy only; permission requests routed to the team's manager first and to the owner or a deputy per §5.17.2 (web push, email, dashboard); weekly approvals summary to the owner
- [ ] **Permissions (§5.17.2):** `open` client visibility by default; role defaults table; Settings → Permissions switches with Reset to defaults; request routing (manager / owner / deputy) with the 30-minute owner notification; never-switchable list enforced on the server
- [ ] **Viewer protections (§5.17.2):** tiled watermark on every page, printing off, Print Screen blanking, capture-attempt logging with owner alert on repeats, optional hide-when-inactive setting
- **Acceptance:** every case in §5.17.4 has an automated test and passes; turning the switch on, then 5 staff signing in from the office, gives the owner one "approve all" message and no technical words; the first person in alone gets in on an unchanged or fixed address with no other device on; after an address change a trusted fixed PC confirms it automatically and tells the owner, while a laptop waits for the owner's or a deputy's tap and gets no session before it; two laptops on a new connection never confirm it; an approved laptop on another connection (including mid-session), a phone, a personal laptop and any sign-in outside hours are refused and the owner told; a personal device shows no client data before approval; three confirmation taps in 14 days trigger the fixed-address suggestion; a staff edit or download request reaches their manager within seconds, and the owner's phone if unanswered after 30 minutes; a delete request and a manager's own request reach only the owner or a deputy; a manager cannot approve their own request, a delete or an "always allow"; an employee does the yes/no check on extracted figures and attaches an acknowledgement without a request, but cannot change a figure; once every figure has passed the yes/no check the employee can download the form for filing; with second approval switched on, the download waits for the team's manager, a partner or the owner; an employee can open any client's document view-only and rename it by type or period, and the rename is logged and undoable; a right switched on in Settings → Permissions still fails outside the office or outside hours; a staff member arriving late signs in on any approved PC within hours; a new or reset office PC is approved by one owner or deputy tap, never by a manager; Ask for more time extends one person's hours for that day only; turning the switch off restores the previous policy.

### M8: Client invoices and fees (not in this launch)
- Removed on 7 Oct 2026 (D30); nothing to build. The milestone number is kept so later milestones keep their numbers.

### M9: AI email assistant and leads
- [ ] Tools, typed outcomes, guardrails, rate limits, output checks, Needs team reply with AI pause (§5.11)
- [ ] Eval suite in CI
- [ ] Lead form, email enquiries, staff confirmation, board, follow-ups (§5.12)
- **Acceptance:** evals pass with 100% on handoff, privacy and injection cases; missing data creates one team item and stores no question text.

### M10: Dashboard
- [ ] KPI tiles, due this week, overdue, pending documents, open notices, drafts awaiting approval, Needs team reply, workspace and returns used, the owner-only upgrade card (§5.14), activity
  - [x] Step 1 (17 Oct 2026, ahead of M10 because the user asked for a plain start page; redesigned the same day with the sidebar frame, §9.1): **Home is "Needs you today"**: three counts that each open the list to act on (emails waiting for a reply, returns overdue, returns due in 7 days), and for the owner a **Get started** checklist (connect email, link the drive, add clients, tick services, invite the team) with one button on the next step only; it disappears once every step is done. On 18 Oct 2026 Home became the work board of §9.1 (the month's filings by return from `month_by_return`, the ribbon, four columns from late to done with one click Filed, and the mail that needs a reply). Still open: pending documents, notices, drafts, meters, the upgrade card, activity.
- **Acceptance:** numbers match hand-counted seed data for a demo firm.

### M11: Orelu admin and hardening
- [ ] Admin console: today's changes from the daily check (D42) with their sources and the firms they touch, CA verification of due dates, firms, mailbox health, failed jobs, workspace, returns and AI usage, margin per firm, plan suggestions, support sessions
- [ ] Usage limits (§5.14, §5.18): pricing formula, presets and Custom plan builder (clients, practice type and people; returns worked out by Orelu, the workspace measured and not chosen; a team of 1 to 40 does not change the price); the price list led by suggested clients, with returns, InboxCA storage a year, AI allowance and team size; user count, extra users paid first, seat freed on deactivation; `usage_ledger` reserve/settle; 80/90/100% behaviour; rollover, top-ups and auto top-up caps; AI blocks and top-ups inside the plan's AI cap; automatic plan fit from the workspace and returns measures with notice and a pro-rated move-up, and automatic Custom above Enterprise; upgrade and Switch to Custom prompts on the dashboard and in Settings with every figure worked out by the server; the owner-login and split-firm guards (D38); download and system-email caps
- [ ] AI-efficiency report (D29): calls by reason, deterministic/cache hit rate, repeated-source detection and alerts for avoidable AI calls; no AI provider entry point without a reserved credit and reason code
- [ ] Security pass against §8: RLS review, rate limits, secret scanning, dependency audit, redaction test, event-schema test
- [ ] External penetration test; restore drill; key-rotation drill; the owner's data download (client list, records, logs) and the delete-firm flow
- [ ] Compliance register (§8.1): every "before real data" row done and signed off; incident runbook drilled with the CERT-In 6-hour and 24-hour firm-notice steps (§8.10); admin accounts on passkeys or hardware keys
- [ ] **Scale check (user, 18 Oct 2026: 10 or more firms with 10,000 or more clients each):** a test firm filled with 10,000 invented clients and their 12 months of returns, every page timed; paging and true counts on the Clients list and the Calendar (both stop at 500 rows today); jobs run in parallel instead of 20 a minute in one sweep; the client visibility check made cheap for month totals (it runs once per row today); the mail library confirmed to run where the app is hosted, or mail reading moved to the file worker; Supabase compute sized from the results
- [ ] Playwright e2e across every module with the fake mailbox
- **Acceptance:** all e2e tests pass; high and critical findings fixed; written security checklist complete; the builder's price equals the server formula, the presets reproduce the business-plan prices and the Custom examples in the business plan price correctly through every slab; in the Custom builder the people slider from 1 to 40 leaves the price unchanged and the 41st person changes it; at every position of the clients and people sliders the monthly and the yearly price both end in the rounding rule's last three digits, and the price never falls as either slider rises; Solo is the owner alone, so inviting anyone offers Add a user; the owner counts towards every plan's team size; with credits used up no AI call is made, reminders go as templates and emails are still filed to `To check`; running past the workspace or returns allowance never blocks work or a filing: the firm is told and moved up; at 80% of either measure the owner sees the upgrade card with the same plan and price the invoice later shows, a firm above Enterprise is offered Custom with its sliders pre-set, and a staff login never sees the card; a UPI firm upgraded inside its mandate's maximum is debited the new amount with no new approval, and one above it gets the approval link; a spreadsheet of 5,000 rows adds less than one-sixth of its size to InboxCA storage, and the figures read for a filed form are gone 30 days later; a monthly GST client added in month 7 adds only its remaining returns to the year's meter; a firm at 105% of its returns is not moved, at 111% it gets the notice; the renewal notice shows the coming year with every client at a full year; on the pricing page 900 clients of a mixed practice and a team of 8 give the same estimate as the Custom formula gives for the returns worked out from them, and after the client list is loaded the counted figure replaces the estimate with a credit or an upgrade card; the pricing page and the upgrade card show clients, returns, InboxCA storage a year, AI allowance and team size, and the storage line says the firm's files stay in its own drive; with `fit_enforced` off nobody is moved or charged by the meters; a UPI or eNACH firm past its allowance gets the approval link and keeps working, and only AI pauses on day 31 if it is not approved.

### M12: Pilot, then launch
- [ ] Paresh bhai's firm runs everything on real work for 4–6 weeks: hours saved, share of emails handled without staff typing, extraction accuracy and days to close a filing are measured
- [ ] Launch criteria: no wrong document sent, no output from unconfirmed data, no privacy or advice correction needed, the firm willing to keep using and paying
- **Then:** onboard the next firms (§12 on how many design partners before general launch).

---

## 8. Security, privacy and encryption

- CA firms hold highly sensitive data: PAN, Aadhaar, income, bank statements, financial statements.
- **Privacy is a launch requirement:** every rule here applies from M0 and has a test or checklist item in M11.

### 8.0 Storage boundary (D6)

- **Kept:** documents deliberately uploaded or accepted; encrypted OCR/parsed-text artifacts and keyed search tokens derived from those documents (D29); firm-entered and staff-confirmed records (clients, tasks, notices, confirmed datasets, leads); operational metadata (labels, statuses, ids, audit). Derived artifacts inherit the source document's permissions and deletion date.
- **Never kept:** email subjects or bodies, transcripts, raw webhooks, rendered outgoing bodies, message summaries, free-text extracted from an email, unconfirmed AI prose, persistent AI memory, or plaintext OCR/search indexes. This covers the database, storage, queues, job payloads, logs, traces, analytics and backups. Structured draft fields extracted transiently from an email may be saved encrypted only when required for a named form; each field records `source=email` and must be confirmed by staff before downstream use. Staff verify it by opening the original message in the firm's mailbox; if the message is unavailable, the field cannot be confirmed and must be re-entered from another source.
- Retention of metadata: webhook dedupe 7 days; AI usage details 30 days (monthly totals kept); resolved team items 90 days; email delivery records (no content) 12 months; **staff activity logs** (`activity_log`) per the firm's setting, 12–36 months, default 36 (D18); Orelu's own sign-in, API and error logs 12 months.
- Logs stay in India (Supabase Mumbai) and are kept at least 12 months: the DPDP Rules 2025 require processing logs for at least one year, and the CERT-In directions (April 2022) require ICT logs for 180 days within India. Error tracking receives scrubbed events only and keeps them 30 days.

- **Client files are not stored by Orelu either (D36):** they rest in the firm's own drive. Orelu holds a file only while it is in transit (at most 24 hours, or 7 days if the drive cannot be reached) and as a locked 30-day safety copy after a delete or a change.

### 8.1 Legal frame and compliance register (D27)

- **Drive access terms (§5.5.1):** a named section of the Terms that the owner agrees to with a tick at Connect, before Orelu asks the drive provider for any access. It says what Orelu may do (read, make and change folders, save files, fill forms), what it will not do (delete without approval, share outside the firm, open folders not chosen, train AI on the files), that the files stay the firm's, that the firm answers for its drive account and its provider's charges, the stated limits, and how access ends. The tick, its time and the terms version are kept in `activity_log`.

- **Roles:** for the firm's client data the firm is the **data fiduciary** and Orelu its **processor**, acting only on the firm's instructions under a signed DPA. For its own customers' account and billing data, Orelu is the fiduciary.
- **Nothing real goes in until** every "before real data" row below is done; a lawyer reviews the terms, privacy notice, DPA and refund and cancellation policy before the pilot.

| Law or rule | What it requires | How Orelu meets it | When |
|---|---|---|---|
| DPDP Act 2023 and DPDP Rules 2025 (most duties apply from May 2027; built in now) | Process only under a contract with the fiduciary; reasonable security (encryption, access control, logs kept at least a year); help the fiduciary report breaches (to the Data Protection Board and affected people within 72 hours) and answer access, correction and erasure requests; erase when the purpose ends | DPA with every firm; controls in §8.2–8.10; logs 12–36 months (D18); the breach runbook tells the firm within 24 hours of discovery with the facts it needs; export and erasure tools; retention rules (D36, §8.0) | Before real data |
| IT Act 2000 s.43A and SPDI Rules 2011 (until the DPDP Act fully replaces them) | Reasonable security practices for sensitive personal data such as financial information and passwords | The same controls, written down as a security policy kept in the repo | Before the pilot |
| CERT-In directions (28 April 2022) | Report listed cyber incidents to CERT-In within 6 hours; keep ICT logs 180 days in India; keep clocks synced to NTP; name a point of contact | Incident runbook with the 6-hour step (§8.10); logs in Supabase Mumbai; NTP-synced managed services and UTC timestamps; Utsav named as point of contact | Before the pilot |
| RBI payment rules: card-on-file tokenisation; E-Mandate Framework 2026 | No card data stored by merchants; AutoPay needs a one-time authorised mandate, pre-debit notices, an OTP for debits above ₹15,000, and easy cancellation | Razorpay (a licensed payment aggregator) collects payment details, holds tokens and sends notices; Orelu keeps only ids; eNACH above ₹15,000; cancel from Settings (§5.14.1) | Before sign-up opens |
| Contract law; IT Act s.10A | Online terms bind only if clearly accepted | Click-through acceptance at sign-up, stored with the document version and time | Before sign-up opens |
| GST (CGST Act) | Register once turnover crosses ₹20 lakh; issue tax invoices once registered | Prices shown excluding GST; invoices for every charge; registration tracked in §12 (registering early lets CA firms claim input tax credit) | At the threshold, or earlier by choice |
| Income-tax | Some firms deduct TDS on payments to Orelu | Orelu's PAN on every invoice; TDS reconciled against Form 26AS | From the first payment |
| Aadhaar Act s.29 and UIDAI guidance | Don't store or show full Aadhaar numbers beyond what is allowed | Fields keep the last 4 digits only; Aadhaar documents are `approval` (sensitive), encrypted and never auto-sent; firms are encouraged to collect masked Aadhaar | Built in |
| Cross-border transfer (DPDP s.16) | Allowed except to countries the government restricts | Orelu's workspace region (US or EU), the fact that client files rest in the firm's own drive, and OpenAI named in the DPA and privacy notice; providers switched if a region is ever restricted | Before real data |
| Sub-processor contracts | A processor holds its sub-processors to the same standard | DPAs accepted with Supabase, Cloudflare, Backblaze, AWS, OpenAI (zero data retention approved), Razorpay and Sentry; Microsoft's API terms and Dropbox's developer terms followed for drive access (Google's API user-data policy still applies to Gmail mailboxes); list published | Before real data |
| Chartered Accountants Act and ICAI Code of Ethics (the firm's duties) | Client confidentiality; no commission or fee-sharing for professional work; ICAI advertising rules | Orelu acts only for the firm; a suggested engagement-letter clause tells clients the firm uses a secure cloud service; referral rewards are service credits to the firm, never cash, and are checked against the Code; any CA testimonial or case study needs written consent and a check against ICAI advertising guidance | Before referrals and the case study |
| The firm's record-keeping duties (CGST s.36: 72 months after the annual-return due date; ICAI SQC 1 / SA 230: working papers at least 7 years) | The firm must keep records longer than Orelu holds them | Files stay in the firm's own drive for as long as the firm keeps them (D36); Orelu removes nothing there without the owner's approval | Built in |
| TRAI rules and Meta WhatsApp policies (future add-ons only) | Registered numbers and DLT where required; Meta's business and commerce policies | Checked before §5.19 is built | Before those features |

- **Sub-processors** (listed in the DPA and on a public page): Supabase (database, login), Cloudflare (app hosting), Backblaze (Orelu's workspace store: temporary files, the encrypted text read from files, 30-day safety copies, database exports; region stated), AWS (KMS keys, file worker, system email via SES; Mumbai), OpenAI (AI, zero retention), Google / Microsoft / Zoho (the firm's own mailbox), Razorpay (Orelu's own account for plan payments), Sentry (errors).
- **Contract wording for AI and third parties:** the Privacy Notice and DPA identify OpenAI and every other sub-processor, purpose, data category, region and applicable retention. Orelu promises data minimisation, approved ZDR before real data, no training opt-in, contractual vendor review, access controls and incident assistance. The documents must **not** say “Orelu is not responsible for data sent to OpenAI”: Orelu selected the sub-processor and remains responsible for its own processor duties and vendor controls. The Terms may allocate losses caused by the firm's unlawful instructions, unauthorised mailbox sharing, remote-desktop tools, weak endpoint controls or use outside documented settings, subject to Indian law; they cannot waive statutory duties, fraud, wilful misconduct or obligations that cannot legally be excluded. A lawyer approves the final clauses before the pilot.
- Never store full Aadhaar numbers in fields; show the last 4 digits only.

### 8.2 Where data lives (D12)

- Client files: the firm's own drive, with the provider and region the firm chose (D36). Database and login: Supabase Mumbai. App: Cloudflare Workers (runs at Cloudflare's Indian locations, placed near the database; keeps no data of its own). Orelu's workspace store (temporary files, the encrypted text read from files, 30-day safety copies, database exports): Backblaze B2 in the chosen region (not India). Keys: AWS KMS `ap-south-1`.
- The privacy notice states plainly that client files rest in the firm's own drive; that Orelu's temporary files and safety copies are held outside India, encrypted; and that the text and figures Orelu keeps are encrypted with keys only Orelu's service can use.
- Job payloads carry **ids only**, never personal data or content (lint rule + schema tests).

### 8.3 Encryption in transit

- TLS 1.2+ everywhere, HSTS, secure HttpOnly SameSite cookies.
- IMAP/SMTP only over TLS with certificate checks; webhooks over HTTPS and authenticated; database connections over TLS.

### 8.4 Encryption at rest

- Provider encryption at rest for database, files and backups.
- **Application-level envelope encryption:** a KEK in AWS KMS; each firm has its own DEK stored only wrapped in `firm_keys`, unwrapped per use and cached in memory for at most 5 minutes; AES-256-GCM with firm id, record and field as associated data, so a value moved to another firm, record or field fails to open. Encrypted values are short base64url text, so they also fit inside jsonb.
- **Encrypted by Orelu:** the 30-day safety copies (chunked), OCR/parsed-text artifacts, firm-entered content, extracted datasets, identifiers (PAN, GSTIN, emails, phone, bank details, with blind indexes), credentials (mailbox tokens, IMAP passwords, PDF passwords). Temporary quarantine uses provider encryption and is isolated, access-limited and deleted within 24 hours.
- **Not re-encrypted by Orelu:** client files in the firm's drive. They are protected by the drive provider's own encryption and by the owner's account, so that the owner can open them directly (D36).
- **Not field-encrypted** (for listing): client display names, categories, dates, statuses.
- KEK rotates yearly; DEKs can rotate per firm. Deletion purges live data and wrapped keys; backups expire within a verified 35-day window with deletion replay on restore.

### 8.5 Who can see what (D17, D18)

- RLS by firm; client visibility is `open` by default (every employee, front desk included, can view every client's documents, sensitive ones too) and `restricted` only if the owner chooses (§5.9, §5.17.2).
- **Access policies** set by each firm (§5.17): where, which device, when, and what off-site; Standard (any device with 2-step login) by default, with opt-in presets for office-only, approved remote, remote-friendly and solo firms. Owner anytime with passkey and 2FA.
- **Read-only originals, owner-approved deletes, 30 days in the Deleted folder, Orelu's locked 30-day safety copy.**
- Staff never get drive access, folder access, bulk download or export. **Employees and managers are view-only by default (§5.17.2)** except renaming by type or period and approved filing files; a granted download is one file at a time with a **visible watermark** (name, date, time) and an `activity_log` entry. The one exception is an approved filing file (§5.7.4): a watermark would break the portal or TaxPower / KDK Spectrum upload, so it downloads unmarked and is still logged.
- **Owner alerts** on unusual activity: many downloads in a short time, repeated refused sign-ins, attempts outside hours or off the office connection.
- **Office policy** (told to the firm; software can't enforce it): remove remote-desktop tools such as AnyDesk or TeamViewer from office PCs, or staff could reach an office PC from home; a photo of a screen can't be prevented, but the watermark makes it traceable.
- **Orelu staff** have no standing access to content; support needs an owner-approved, time-boxed, logged session.
- **Coding agents never get production data or production secrets.**

### 8.6 Documents and links

- The firm's drive folder is shared with nobody, and Orelu's bucket is private; downloads only through the worker after permission checks.
- **Download links** are single-use, bound to the user's session and device, and expire in 2 minutes; drive links, tokens and storage keys never reach the browser.
- Every view, download, share and delete request is logged and shown on the document timeline.
- **Secure links:** tokenised, single client, 7-day expiry, limited downloads; `approval` documents need a one-time code sent to the verified email, 10-minute expiry, attempt limits.
- **Outgoing PDFs** attached to email are password-protected with a firm-approved method; digitally signed originals are not modified — they go as secure links instead.
- Malware scan before visibility; macro-enabled files and executables rejected.

### 8.7 Email

- Narrowest scopes that work; tokens encrypted, refreshed server-side, never sent to the browser.
- Only mail from registered addresses (and, if enabled, enquiries) is read; nothing is stored beyond metadata.
- `approval` documents are never attached; they go as secure links with a code.
- Outgoing mail is sent from the firm's mailbox; the connect screen checks the firm's SPF/DKIM/DMARC and warns if missing.
- Disconnecting revokes the token and stops all reading immediately.

### 8.8 AI

- Send only what the current email or document needs; never another client's data. Ids for tools come from the server.
- OpenAI API with approved ZDR, foreground `/v1/responses` with `store:false`; none of the retention-bearing features listed in D13.
- No prompts, completions or free-text tool arguments stored; `activity_log` keeps AI run metadata only.
- Prompt injection: tools enforce permissions server-side; documents and emails are data, never instructions; the eval suite covers injection.

### 8.9 Engineering hygiene

- Logs, traces and Sentry carry **no content or identifiers** (redaction strips PAN, GSTIN, Aadhaar, phone, email, bodies, filenames).
- No secrets in the repo; `.env.example` lists every variable (§10); secret scanning and dependency audits in CI.
- Verify every webhook signature, process idempotently, rate-limit every public endpoint.
- Before the pilot: external penetration test, restore drill, key-rotation drill; fix high and critical findings before real data, medium before launch.

### 8.10 Orelu's own accounts, payments and incidents

- **Admin accounts:** every Orelu account that can reach production (GitHub, Supabase, Cloudflare, AWS, Backblaze, OpenAI, Razorpay, the domain registrar, business email) uses a passkey or hardware security key, least privilege and a separate admin login; access is reviewed every quarter; a sealed break-glass account covers emergencies.
- **Payments:** Razorpay hosted Checkout only, so card and bank details never touch Orelu (smallest possible PCI DSS scope); amounts computed on the server; webhooks verified by signature, deduplicated and replay-safe; Razorpay keys only in server environment variables; daily reconciliation (§5.14.1).
- **Backups and recovery:** Supabase Pro daily database backups (7 days) plus a nightly encrypted database export to Backblaze kept 35 days; an encrypted database export to Backblaze **every 6 hours** (a few cents a month) so at most 6 hours can be lost; Supabase point-in-time recovery (a $100-a-month add-on) only when firms need minute-level restores; the 30-day safety copies under object lock; client files themselves are backed up by the firm's drive provider, not by Orelu; target recovery point under 6 hours and recovery time under 8 hours; restore drill every quarter.
- **Patching:** critical vulnerabilities in dependencies or platforms fixed within 7 days, high within 30.
- **Incident response:** detect (alerts on sign-in, access, payment and cost anomalies) → contain → report to CERT-In within 6 hours if reportable → tell affected firms within 24 hours what happened, which data and what to do, so they can meet their 72-hour DPDP duty → fix and write a post-incident note. Contacts and templates live in the runbook; the runbook is drilled twice a year.
- **Testing:** external penetration test before the pilot and every year, and after any major change to sign-in, storage or payments.
- **Insurance:** cyber-liability insurance before the first paying firm after the pilot (§12).

---

## 9. Brand (Orelu)

- Source: `~/Desktop/projects-coding/orelu/dist/styles.css` and `dist/assets/`.

| Token | Value |
|---|---|
| paper (background) | `#F6F4EF` |
| ink (text) | `#1C1C1C` |
| muted | `#64635E` |
| line | `#DCD9D1` |
| orange (accent, logo) | `#F15A32` |
| dark orange (links, focus, text accents on light) | `#BB3514` |
| deep green (dark surfaces) | `#19211F` |
| radius | 22px (cards), 9px (buttons) |

- Fonts: **Sora 600** for headings, **Manrope** for body. Self-host both.
- Logos: `orelu.png` (light backgrounds), `orelu-light.png` (dark), `mark.png` (icon).
- Tagline: "Less chasing. More doing."
- **Never fabricate client claims, testimonials or performance figures.**
- UI English first; Hindi and Gujarati on client-facing surfaces (upload page, enquiry form, email templates). Indian number format (1,23,456.00); dates DD MMM YYYY.

### 9.1 InboxCA (the product's own brand, D35)

- **For people who are not technical (user, 17 Oct 2026):** most owners and their staff are not tech friendly, and most of the work runs by itself. Every screen shows results and what needs a person, never the machinery; one clear action per card; plain words with no technical terms on screen; advanced options folded away; defaults that work without changing a setting. Inside the app the sizes are compact and standard (14px text, 32px fields and buttons), laid out for a laptop so pages scroll less; the landing page keeps its own larger sizes. **The app's design (redesigned on 18 Oct 2026 in the manner of Notion and Attio, the user's choice; styles in `app/(app)/app/app.css`, the landing page untouched):** a light sidebar (the firm, a search box that also opens with Ctrl K or ⌘K to jump to any client or page, the pages the role uses with the Inbox count, the person and Sign out) beside white pages with no boxes round sections; every page opens with a header (title, one line, its actions on the right). One scale for everything: type 12, 13, 14, 15 and 26 px; space 4 to 48 px; radius 6, 8 and 12 px; controls 32 px and rows 40 px. **Home is the firm's work board:** a greeting with Calendar and New client; the owner's slim setup strip until setup is done; a month band with the month's filings by return (filed of due, with a bar each) beside this month's filing ribbon (a bar per filing day, filed in green, late in red; point at a day to read it, click to open that day); four columns of cards from late to done (Overdue, Due this week, In progress, Filed this week), each card a client, its return and when it is due, with one Filed button; and Needs a reply beside Latest client email. Lists are database style tables with soft coloured tags and coloured initials; a choice in a table (an email's label, a person's role, team or branch) saves as soon as it is picked, so rows carry no Save buttons; adding opens in place from the header (New client, Import); the client page is a record with tabs (Overview, Due dates, Contacts, Team, Details) and its details down the side; the Calendar has view pills and a bar that rises with its actions when returns are ticked; Settings has an index beside its sections and each connection in one row. Restrained colour (blue only for actions and selection, green only for done, red for late, amber for "needs a person"), one family, Plex Mono only for numbers such as PAN and GSTIN; motion of 150 to 250 ms only to show a change (cards and panels open, the bulk bar rises, buttons press), none for anyone who asks for less motion; the page never bounces at the top or bottom and never shifts sideways when a scrollbar appears. `npm run demo` then `npm run demo:data` make a local demo firm with 13 invented clients, their numbers and services, filed and overdue returns, teams, branches, people, contacts and sorted client mail.

- **The product and its public site use the InboxCA brand, not the Orelu tokens above.** The Orelu tokens and logos are used only for the line "a product by Orelu" and for Orelu's own company pages.
- Reference board: `InboxCA-Brand-Kit.png` in this folder. Official logo files: the company Drive folder "InboxCA brand assets".

| Token | Value |
|---|---|
| navy (text, dark surfaces) | `#0B1F3A` |
| blue (actions) | `#1A4BB0` |
| deep blue (small blue text on light) | `#153E94` |
| tint (text and accents on navy) | `#C2D3F7` |
| cool grey (light surfaces) | `#F2F5F9` |
| slate (secondary text on light) | `#51607A` |
| white | `#FFFFFF` |
| green ("done" only, never decoration) | `#12905F`; deeper `#0B7A51` behind white text |

- Fonts: **Plus Jakarta Sans** for words (800 for headings); **IBM Plex Mono** for every date, time and figure. Self-host both. No rounded typefaces.
- Signatures: faint ruled ledger lines with one margin line; the tray-and-tick mark, where the tick arrives from outside and lands in the tray.
- Brand line: "Nothing pending." Company tagline carried over: "Less chasing. More doing."
- Before public use: the name and the mark still need a domain and a trademark check (the tick resembles the ICAI member mark), so the public site is built but **not published** until the user says so.

---

## 10. Environment variables

```
SUPABASE_URL=                     # read by the server only; the browser never talks to Supabase directly
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=              # job workers + admin only
KMS_KEY_ID=                       # KEK in AWS KMS ap-south-1
KMS_CREDENTIALS=                  # scoped to encrypt/decrypt only
LOCAL_KEK=                        # development and tests only, written by `npm run db:env`; never set in production
B2_ENDPOINT=                      # Backblaze S3-compatible endpoint for the chosen region
B2_KEY_ID=                        # application key for bucket management and the worker
B2_APPLICATION_KEY=
B2_WORKSPACE_BUCKET=              # Orelu's one private bucket: temporary files in transit (24-hour area), encrypted text read from files, 30-day safety copies, database exports
MS_DRIVE_CLIENT_ID=               # OneDrive connection, whole drive (needs an Entra directory, §13.2)
MS_DRIVE_CLIENT_SECRET=
DROPBOX_APP_KEY=                  # Dropbox connection, Full Dropbox; signs in with PKCE, so no app secret
FILE_WORKER_URL=                  # file worker endpoint: AWS Lambda in ap-south-1 (D28), confirmed in the M0 spike
FILE_WORKER_SECRET=               # service-to-service credential
JOB_WORKER_SECRET=                # authenticates Supabase Cron's call to /api/jobs; the same value, and the endpoint's address, are kept in Supabase Vault (job_worker_secret, job_worker_url)
TEMPLATE_WATCH_SOURCES=           # official download pages to watch (comma-separated)
AWS_SES_REGION=ap-south-1         # Orelu system emails via Amazon SES (D28)
EMAIL_FROM_DOMAIN=                # Orelu's own domain, verified in SES
GOOGLE_OAUTH_CLIENT_ID=           # only after Google verification; app-password IMAP until then
GOOGLE_OAUTH_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
AI_PROVIDER=openai
OPENAI_API_KEY=
AI_AGENT_MODEL=gpt-5-mini
AI_EXTRACTION_MODEL=gpt-5-mini
AI_CLASSIFIER_MODEL=gpt-5-nano
SENTRY_DSN=
APP_BASE_URL=
MAIL_MODE=fake                    # fake | live
ORELU_RAZORPAY_KEY_ID=            # Orelu's own account, for plan payments (D5)
ORELU_RAZORPAY_KEY_SECRET=
ORELU_RAZORPAY_WEBHOOK_SECRET=
AI_GLOBAL_DAILY_CAP_USD=          # Orelu-wide AI spend cap; pauses all AI and alerts the team (§5.18)
```

---

## 11. Conventions for the coding agent

- Read this whole file first. One milestone at a time; tick checkboxes as tasks finish.
- Business rules live in `/src/domain` as **pure functions with unit tests**; job handlers, route handlers and server actions stay thin.
- Every side effect follows the send-job contract (§4.3); reconcile uncertain sends before retrying.
- Schema changes only through new files in `/supabase/migrations`; every tenant table gets RLS **and** an isolation test; test write policies and tenant-consistent foreign keys.
- Validate every external input and AI output with zod. Money in paise; due dates `date` in IST; event times UTC.
- Development and tests never send real email (`MAIL_MODE=fake`); unit tests mock AI; the eval suite calls the real API with synthetic data.
- Build the pricing formula, plan builder, usage limits and payment-triggered activation (D5, D26); formula values and prices come from admin configuration, **never constants in code**. No AI call without a credit reservation (§5.18).
- Never file on government portals or store portal credentials (D19). No live Tally connection (D21).
- Don't use n8n or other no-code automation (D2). Don't build WhatsApp or AI calls at launch (D3); only the reserved enum values and meters in §5.19.
- If something here is ambiguous or seems wrong, add it to §12 with a recommended safe default, owner and evidence needed. Don't guess silently.

---

## 12. Decisions still open and go/no-go evidence

| Area | Current position | Go/no-go evidence or decision needed |
|---|---|---|
| Design partners before general launch | Pilot with Paresh bhai for 4–6 weeks (M12). **Recommended:** at least 2 more firms on the product before general launch. | **Set on 8 Oct 2026 (working default; Utsav can change the number):** public sign-up opens after Paresh bhai's firm and 2 more firms have each run 4 weeks with no open critical defect. Until then sign-up is by invitation link; one admin-console switch opens it. |
| Launch scope beyond Paresh bhai's notes | Reminders, the AI assistant and leads stay in scope because all features ship together (D1). Client invoices and fees were removed from the launch on 7 Oct 2026 (D30). | **Closed:** all of it stays in the launch under D1 (every feature ships together); invoices stay out (D30). |
| First forms | GSTR-1 and GSTR-3B data, then ITR-1 to ITR-4 (§5.7.3). | Built in this order by default; **nothing waits on the answer**. If Paresh bhai names other forms in Phase 0, only the order of M6 work changes. |
| TaxPower / KDK Spectrum roles | Assumed: TaxPower for GST, KDK Spectrum for ITR/TDS. | **Not a blocker:** Orelu produces the official government-format file, which both tools import, so the split between them does not change the build. One sample file from each is needed only for the test import. |
| Folder order | Financial year / Client / Work type (17 Oct 2026). | **Not a blocker:** a display setting every owner can change; the default is built. |
| Records auto-reply | Automatic for `auto` documents (ITR-V, filed returns, challans, certificates marked auto); approval for sensitive ones; firm can require approval for all (§5.5.2). | **Not a blocker:** a per-document-type setting with safe defaults (financial statements, audit reports, identity and bank documents need one approval). The owner changes it in Settings. |
| Access policy for Paresh bhai | **Office only for staff** switch: staff on PCs he approved, on the office's internet connection (a fixed address if his provider offers one; otherwise his or a deputy's tap, or a trusted fixed PC, after an address change), in the office hours he sets (9 am–5 pm preferred, to confirm); every employee and manager views every client, view only, with rename; managers approve their team's everyday requests; owner anywhere. | Switch turned on and office PCs approved before M12; Paresh bhai confirms hours and whether any partner needs remote access. Hours, days, holidays, deputies and remote access are his own settings in the setup guide, with suggested defaults; no build step waits on them. |
| AI provider | OpenAI with ZDR; another provider only after the same privacy and eval gates. | Approved ZDR on the production project; passing evals. **If ZDR is not approved by the pilot date,** the pilot starts with AI switched off for the firm: rules, parsers and OCR still run and unresolved items go to `To check`. No client data goes to a model without ZDR. |
| Email providers | App-password IMAP/SMTP for Gmail until Google verification; Microsoft via firm-admin consent. | Send, receive, reconnect and no-storage tests per provider. |
| File worker host | AWS Lambda in Mumbai (D28). | M0 spike results (a 2 GB file into a drive, ZIP, streamed view) within Lambda's limits. |
| Startup credits | Apply for AWS Activate Founders (up to $1,000) and Microsoft for Startups. | Credits approved; AWS credits cover SES, Lambda and KMS. |
| Workspace store | Backblaze B2 (cheapest reputable with SOC 2 and object lock); IDrive e2 as the switchable alternative (D12). | Region chosen (US or EU) and stated in the DPA and privacy notice; restore and object-lock tests pass. |
| Firm's drive (D36) | OneDrive and Dropbox at launch, behind one adapter; Google Drive and others added later the same way. **Found in the providers' documentation on 8 Oct 2026:** OneDrive's app-folder permission works on home and work or school accounts, and files the owner puts in Orelu's folder become reachable; Dropbox's app-folder access works the same way; both also offer whole-drive access with no yearly audit. | The M0 check confirms create, read, rename, move and delete on real OneDrive (home and work) and Dropbox accounts, at both access levels; Microsoft's publisher verification and Dropbox's production approval are passed. If an account type fails the check, it is not offered at launch and the Connect screen says which accounts work. |
| Google Drive | **Not in the launch (user, 8 Oct 2026).** Its narrow permission does not cover the contents of a folder, and whole-drive access needs a security assessment by an approved lab every year (reported at about $500 to $4,500 a year). | **Decide after the pilot:** add it when enough firms ask, either with the narrow permission and Orelu's uploader, or after taking the assessment. |
| Plan sizes (D37) | Workspace 4 / 10 / 20 / 40 GB a year and returns 800 / 2,000 / 4,000 / 8,000 a year, both provisional. | One real month of files measured for what Orelu keeps, one real client list counted for returns a year, and the sizes and credits checked with Paresh bhai and 3–5 CAs. **Until then the automatic plan fit is switched off** (§5.14): firms stay on the plan they chose, the meters are information only, and Paresh bhai's price stays an estimate. |
| WhatsApp and AI calls (future) | Designed as monthly packs (§5.19), not built. | Meta partner approval and how Meta's fee is billed; TRAI/DLT rules for automated calls confirmed; demand from pilot firms. |
| Registering Orelu | Not registered yet. Udyam now (free). **Recommended:** incorporate a Private Limited company (or LLP) before the first paying firm after the pilot, then get DPIIT Startup India recognition (only companies and LLPs qualify: 80-IAC tax holiday with a separate approval, 50% off trademark fees) and register the Orelu trademark, so contracts, DPAs and liability sit with the business rather than with Utsav personally; GST registration early (CA firms can then claim input tax credit) or at the ₹20 lakh threshold. | Certificates in Orelu's name; terms and DPA in the entity's name. |
| Legal review | Agents draft the terms (including the **Drive access terms** the owner ticks at Connect, §5.5.1), privacy notice, DPA and refund and cancellation policy against §8.1. | A lawyer reviews them before the pilot, and confirms that a ticked box with a recorded version is valid consent for the firm. |
| Razorpay billing | Subscriptions for card AutoPay, Recurring Payments for UPI AutoPay and eNACH (§5.14.1); fees modelled at about 3.5% per AutoPay debit and 2.36% per one-time payment. | Razorpay confirms the products are enabled on Orelu's account and the fees in writing. Open the account as a proprietorship with the Udyam certificate as business proof (no GSTIN needed), not as an individual; get Razorpay to confirm in writing that Subscriptions and eNACH are enabled on it and that no per-payment limit applies, because yearly plans exceed ₹50,000. Razorpay adds 18% GST to its own fees (already in the fee model); it becomes claimable once Orelu is GST-registered and its GSTIN is on the account (D32). **Found on 8 Oct 2026:** Razorpay's documentation says a live UPI subscription cannot be updated, and that Recurring Payments allow a different amount each time up to the mandate's maximum; its pricing page lists 2% a transaction plus 0.9% on card Subscriptions, with UPI and e-mandate pricing on request. **Still needed in writing:** Recurring Payments switched on for Orelu's account, its fee, and the per-debit limit on UPI. |
| ICAI rules for referrals and testimonials | Referral rewards as service credits only; testimonials only with written consent. | Checked against the ICAI Code of Ethics and advertising guidance before use. |
| Launch date (7 November 2026) | Depends on the M0 drive check, Google's and Microsoft's app reviews and the ZDR approval. | **Rule:** the date is confirmed on the day the M0 drive check passes; each day that takes beyond the first week of the build moves the launch by a day. Scope is not cut to hold the date (D1); a late ZDR approval is handled by starting with AI off (above). |

---

## 13. Who does what

### 13.1 Coding agents (Claude Code and Codex)

- The agents build **all of the software**: schema and migrations, RLS, the Next.js app, jobs, mailbox adapters, the drive adapters and the file worker, extraction and the template engine, TaxPower / KDK Spectrum import files, the office-connection and device checks, Razorpay, the AI assistant and evals, tests, CI, deployment configuration, documentation and bug fixing.

- One agent owns a milestone on its own branch; the other reviews the PR against this plan and the milestone's acceptance checks; they swap on alternate milestones.
- This file is shared state: tick checkboxes in the PR that finishes the work, and add open questions to §12.
- Never both agents on the same milestone at once. Nothing merges with failing CI or without its acceptance check output in the PR description.

### 13.2 Human-only tasks (Orelu team)

| Task | When |
|---|---|
| Register Udyam; buy the Orelu .com domain on Cloudflare Registrar (at cost, about $11 a year; optionally the .in too, about ₹600 first year, ₹800–900 renewal); set up business email (Zoho Mail free plan, up to 5 users) with SPF/DKIM/DMARC; open Orelu's own Razorpay account (individual/proprietor) for plan payments | Now |
| Accounts: GitHub, Supabase (Mumbai; Pro plan on Micro compute before real data), Cloudflare (Workers Paid, $5), Backblaze (choose region), AWS (`ap-south-1`: KMS, Lambda, SES; verify the domain and request production SES access), OpenAI (request ZDR), Sentry (free Developer plan); apply for AWS Activate Founders and Microsoft for Startups | Before M0 |
| Get from Paresh bhai: folder order, first forms, anonymised sample emails and input files, one sample file from each of TaxPower GST and KDK Spectrum and one test import in each, office hours and holidays | Phase 0 |
| Paresh bhai's office (done by the firm itself in the setup guide): the owner turns on Office only for staff from an office PC and each staff member signs in once on their PC, then the owner approves the PCs with one tap; a fixed address from the provider is recommended, not required | Before M12 |
| A test mailbox for development, and sample Tally export files | Before M3 |
| Paresh bhai (a CA) reviews the compliance catalog, document checklists and notice types | During M2 and M4 |
| Google OAuth verification and CASA, if one-click Gmail is wanted; otherwise stay on app passwords | Optional, Phase 0 |
| **Microsoft Entra directory for the OneDrive app (found 17 Oct 2026):** Microsoft no longer lets a personal account register an app outside a directory. Get one by signing up for Azure (asks for a card even on the free tier) or through a Microsoft 365 business account for Orelu; then register "InboxCA Dev" with `Files.ReadWrite` and `offline_access`. | When a card is added, before OneDrive is offered |
| Drive app approvals: Microsoft publisher verification (a verified Microsoft partner account, the app registered under Orelu's own domain); Dropbox production approval (apply before the 50th linked account) | Start in Phase 0; needed before firms on work accounts can connect |
| Terms (with the Drive access terms), privacy notice, DPA, refund and cancellation policy (agents draft against §8.1; a lawyer reviews) | Before the pilot |
| Accept DPAs with every sub-processor; name the CERT-In point of contact; buy cyber-liability insurance | Before the pilot (insurance before the first paying firm after it) |
| Enable Razorpay Subscriptions, UPI AutoPay and eNACH on Orelu's account; get the fees in writing | Before sign-up opens |
| Incorporate a Private Limited company (or LLP); then DPIIT Startup India recognition and the Orelu trademark; decide on early GST registration (§12) | Before the first paying firm after the pilot |
| External penetration test and incident runbook review | Before the pilot |
| Put secrets into the hosting providers' settings; agents never handle production secrets | Before the first deploy |
| Paresh bhai connects his drive and uploads his old files from his disk through Orelu's uploader himself; Orelu watches progress remotely and he signs off the manifest | M12 |
| Approve every production deployment during the pilot | M12 |
