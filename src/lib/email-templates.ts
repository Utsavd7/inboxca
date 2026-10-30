import type { AnswerKind } from "./answers";
import { periodName } from "./documents";
import { askName, paperType } from "./paper-type";
import { reminderEmail } from "./reminders";
import { CODE_MINUTES } from "./share-codes";

// InboxCA writes to clients in English only.
export const TEMPLATE_VERSION=1;
export const emailTemplates={
  reminder:reminderEmail,
  // InboxCA's answer to a client's email (src/lib/answers.ts), its lines built from the firm's records.
  answer(kind:AnswerKind,client:string,firm:string,lines:string[]) {
    const [subject,opening]=({
      filed:["Returns filed","Thank you for your email. As per our records:"],
      papers:["Papers still needed","Thank you for your email.\n"],
      due:["What is due","Thank you for your email. As per our records, these are due:"],
      received:["We received your papers","Thank you. We received these papers:"],
      notice:["We received your notice","We received your notice. Your CA will look at it."],
    } as const)[kind];
    return {subject,text:[`Dear ${client},`,"",opening,...lines,"",firm].join("\n")};
  },
  // The client reads the paper's type and period ("Form 16 for FY 2025-26"), never the drive's
  // file name with its version; a paper of no known type keeps its name.
  paper(client:string,firm:string,name:string,link:string,privatePaper:boolean,reply:boolean,paper?:{type:string;period:string}) {
    const what=paper?.type && paper.type!=="Document" ? `${paperType(paper.type)}${paper.period ? ` for ${periodName(paper.period)}` : ""}` : name;
    return {subject:reply ? `Re: your request for ${what}` : `${what} from ${firm}`,text:[`Dear ${client},`,"",`${firm} has shared ${what} with you.`,"",`Download it here: ${link}`,privatePaper ? "This paper is private. When you open the link, choose Email me a code. We send a 6 digit code to this email address. The link works for 7 days and up to 5 downloads." : "The link works for 7 days and up to 5 downloads.","",firm].join("\n")};
  },
  request(client:string,firm:string,period:string,items:{type:string}[],link:string) {
    const when=period ? ` for ${periodName(period)}` : "";
    return {subject:`Documents needed${when}`,text:[`Dear ${client},`,"",`Please upload these documents${when}:`,...items.map((item)=>`- ${askName(item.type)}`),"",`Upload them here, no sign in needed: ${link}`,"The link works for 30 days.","",firm].join("\n")};
  },
  receipt(client:string,firm:string,period:string,items:{type:string;received:string[]}[]) {
    const when=period ? ` for ${periodName(period)}` : "";
    const missing=items.filter((item)=>!item.received.length).map((item)=>`- ${item.type}`);
    const got=items.filter((item)=>item.received.length).map((item)=>`- ${item.type}: ${item.received.length===1 ? "1 file" : `${item.received.length} files`}`);
    return {subject:`We have received your papers${when}`,text:[`Dear ${client},`,"",`Thank you. We have received these papers${when}:`,...got,"",...(missing.length ? ["Still needed:",...missing,"","Please add them with the upload link we sent you."] : ["That is everything we asked for."]),"",firm].join("\n")};
  },
  // The text filled into a WhatsApp click to chat link for papers still missing; a person sends it.
  whatsapp(client:string,firm:string,period:string,items:{type:string}[],link:string) {
    const when=period ? ` for ${periodName(period)}` : "";
    return [`Dear ${client},`,`${firm} still needs these papers${when}:`,...items.map((item)=>`- ${askName(item.type)}`),link ? `Please upload them here, no sign in needed: ${link}` : "",`Thank you.`].filter(Boolean).join("\n");
  },
  // After an income tax return is marked filed: one reminder to e-verify it, with the last day.
  verify(client:string,firm:string,what:string,filedOn:string,by:string) {
    return {subject:`Please e-verify your ${what}`,text:[`Dear ${client},`,"",`Your ${what} was filed on ${filedOn}. Please e-verify it on the income tax e-filing portal by ${by}, within 30 days of filing. The return is complete only once it is verified.`,"","You can e-verify with Aadhaar OTP, net banking or a bank account on the portal. If you have already verified it, please ignore this email.","",firm].join("\n")};
  },
  code(code:string,firm:string) {
    return {subject:"Your code to open the document",text:[`Your code is ${code}.`,"",`It works for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,"",firm].join("\n")};
  },
};
