// One short scene for each help article (help.ts), keyed by its slug: a few frames of a small
// InboxCA window, each lighting the step it shows (at: the step's place, or the point's when the
// article has no steps). Buttons and screens use the app's own words; firms, people, files and
// figures are sample data, and prices come only from plans.ts. still: the frame shown when the
// visitor asks for less motion (the last one when not given).
import { createElement, Fragment, type ReactNode } from "react";
import {
  CalendarDays, FileSpreadsheet, FileText, HardDrive, IndianRupee, KeyRound, ListChecks, Mail as MailIcon, MessageSquareWarning, Monitor, Paperclip,
  Receipt, Reply, RotateCcw, Scale, Send, ShieldCheck, UserPlus, Users, type LucideIcon,
} from "lucide-react";
import type { Frame, Screen } from "@/components/site/help-show";
import { Btn, Card, Chip, Chips, Choice, Code, Field, Figures, File, Line, Mail, Meter, Note, Passkey, Plan, Qr, Rename, Rows, Sheet, Split, Ticks, Title, Track, Tree } from "@/components/site/help-art";
import { aiBlock, extraPerson, plans, rupees } from "./plans";

const f = (at: number, screen: Screen, ...body: ReactNode[]): Frame => ({ at, screen, body: createElement(Fragment, null, ...body) });
const num = (text: string) => <span className="num">{text}</span>;
const firm = "office@sharmaco.example";
const client = "accounts@pateltextiles.example";
const drive = ["Your OneDrive", "InboxCA", "FY 2026-27", "Patel Textiles", "GST"];
const bills = "Patel Textiles - Purchase bills - Sep 2026.pdf";
const settings = (part: string): Screen => ["Settings", "Settings", part];
const growth = plans.find((plan) => plan.name === "Growth")!;
const itrSteps = ["Figures checked", "Prepared", "Approved", "Filed"];

