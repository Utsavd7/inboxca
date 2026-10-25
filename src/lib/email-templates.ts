import { periodName } from "./documents";
import { reminderEmail } from "./reminders";
import { CODE_MINUTES } from "./share-codes";

// English only until a native speaker approves Hindi and Gujarati wording.
export const TEMPLATE_VERSION=1;
export const emailTemplates={
  reminder:reminderEmail,
  received(client:string,firm:string,files:{type:string;period:string;toCheck:boolean}[]) {
    const named=files.filter((file)=>!file.toCheck).map((file)=>`- ${[file.type,periodName(file.period)].filter(Boolean).join(", ")}`);
    const unclear=files.filter((file)=>file.toCheck).length;
    return {subject:"We have received your files",text:[`Dear ${client},`,"","Thank you. We have received:",...named,...(unclear ? [`- ${unclear===1 ? "1 file" : `${unclear} files`} our team will check`] : []),"",firm].join("\n")};
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
  followUp(lead:string,firm:string,service:string) {
    return {subject:`Your enquiry with ${firm}`,text:[`Dear ${lead},`,"",`Thank you for contacting ${firm}${service ? ` about ${service}` : ""}. We would be glad to help.`,"","Please reply to this email with a good time to talk, or with any questions you have.","",firm].join("\n")};
  },
  code(code:string,firm:string) {
    return {subject:"Your code to open the document",text:[`Your code is ${code}.`,"",`It works for ${CODE_MINUTES} minutes. If you did not ask for it, you can ignore this email.`,"",firm].join("\n")};
  },
};
