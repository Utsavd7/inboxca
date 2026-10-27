import { custom, extraPerson, plans, practices } from "@/content/plans";

export const sitePrices = { plans, practices, extraPerson, custom };

export type Practice = (typeof practices)[number][0];
type Slabs = readonly (readonly [number, number])[];
// The figures an estimate reads: the site's price list, or the server's plan_formula (PLAN.md
// 5.14), with which billing prices every payment.
export type Formula = {
  plans: readonly { monthly: number; yearly: number; maxReturns: number; people: number }[];
  practices: readonly (readonly [string, string, number])[];
  extraPerson: number;
  custom: { [key in "base" | "floor" | "ending" | "returnsPerStep" | "includedSteps" | "includedPeople" | "aiCredits" | "aiPerStep" | "yearlyMonths" | "yearlyAdd"]: number } & { workSlabs: Slabs; peopleSlabs: Slabs };
};

// Slabs work like income tax slabs: only the part inside a slab pays that slab's rate.
function slabs(
  count: number,
  from: number,
  table: readonly (readonly [number, number])[],
) {
  let total = 0;
  let start = from;
  for (const [upTo, rate] of table) {
    if (count > start) total += (Math.min(count, upTo) - start) * rate;
    start = upTo;
  }
  return total;
}

// The plan and price a firm would be shown, from three answers. An estimate: the
// real plan is worked out from the firm's own client list after it joins. `measured` is the
// work the meters moved a firm up to, in returns a year; its plan is never priced below it.
export function estimate(clients: number, practice: Practice, team: number, { plans, practices, extraPerson, custom }: Formula = sitePrices, measured = 0) {
  const rate = practices.find(([key]) => key === practice)![2];
  const returns = Math.max(Math.round(clients * rate), measured);
  const index = plans.findIndex((plan) => returns <= plan.maxReturns);
  if (index !== -1 && team <= custom.includedPeople) {
    const plan = plans[index];
    const extraPeople = Math.max(0, team - plan.people);
    return {
      custom: false as const,
      index,
      returns,
      monthly: plan.monthly,
      yearly: plan.yearly,
      extraPeople,
      extraCost: extraPeople * extraPerson,
    };
  }
  const steps = Math.max(
    custom.includedSteps,
    Math.ceil(returns / custom.returnsPerStep),
  );
  const raw =
    custom.base +
    slabs(steps, custom.includedSteps, custom.workSlabs) +
    slabs(team, custom.includedPeople, custom.peopleSlabs);
  // Every plan price ends in the same three digits; Custom is never below its floor.
  const monthly = Math.max(
    custom.floor,
    Math.round((raw - custom.ending) / 1000) * 1000 + custom.ending,
  );
  return {
    custom: true as const,
    index: plans.length,
    returns,
    monthly,
    yearly: monthly * custom.yearlyMonths + custom.yearlyAdd,
    storageGb: steps,
    aiCredits:
      custom.aiCredits + (steps - custom.includedSteps) * custom.aiPerStep,
  };
}