export const helpScenes: Record<string, { icon: LucideIcon; still?: number; frames: readonly Frame[] }> = {
  "sign-up": {
    icon: UserPlus,
    still: 1,
    frames: [
      f(0, [null, "Plans"], <Plan name="Growth"><Line><Btn press>Get started</Btn></Line></Plan>),
      f(
        1,
        [null, "Sign up", "Set up InboxCA for your firm"],
        <Line><Field label="Firm name" value="Sharma and Co" /><Field label="State" value="Gujarat" select /></Line>,
        <Field label="Your work email" value="ravi@sharmaco.example" />,
        <Ticks items={[["For my firm, I accept the terms and the data processing agreement", true]]} />,
        <Line><Btn press>Sign up</Btn></Line>,
      ),
      f(2, [null, "Sign up"], <Code label="Code from the email" digits="482913" />, <Note>There is no password.</Note>),
      f(
        3,
        [null, "Set up your 2 step code"],
        <Line><Qr /><Note>Scan the QR code with an authenticator app, such as Google Authenticator or Microsoft Authenticator.</Note></Line>,
        <Code label="6 digit code from the app" digits="705316" />,
      ),
      f(
        4,
        [null, "Plan and payment"],
        <Choice label="How often to pay" items={["Monthly", "Yearly"]} pick={0} row />,
        <Field label="Your team, you included" value="4" />,
        <Rows rows={[["Growth, monthly", "No GST charged", <b key="price">{rupees(growth.monthly)}</b>]]} />,
        <Line><Btn press>Pay and start</Btn></Line>,
      ),
    ],
  },
  "connect-email": {
    icon: MailIcon,
    frames: [
      f(0, ["Settings", "Settings"], <Rows rows={[["Email and drive", null, <Btn key="b" quiet press>Change</Btn>], ["Office and sign in", null, <Btn key="b" quiet>Change</Btn>], ["Reminders and papers", null, <Btn key="b" quiet>Change</Btn>]]} />),
      f(
        1,
        settings("Email and drive"),
        <Card title="Firm email" line="The address your clients write to. InboxCA reads only your clients' emails, keeps no copy of them, and replies from this address.">
          <Line><Btn quiet press>Connect with Google</Btn><Btn quiet>Connect with Microsoft</Btn><Btn quiet>Connect with Zoho</Btn></Line>
        </Card>,
      ),
      f(
        2,
        settings("Email and drive"),
        <Card title="Firm email" line="Or connect with the address and its password.">
          <Field label="The firm's email address" value={firm} />
          <Field label="Its password" value="••••••••••••" />
        </Card>,
        <Note>Gmail, Google Workspace and Zoho need an app password.</Note>,
        <Line><Btn press>Connect email</Btn></Line>,
      ),
      f(2, settings("Email and drive"), <Card title="Firm email"><Line><Chip tone="done" cue>Connected</Chip><strong>{firm}</strong></Line></Card>, <Field label="Emails in 24 hours" value="500" />, <Note>InboxCA finds the mail servers itself and replies from this address.</Note>),
    ],
  },
  "connect-drive": {
    icon: HardDrive,
    frames: [
      f(0, settings("Email and drive"), <Card title="Firm email"><Line><Chip tone="done">Connected</Chip><strong>{firm}</strong></Line></Card>, <Card focus title="Firm drive" line="Client papers are saved in your firm's own drive, in folders by year, client and type of work." />),
      f(1, settings("Email and drive"), <Card title="Firm drive"><Choice label="Which drive" items={["OneDrive", "Dropbox"]} pick={0} /></Card>),
      f(
        2,
        settings("Email and drive"),
        <Card title="What you are allowing InboxCA to do" line="Read the files in the folders you choose, and every file it saves. Save papers from client emails. It will not delete a file without your approval or share anything outside your firm." />,
        <Ticks items={[["I have read this and I agree, on behalf of my firm, to the Drive access terms", true]]} />,
        <Line><Btn press>Connect drive</Btn></Line>,
      ),
      f(3, settings("Email and drive"), <Card title="Firm drive"><Line><Chip tone="done" cue>Connected</Chip><strong>OneDrive</strong></Line></Card>, <Tree path={["Your OneDrive", "InboxCA"]} />, <Note>InboxCA sets up its folder, which takes a minute.</Note>),
    ],
  },
  "import-clients": {
    icon: FileSpreadsheet,
    still: 2,
    frames: [
      f(0, ["Clients", "Clients"], <Line><Btn quiet>New client</Btn><Btn press>Import from Excel</Btn></Line>, <Rows rows={[["Iyer Foods", "Company"], ["Patel Textiles", "Business"]]} />),
      f(1, ["Clients", "Import from Excel or CSV"], <Note>Download the client list template, or use your own sheet with the column names in row 1.</Note>, <Line><File name="InboxCA client list.xlsx" /></Line>, <Sheet rows={[["Name", "Client type", "Email", "Looked after by"]]} />),
      f(
        2,
        ["Clients", "Import from Excel or CSV"],
        <Sheet
          rows={[
            ["Name", "Client type", "Email", "Looked after by"],
            ["Patel Textiles", "Business", client, "Ravi Kumar"],
            ["Iyer Foods", "Company", "office@iyerfoods.example", "Neha Shah"],
            ["Mehta Traders", "Business", "mehta traders", "Ravi Kumar"],
          ]}
        />,
        <Note>One client on each row. Only Name is needed.</Note>,
      ),
      f(3, ["Clients", "Import from Excel or CSV"], <Field label="CSV or Excel file" value="Clients.xlsx" mono />, <Line><Btn press>Check the file</Btn></Line>),
      f(4, ["Clients", "Import from Excel or CSV"], <Title>2 ready to import, 1 with a problem and left out.</Title>, <Rows rows={[["Row 4, Mehta Traders", "That email address is not valid.", <Chip key="c" tone="late">Problem</Chip>]]} />, <Line><Btn press>Import 2 clients</Btn></Line>),
    ],
  },
  "what-inboxca-does-not-do": {
    icon: ShieldCheck,
    still: 0,
    frames: [
      f(0, ["Clients", "Patel Textiles", "GSTR-3B"], <Split ours={["Prepares the form"]} yours={["Checks every figure", "Files on the portal with its own login"]} />, <Note>InboxCA never asks for portal passwords or OTPs.</Note>),
      f(3, ["Notices", "Notices"], <Rows rows={[["Patel Textiles", "Intimation u/s 143(1)", <Chip key="c">Open</Chip>]]} />, <Split ours={["Keeps track of the notice"]} yours={["Writes and sends every reply"]} />),
      f(5, [null, "Firm email"], <Mail from="Patel Textiles" line={`To ${firm}`} subject="Papers for September" files={["IMG_2291.pdf", "Sales Sep.xlsx"]} />, <Note>No upload page and no upload link. Clients email papers to your firm&apos;s address, as they do today.</Note>),
      f(7, ["Documents", "Documents"], <Tree path={drive} file={bills} />, <Note>Emails stay in your mailbox and papers in your drive.</Note>),
    ],
  },
  "papers-by-email": {
    icon: Paperclip,
    frames: [
      f(0, [null, "Firm email"], <Mail from="Patel Textiles" line={`To ${firm}`} subject="Purchase bills for September" body="Please find attached our purchase bills for September." files={["IMG_2291.pdf"]} />),
      f(1, ["Inbox", "Inbox"], <Mail from="Patel Textiles" line={client} subject="Purchase bills for September" files={["IMG_2291.pdf"]} scan />, <Chips label="InboxCA read this as" items={["Client: Patel Textiles", "Purchase bills", "Sep 2026"]} />),
      f(2, ["Documents", "Documents"], <Rename from="IMG_2291.pdf" to={bills} />, <Tree path={drive} file={bills} />),
      f(3, ["Inbox", "Inbox"], <Rows rows={[["Patel Textiles", "Purchase bills for September", <Chip key="c" tone="done">Answered by InboxCA</Chip>], ["Mehta Traders", "A question about our fees", <Chip key="c">Needs reply</Chip>], ["Iyer Foods", "Bank statement for September", <Chip key="c" tone="done">Answered by InboxCA</Chip>]]} />),
    ],
  },
  "to-check": {
    icon: ListChecks,
    still: 0,
    frames: [
      f(0, ["Documents", "Documents"], <Choice items={["All papers", "To check"]} pick={1} row />, <Rows rows={[[num("IMG_0412.jpg"), "InboxCA could not tell its type and period", <Chip key="c">To check</Chip>], [num("Scan 0917.pdf"), "InboxCA could not tell its period", <Chip key="c">To check</Chip>]]} />),
      f(1, ["Clients", "Patel Textiles", "Documents"], <Rows rows={[[num("IMG_0412.jpg"), "Email from Patel Textiles", <Btn key="b" quiet press>Check</Btn>], [num(bills), "Email from Patel Textiles"]]} />),
      f(2, ["Clients", "Patel Textiles", "IMG_0412.jpg"], <Note>Check its paper type and period, then choose Save.</Note>, <Field label="Paper type" value="Bank statement" select />, <Field label="Period" value="Sep 2026" select />, <Line><Btn press>Save</Btn></Line>),
      f(2, ["Clients", "Patel Textiles", "Documents"], <Rename from="IMG_0412.jpg" to="Patel Textiles - Bank statement - Sep 2026.jpg" />, <Note>InboxCA moves and renames the file in your firm&apos;s drive to match.</Note>),
    ],
  },
  "ask-for-papers": {
    icon: Send,
    still: 1,
    frames: [
      f(0, ["Clients", "Patel Textiles"], <Card title="Patel Textiles" line="Business. Looked after by Ravi Kumar."><Line><Btn press>Ask for papers</Btn></Line></Card>),
      f(
        1,
        ["Clients", "Patel Textiles", "Ask for papers"],
        <Ticks items={[["Bank statement", true], ["Purchase bills", true], ["Sales register", false]]} />,
        <Line><Field label="Anything else, by name" value="Loan statement" /><Field label="For" value="Sep 2026" select /></Line>,
        <Line><Btn press>Ask for papers</Btn></Line>,
      ),
      f(2, [null, "Client's email"], <Mail from="Sharma and Co" line={`${firm}, to Patel Textiles`} subject="Papers for Sep 2026" body="Please send your bank statement, purchase bills and loan statement. Reply to this email with the papers attached." />, <Note>One email, from your firm&apos;s own address.</Note>),
      f(3, ["Clients", "Patel Textiles"], <Title>Papers asked for</Title>, <Rows rows={[["Asked for Bank statement, Purchase bills, Loan statement for Sep 2026", "2 of 3 received", <Chip key="c">2 of 3</Chip>]]} />),
    ],
  },
  replies: {
    icon: Reply,
    frames: [
      f(0, ["Inbox", "Inbox"], <Mail from="Patel Textiles" line={client} subject="Is our September return filed?" scan />, <Chips label="InboxCA read this as" items={["Is my return filed"]} />),
      f(
        1,
        settings("Replies by InboxCA"),
        <Choice label="Is my return filed" items={["Auto", "Ask me first", "Off"]} pick={0} row />,
        <Choice label="Which papers are still needed" items={["Auto", "Ask me first", "Off"]} pick={1} row />,
        <Choice label="Notice received" items={["Auto", "Ask me first", "Off"]} pick={0} row />,
      ),
      f(2, ["Inbox", "Inbox"], <Card title="Sending soon" line="InboxCA sends this reply at 10:47. Undo stops it."><p className="hs-quote">Yes, your GSTR-3B for Sep 2026 is filed.</p><Line><Btn quiet press>Undo</Btn></Line></Card>),
      f(4, ["Inbox", "Inbox"], <Rows rows={[["Patel Textiles", "Is our September return filed?", <Chip key="c" tone="done">Answered by InboxCA</Chip>], ["Mehta Traders", "Can you lower your fees?", <Chip key="c">Needs reply</Chip>]]} />, <Note>Replies are in English, from your records only. A fees question waits for your team.</Note>),
    ],
  },
  "due-dates": {
    icon: CalendarDays,
    still: 1,
    frames: [
      f(0, ["Clients", "Patel Textiles", "Services"], <Ticks items={[["GSTR-1 (monthly)", true], ["GSTR-3B (monthly)", true], ["ITR (non-audit)", true], ["TDS returns 24Q/26Q", false]]} />, <Line><Btn press>Save services</Btn></Line>),
      f(1, ["Calendar", "Calendar"], <Choice items={["List", "Month"]} pick={0} row />, <Rows rows={[["Mehta Traders", "GSTR-3B, Sep 2026", <Chip key="c" tone="late">Late</Chip>], ["Patel Textiles", "GSTR-1, Sep 2026", <Chip key="c">Due in 7 days</Chip>], ["Iyer Foods", "TDS return", <Chip key="c">Due in 30 days</Chip>], ["Anita Rao", "ITR", <Chip key="c" tone="done">Filed</Chip>]]} />),
      f(3, ["Today", "Your list"], <Rows rows={[["Mehta Traders", "GSTR-3B, Sep 2026", <Btn key="b" press>Mark filed</Btn>]]} />, <Line><Chip tone="done" cue>Filed</Chip><Btn quiet>Undo</Btn></Line>),
      f(6, ["Clients", "Mehta Traders"], <Line><Btn press>Remind client</Btn></Line>, <Mail from="Sharma and Co" line={`${firm}, to Mehta Traders`} subject="Your returns and papers" body="Your GSTR-3B for Sep 2026 is late. We still need your bank statement for September." />),
    ],
  },
  "gst-month-end": {
    icon: Receipt,
    still: 2,
    frames: [
      f(0, ["Today", "Today", "Your list"], <Rows rows={[["Mehta Traders", "GSTR-3B, Sep 2026", <Chip key="c" tone="late">Late</Chip>], ["Patel Textiles", "Bank statement", <Chip key="c">Asked for</Chip>]]} />, <Line><Btn press>GST month end</Btn></Line>),
      f(1, ["Today", "GST month end"], <Line><Field label="Month" value="Sep 2026" select /><Field label="Looked after by" value="Ravi Kumar" select /></Line>, <Field label="Tag" value="Any tag" select />, <Note>Returns for a month are filed the month after, so last month opens first.</Note>),
      f(2, ["Today", "GST month end"], <Title>Patel Textiles, Sep 2026</Title>, <Rows rows={[["Papers", null, <Chip key="c" tone="done">In</Chip>], ["GSTR-2B", null, <Chip key="c" tone="done">In</Chip>], ["Differences", "2 bills not in GSTR-2B", <Btn key="b" quiet press>See differences</Btn>]]} />),
      f(2, ["Today", "GST month end"], <Title>Patel Textiles, Sep 2026</Title>, <Rows rows={[["GSTR-1", "Waiting for approval", <Btn key="b" quiet press>Review</Btn>], ["GSTR-3B", null, <Chip key="c">Not started</Chip>], ["Filed", null, <Chip key="c">Not yet</Chip>]]} />),
    ],
  },
  itr: {
    icon: FileText,
    still: 2,
    frames: [
      f(0, ["Clients", "Anita Rao", "Documents"], <Rows rows={[[num("Form 16.pdf"), "Email from Anita Rao", <Chip key="c" tone="done">Saved</Chip>], [num("Form 26AS.pdf"), "Portal file, added by Ravi Kumar", <Chip key="c" tone="done">Saved</Chip>], [num("AIS.pdf"), "Portal file, added by Ravi Kumar", <Chip key="c" tone="done">Saved</Chip>], [num("TIS.pdf"), "Portal file, added by Ravi Kumar", <Chip key="c" tone="done">Saved</Chip>]]} />),
      f(1, ["Clients", "Anita Rao", "ITR-1"], <Figures rows={[["Salary", "Form 16, page 2", "₹12,40,000"], ["Tax deducted", "Form 26AS, page 1", "₹1,02,500"], ["Savings interest", "AIS, page 3", "₹8,420"]]} />, <Note>Every figure opens the page it was read from.</Note>),
      f(2, ["Clients", "Anita Rao", "ITR-1"], <Figures checked rows={[["Salary", "Form 16, page 2", "₹12,40,000"], ["Tax deducted", "Form 26AS, page 1", "₹1,02,500"], ["Savings interest", "AIS, page 3", "₹8,420"]]} />, <Track items={itrSteps} done={1} />),
      f(3, ["Clients", "Anita Rao", "ITR-1"], <Track items={itrSteps} done={3} />, <Line><Btn press>Download for filing</Btn></Line>, <Note>Your team files it on the income tax portal, then marks it filed here.</Note>),
    ],
  },
  tds: {
    icon: FileText,
    still: 3,
    frames: [
      f(0, ["Clients", "Patel Textiles", "TDS statement details"], <Field label="Deductor's name as on the TAN" value="Patel Textiles" />, <Field label="Person responsible" value="Ramesh Patel" />, <Line><Btn press>Save details</Btn></Line>),
      f(1, ["Documents", "Documents"], <Rows rows={[[num("TDS register Jul to Sep 2026.xlsx"), "Email from Patel Textiles", <Chip key="c" tone="done">Saved</Chip>], [num("Challan ITNS 281.pdf"), "Email from Patel Textiles", <Chip key="c" tone="done">Saved</Chip>]]} />, <Note>Filed under TDS, Jul to Sep 2026.</Note>),
      f(2, ["Clients", "Patel Textiles", "TDS statement"], <Figures rows={[["Payments read", "TDS register, sheet 1", "42"], ["Tax deducted", "TDS register, sheet 1", "₹1,84,300"], ["Challans", "Added by Ravi Kumar", "3"]]} />, <Note>Columns are matched once and remembered.</Note>),
      f(3, ["Clients", "Patel Textiles", "TDS statement"], <Figures checked rows={[["Payments read", "TDS register, sheet 1", "42"], ["Tax deducted", "TDS register, sheet 1", "₹1,84,300"], ["Challans", "Added by Ravi Kumar", "3"]]} />, <Line><Btn press>Yes, these figures are right</Btn></Line>),
      f(4, ["Clients", "Patel Textiles", "TDS statement"], <Line><Btn press>Prepare the statement file</Btn></Line>, <Note>Validate it with Protean&apos;s File Validation Utility, file it, then mark it filed here.</Note>),
    ],
  },
  notices: {
    icon: Scale,
    still: 1,
    frames: [
      f(0, ["Notices", "Notices"], <Mail from="Income Tax Department" line={`To ${firm}`} subject="Intimation u/s 143(1)" />, <Chips label="InboxCA found the client" items={["Patel Textiles"]} />),
      f(2, ["Notices", "Notices"], <Rows rows={[["Patel Textiles", "Intimation u/s 143(1)", <Chip key="c">Date to check</Chip>]]} />, <Field label="Action date, as the notice states it" value="24 Nov 2026" />, <Line><Btn press>Mark date checked</Btn></Line>),
      f(3, ["Notices", "Notices"], <Track items={["Open", "In progress", "Replied", "Closed"]} done={2} />, <Line><Btn press>Mark replied</Btn></Line>, <Note>People in your firm write and send every reply.</Note>),
      f(6, ["Notices", "Notices", "Record the reply"], <Field label="Reply sent on" value="12 Nov 2026" />, <Field label="What was sent" value="Response filed on the portal" />, <Field label="Acknowledgement or reference" value="Portal reference" />, <Line><Btn press>Save reply and close</Btn></Line>),
    ],
  },
  "people-and-permissions": {
    icon: Users,
    still: 1,
    frames: [
      f(0, ["People", "People"], <Rows rows={[["Ravi Kumar", "ravi@sharmaco.example", <Chip key="c">Owner</Chip>], ["Neha Shah", "neha@sharmaco.example", <Chip key="c">Manager</Chip>]]} />, <Line><Btn press>Invite person</Btn></Line>),
      f(0, ["People", "Invite person"], <Field label="Their work email" value="priya@sharmaco.example" />, <Choice label="Role" items={["Partner", "Manager", "Staff", "Front desk"]} pick={2} row />, <Line><Btn press>Send invite</Btn></Line>),
      f(1, [null, "Sign in to InboxCA"], <Code label="Code from the email" digits="318604" />, <Note>Priya signs in with the code from her email.</Note>),
      f(1, [null, "Set up your 2 step code"], <Line><Qr /><Note>Then she sets up her own 2 step code with an authenticator app.</Note></Line>, <Code label="6 digit code from the app" digits="952071" />),
    ],
  },
  "office-only": {
    icon: Monitor,
    still: 0,
    frames: [
      f(0, settings("Office and sign in"), <Choice label="How your team works" items={["Standard", "Office only", "Office and approved remote", "Remote friendly", "Solo CA"]} pick={1} />),
      f(2, settings("Office and sign in"), <Title>Office only</Title>, <Rows rows={[["Staff, managers and front desk", "Approved PCs, in the office, in office hours"], ["You and partners", "From anywhere"]]} />),
      f(6, [null, "InboxCA"], <Card title="This PC is waiting for approval" line="Ask the owner to approve it in Settings, then try again."><Line><Btn quiet>Try again</Btn></Line></Card>),
      f(6, settings("Office and sign in"), <Title>PCs waiting for approval</Title>, <Rows rows={[["Front desk PC", "Chrome on Windows", <Btn key="b" press>Approve as office PC</Btn>]]} />, <Line><Chip tone="done" cue>Approved</Chip></Line>),
      f(7, [null, "Sign in to InboxCA"], <Code label="Code from the email" digits="604218" />, <Chips items={["On the office internet", ["Approved PC", "done"]]} />, <Note>Here the email code is enough.</Note>),
    ],
  },
  "sign-in": {
    icon: KeyRound,
    still: 2,
    frames: [
      f(0, [null, "Sign in to InboxCA"], <Field label="Your work email" value="ravi@sharmaco.example" />, <Line><Btn press>Email me a code</Btn></Line>),
      f(0, [null, "Sign in to InboxCA"], <Code label="Code from the email" digits="482913" />, <Line><Btn press>Continue</Btn></Line>),
      f(1, [null, "Enter your 2 step code"], <Code label="6 digit code from the app" digits="705316" />, <Note>Codes in the app change every 30 seconds.</Note>, <Line><Btn press>Continue</Btn></Line>),
      f(1, [null, "Confirm it is you"], <Passkey />, <Note>Or use your passkey in place of the 6 digit code.</Note>),
    ],
  },
  "report-a-problem": {
    icon: MessageSquareWarning,
    frames: [
      f(0, [null, "Help"], <Note>Contact Orelu support, or tell us from here.</Note>, <Line><Btn press>Report a problem or idea</Btn></Line>),
      f(1, [null, "Report a problem or idea"], <Choice label="What is it" items={["Something is broken", "Something does not work as expected", "An idea or a feature I need", "Something is out of date"]} pick={0} />),
      f(2, [null, "Report a problem or idea"], <Field label="Subject" value="Upload papers does nothing" />, <Field label="Details, if you like" value="I chose the file and nothing happened." />),
      f(3, [null, "Report a problem or idea"], <Line><Btn quiet>Take a screenshot</Btn><Btn quiet>Record the screen</Btn></Line>, <File name="Screenshot.png" />),
      f(4, [null, "Report a problem or idea"], <Note>Pictures and recordings can show client details. They go only to Orelu support.</Note>, <Line><Btn press>Send to Orelu</Btn></Line>, <Chips items={[["Sent to Orelu", "done"]]} />),
    ],
  },
  plans: {
    icon: IndianRupee,
    still: 1,
    frames: [
      f(0, [null, "Plans"], <Plan name="Solo" />),
      f(1, [null, "Plans"], <Plan name="Growth" />),
      f(5, settings("Billing"), <Rows rows={[["One more person in your team", "Paid first, then added", <b key="p">{rupees(extraPerson)} a month</b>], [`One more AI block of ${aiBlock.credits.toLocaleString("en-IN")} credits every month`, "Paid first, then added", <b key="p">{rupees(aiBlock.price)} a month</b>]]} />, <Note>No GST is charged: Orelu is not GST registered yet.</Note>),
      f(7, settings("Billing"), <Meter label="Returns due so far" part={0.8} note="You hear about it at 80%." />),
      f(9, settings("Billing"), <Choice label="How to pay" items={["UPI AutoPay", "Card AutoPay", "Bank mandate (eNACH)"]} pick={0} row />, <Chips items={[["Your bank confirmed AutoPay", "done"]]} />),
    ],
  },
  "money-back": {
    icon: RotateCcw,
    still: 0,
    frames: [
      f(0, settings("Billing"), <Card title="Money back" line="Cancel by 24 Oct 2026, within 14 days of your first payment, and get it back in full." />, <Code label="6 digit code from your authenticator app" digits="291745" />, <Line><Btn press>Cancel and get my money back</Btn></Line>),
      f(2, settings("Billing"), <Card title="Money back" line="Your plan is cancelled and your money is on its way back. Banks usually take 5 to 7 working days." />, <Note>Through Cashfree, to the same card, UPI or bank account.</Note>),
      f(3, settings("Billing"), <Rows rows={[["AutoPay", "Stops the next payment", <Btn key="b" quiet press>Turn AutoPay off</Btn>]]} />, <Note>You keep your plan until the period you paid for ends.</Note>),
      f(5, settings("Your data"), <Line><Btn press>Download your data</Btn></Line>, <Line><File name="inboxca-data-2026-10-24.zip" /></Line>, <Note>Your files are in your own drive, so they stay with you.</Note>),
    ],
  },
};
