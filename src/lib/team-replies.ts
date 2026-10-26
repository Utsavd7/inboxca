import { periodName } from "./documents";

// Emails InboxCA could not answer wait for a person (PLAN.md "Inbox, answered" E). Late after
// this many working days unless the owner chose another in Settings (public.team_replies).
export const REPLY_DAYS = 2;

// "Waiting 2 days": how long an email has waited, in whole days since the day it came; nothing
// on its first day.
export const waitingWords = (days: number) => (days < 1 ? "" : `Waiting ${days === 1 ? "1 day" : `${days} days`}`);

// The reply InboxCA suggests for an email it could not answer, by why it waits (replyReasons in
// triage.ts): a short answer in the firm's voice for the person to change and send. Only what
// is known goes in: the names of the person writing, the client and the firm, and the paper the
// rules read in the email; never advice, a figure or a date. Any other reason gets the first.
export function suggestedReply(reason: string | null | undefined, { name, client, firm, paper }: { name: string; client: string; firm: string; paper?: { types: string[]; period: string } }) {
  const asked = paper?.types.length ? `the ${paper.types[0]}${paper.period ? ` for ${periodName(paper.period)}` : ""}` : "the paper you asked for";
  const lines: Record<string, string> = {
    no_rule: "Thank you for your email. We are looking into it and will get back to you soon.",
    notice_question: "Thank you for sending the notice. We have received it and our team is going through it. We will get back to you soon about what is needed.",
    record_internal: `Thank you for your email. We have your request for ${asked}. Someone from our team will look at it and get back to you.`,
    record_not_found: `Thank you for your email. We could not find ${asked} in our records just now. We will look for it and send it to you as soon as we have it.`,
    record_unclear: "Thank you for your email. Could you tell us which paper you need, and for which year? We will send it once we know.",
    not_allowed: `Thank you for your email. For safety, we send the papers of ${client} only to the email addresses on our records. Please ask ${client} to write to us, or to tell us to add your address.`,
    data_unclear: "Thank you for sending these papers. Could you tell us what they are for, such as GST or income tax, and for which month or year?",
    asks_several: "Thank you for your email. We have noted each of your questions and will answer all of them soon.",
    ask_filed: "Thank you for your email. We are checking whether the return you asked about is filed and will let you know soon.",
    ask_papers: "Thank you for your email. We are checking which papers we still need from you and will send you the list soon.",
    ask_due: "Thank you for your email. We are checking what is due for you and will send you the dates soon.",
    status_not_filed: "Thank you for your email. We are checking where the return you asked about stands, and will tell you as soon as it is filed.",
    status_unclear: "Thank you for your email. Could you tell us which return you mean, and for which month or year? We will then tell you where it stands.",
    papers_none: "Thank you for your email. We will check whether we need any more papers from you and let you know.",
    due_unchecked: "Thank you for your email. We are confirming your due dates and will send them to you soon.",
    due_late: "Thank you for your email. We are looking at what is due for you and will get back to you soon about the next steps.",
    due_none: "Thank you for your email. We will check what is coming up for you and let you know.",
    answer_not_allowed: `Thank you for your email. For safety, we share the details of ${client} only with the email addresses on our records. Please ask ${client} to write to us, or to tell us to add your address.`,
  };
  return `Dear ${name},\n\n${lines[reason ?? ""] ?? lines.no_rule}\n\nRegards,\n${firm}`;
}
