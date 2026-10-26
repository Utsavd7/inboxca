import { periodName } from "./documents";
import { askName, paperType } from "./paper-type";
import { reminderEmail } from "./reminders";
import { CODE_MINUTES } from "./share-codes";

// InboxCA writes to clients in English only.
export const TEMPLATE_VERSION=1;
export const emailTemplates={
  reminder:reminderEmail,
  received(client:string,firm:string,files:{type:string;period:string;toCheck:boolean}[]) {
    const named=files.filter((file)=>!file.toCheck).map((file)=>`- ${[file.type,periodName(file.period)].filter(Boolean).join(", ")}`);
    const unclear=files.filter((file)=>file.toCheck).length;
    return {subject:"We have received your papers",text:[`Dear ${client},`,"","Thank you. We have received:",...named,...(unclear ? [`- ${unclear===1 ? "1 more paper. Our team will check it." : `${unclear} more papers. Our team will check these.`}`] : []),"",firm].join("\n")};
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
  code(code:string,firm:string) {
    return {subject:"Your code to open the document",text:[`Your code is ${code}.`,"",`It works for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,"",firm].join("\n")};
  },
};
