// All pricing, allowances and plan figures live here. Estimates only, before GST.
// Keep every number in step with the business plan. No price is typed in a component.
// Set false to hide the section AND its navigation link.
export const SHOW_PLANS = true;

// `clients` is a guide for a mixed practice, never a limit: clients are unlimited.
// `maxReturns` and `people` are what the plan includes; they drive the estimate.
export const plans = [
  {
    name: "Solo",
    clients: 70,
    monthly: 1499,
    yearly: 16499,
    maxReturns: 800,
    people: 1,
    returns: "800",
    storage: "4 GB",
    ai: "4,000",
    team: "Just you",
  },
  {
    name: "Growth",
    clients: 170,
    monthly: 3499,
    yearly: 38499,
    maxReturns: 2000,
    people: 10,
    returns: "2,000",
    storage: "10 GB",
    ai: "10,000",
    team: "Up to 10",
  },
  {
    name: "Scale",
    clients: 340,
    monthly: 7499,
    yearly: 82499,
    maxReturns: 4000,
    people: 20,
    returns: "4,000",
    storage: "20 GB",
    ai: "24,000",
    team: "Up to 20",
  },
  {
    name: "Enterprise",
    clients: 700,
    monthly: 15499,
    yearly: 170499,
    maxReturns: 8000,
    people: 40,
    returns: "8,000",
    storage: "40 GB",
    ai: "60,000",
    team: "Up to 40",
  },
] as const;

// Returns a client in a year, by kind of practice (working values from the business plan).
// The mixed rate is 8,000 ÷ 700, so it always agrees with the "suits about" figures.
export const practices = [
  ["salaried", "Mostly salaried", 2],
  ["mixed", "Mixed", 8000 / 700],
  ["gst", "Mostly GST and audit", 18],
] as const;

// One more person on a fixed plan, a month.
export const extraPerson = 399;

// The Custom plan, for firms above Enterprise on work or people. One size step is
// 200 returns a year. Slabs work like income tax slabs: [up to, rate a month].
export const custom = {
  base: 15499,
  floor: 16499,
  ending: 499,
  returnsPerStep: 200,
  includedSteps: 40,
  includedPeople: 40,
  workSlabs: [
    [80, 305],
    [Infinity, 275],
  ],
  peopleSlabs: [
    [60, 399],
    [100, 349],
    [Infinity, 299],
  ],
  aiCredits: 60000,
  aiPerStep: 1500,
  yearlyMonths: 11,
  yearlyAdd: 10,
} as const;

export const planRows = [
  ["Returns a year", "returns"],
  ["Storage a year", "storage"],
  ["AI credits a month", "ai"],
  ["Team, you included", "team"],
] as const;

export const rupees = (value: number) => `₹${value.toLocaleString("en-IN")}`;
