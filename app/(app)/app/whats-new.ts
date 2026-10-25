// What changed in InboxCA lately, newest first, for the What's new panel. The sidebar shows a
// dot until the person opens the panel after the newest date here (the news_seen cookie).
export type News = { date: string; title: string; line: string; icon: "sparkles" | "upload" | "inbox" | "shield" | "calendar" | "file" };

export const news: News[] = [
  { date: "2026-10-25", title: "A new look, with dark mode", line: "A lighter sidebar you can fold, a header that keeps each page's actions in view, and a Dark theme in your account menu.", icon: "sparkles" },
  { date: "2026-10-25", title: "Clearer upload links for clients", line: "Clients see a checklist of the papers you asked for, with progress, and get an emailed receipt.", icon: "upload" },
  { date: "2026-10-25", title: "GSTR-2A invoices from the portal", line: "Add the GST portal download with Add portal files, and InboxCA reads its B2B invoices.", icon: "file" },
  { date: "2026-10-25", title: "Office only for branch offices", line: "Each branch can have its own office connection for Office only.", icon: "shield" },
  { date: "2026-10-25", title: "Write to a client from the Inbox", line: "Start a new email to a client from the Inbox, sent from your firm's own address.", icon: "inbox" },
  { date: "2026-10-24", title: "Late returns for everyone", line: "Everyone who looks after a client sees its late returns on Today, and can mark them filed with an undo.", icon: "calendar" },
];

export const newsLatest = news[0].date;
