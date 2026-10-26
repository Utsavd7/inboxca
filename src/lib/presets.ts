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

// The preset a firm's rules match now, if any.
export function presetOf(settings: Record<string, unknown>) {
  const office = (settings.office ?? {}) as Office;
  const access = (settings.access ?? {}) as { hours_only?: boolean; idle_minutes?: number; india_only?: boolean };
  return (Object.keys(presets) as Preset[]).find((key) => {
    const preset = presets[key];
    return !!office.on === preset.office && (!preset.office || (office.away ?? true) === preset.away && !!office.anywhere === preset.anywhere)
      && !!access.hours_only === preset.hours_only && (Number(access.idle_minutes) || 0) === preset.idle_minutes && !!access.india_only === preset.india_only;
  });
}
