// All pricing, allowances and plan-related figures live here. Deck page 8.
// Estimates only. Set false to hide the section AND its navigation link.
export const SHOW_PLANS = true;
export const plans = [
  {
    name: "Solo",
    clients: "70 clients",
    monthly: 1499,
    yearly: 16499,
    returns: "800",
    storage: "4 GB",
    ai: "4,000",
    team: "Just you",
  },
  {
    name: "Growth",
    clients: "170 clients",
    monthly: 3799,
    yearly: 41799,
    returns: "2,000",
    storage: "10 GB",
    ai: "10,000",
    team: "up to 10",
  },
  {
    name: "Scale",
    clients: "340 clients",
    monthly: 7649,
    yearly: 84149,
    returns: "4,000",
    storage: "20 GB",
    ai: "24,000",
    team: "up to 20",
  },
  {
    name: "Enterprise",
    clients: "700 clients",
    monthly: 15299,
    yearly: 168299,
    returns: "8,000",
    storage: "40 GB",
    ai: "60,000",
    team: "up to 40",
  },
  {
    name: "Custom (yours)",
    clients: "800 to 1,000 clients",
    monthly: 19499,
    yearly: 214499,
    returns: "about 10,300",
    storage: "about 54 GB",
    ai: "81,000",
    team: "up to 40",
    estimate: true,
  },
] as const;
export const planIntro =
  "Every plan: unlimited clients and every feature. Pay yearly: 1 month free. Money back within 14 days on your first plan payment.";
export const planNotes = [
  "Custom plan, for firms bigger than Enterprise: enter your clients, kind of practice and team size on our website and see your price at once.",
  "InboxCA storage: InboxCA's own working space for your client list, records and the numbers it reads from your files. A new file waits there only until its folder is made in your drive, and that wait is not counted.",
  "Your files: they stay in your own OneDrive or Dropbox. Clients are unlimited; “suits about” is only a guide.",
  "Later: if your firm grows, your dashboard shows the new plan and price. One time setup: about ₹5,080. Extra a month: one more person ₹399, more AI ₹399.",
] as const;
export const planRows = [
  ["Suits about", "clients"],
  ["Price a month", "monthly"],
  ["Price a year (1 month free)", "yearly"],
  ["Returns you file in a year", "returns"],
  ["InboxCA storage in a year", "storage"],
  ["AI allowance a month (credits)", "ai"],
  ["Your whole team, you included", "team"],
] as const;
export const rupees = (value: number) => `₹${value.toLocaleString("en-IN")}`;
