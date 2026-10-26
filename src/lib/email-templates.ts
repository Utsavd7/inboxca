import type { AnswerKind } from "./answers";
import { periodName } from "./documents";
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
  paper(client:string,firm:string,name:string,link:string,privatePaper:boolean,reply:boolean) {
    return {subject:reply ? `Re: your request for ${name}` : name,text:[`Dear ${client},`,"",`${firm} has shared ${name} with you.`,"",`Download it here: ${link}`,privatePaper ? "It is private: the page emails a one-time code to this address before it opens. The link works for 7 days and up to 5 downloads." : "The link works for 7 days and up to 5 downloads.","",firm].join("\n")};
  },
  request(client:string,firm:string,period:string,items:{type:string}[],link:string) {
    const when=period ? ` for ${periodName(period)}` : "";
    return {subject:`Documents needed${when}`,text:[`Dear ${client},`,"",`Please upload these documents${when}:`,...items.map((item)=>`- ${item.type}`),"",`Upload them here, no sign in needed: ${link}`,"The link works for 30 days.","",firm].join("\n")};
  },
  receipt(client:string,firm:string,period:string,items:{type:string;received:string[]}[]) {
    const when=period ? ` for ${periodName(period)}` : "";
    const missing=items.filter((item)=>!item.received.length).map((item)=>`- ${item.type}`);
    const got=items.filter((item)=>item.received.length).map((item)=>`- ${item.type}: ${item.received.length===1 ? "1 file" : `${item.received.length} files`}`);
    return {subject:`We have received your papers${when}`,text:[`Dear ${client},`,"",`Thank you. We have received these papers${when}:`,...got,"",...(missing.length ? ["Still needed:",...missing,"","Please add them with the upload link we sent you."] : ["That is everything we asked for."]),"",firm].join("\n")};
  },
  code(code:string,firm:string) {
    return {subject:"Your code to open the document",text:[`Your code is ${code}.`,"",`It works for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,"",firm].join("\n")};
  },
};
