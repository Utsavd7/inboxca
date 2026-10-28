import type { Office } from "./office";

// Access presets (PLAN.md 5.17): one choice that sets the existing rules, each still
// editable after. Office presets sign idle screens out after 15 minutes, for shared PCs
// (5.17.4 #3). Nothing is stored about the choice: the page finds the preset the rules match.
export const presets = {
  standard: { name: "Standard", line: "Everyone signs in with the 2 step code, on any computer, from anywhere, at any time.", office: false, anywhere: false, away: true, hours_only: false, idle_minutes: 0, india_only: false },
  office: { name: "Office only", line: "Staff, managers and front desk work only on approved PCs in the office, in office hours. You and partners work from anywhere.", office: true, anywhere: false, away: false, hours_only: true, idle_minutes: 15, india_only: false },
  office_remote: { name: "Office and approved remote", line: "Same as Office only, and staff may also ask to use their own laptop away from the office. You approve it for a few days, and they can only view.", office: true, anywhere: false, away: true, hours_only: true, idle_minutes: 15, india_only: false },
  remote: { name: "Remote friendly", line: "Staff, managers and front desk work from anywhere in India, on computers you approve, in office hours. You and partners work from anywhere.", office: true, anywhere: true, away: false, hours_only: true, idle_minutes: 0, india_only: true },
  solo: { name: "Solo CA", line: "For a CA who works alone from different places: InboxCA signs you out after 15 minutes without use. Any staff work only on approved PCs in the office.", office: true, anywhere: false, away: false, hours_only: false, idle_minutes: 15, india_only: false },
};
export type Preset = keyof typeof presets;

// The firm's rules now, in the presets' terms.
function rulesOf(settings: Record<string, unknown>) {
  const office = (settings.office ?? {}) as Office;
  const access = (settings.access ?? {}) as { hours_only?: boolean; idle_minutes?: number; india_only?: boolean };
  return { office: !!office.on, away: office.away ?? true, anywhere: !!office.anywhere, hours_only: !!access.hours_only, idle_minutes: Number(access.idle_minutes) || 0, india_only: !!access.india_only };
}

// The preset a firm's rules match now, if any.
export function presetOf(settings: Record<string, unknown>) {
  const rules = rulesOf(settings);
  return (Object.keys(presets) as Preset[]).find((key) => {
    const preset = presets[key];
    return rules.office === preset.office && (!preset.office || rules.away === preset.away && rules.anywhere === preset.anywhere)
      && rules.hours_only === preset.hours_only && rules.idle_minutes === preset.idle_minutes && rules.india_only === preset.india_only;
  });
}

// For rules that match none: the preset they differ from least, the first such in the list.
export function closestPreset(settings: Record<string, unknown>) {
  const rules = rulesOf(settings);
  const same = (key: Preset) => (Object.keys(rules) as (keyof typeof rules)[]).filter((rule) => presets[key][rule] === rules[rule]).length;
  return (Object.keys(presets) as Preset[]).reduce((best, key) => (same(key) > same(best) ? key : best));
}
