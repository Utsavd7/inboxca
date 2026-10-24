import type { Office } from "./office";

// Access presets (PLAN.md 5.17): one choice that sets the existing rules, each still
// editable after. Office presets sign idle screens out after 15 minutes, for shared PCs
// (5.17.4 #3). Nothing is stored about the choice: the page finds the preset the rules match.
export const presets = {
  standard: { name: "Standard", line: "Everyone signs in with the 2 step code, on any device, from anywhere, at any time.", office: false, away: true, hours_only: false, idle_minutes: 0 },
  office: { name: "Office only", line: "Staff, managers and front desk work only on approved PCs in the office, in office hours. You and partners work from anywhere.", office: true, away: false, hours_only: true, idle_minutes: 15 },
  office_remote: { name: "Office and approved remote", line: "Like Office only, and staff may ask to use their own device away from the office; you allow it for some days, to view only.", office: true, away: true, hours_only: true, idle_minutes: 15 },
  remote: { name: "Remote friendly", line: "Everyone works from anywhere; everyone but you only in office hours.", office: false, away: true, hours_only: true, idle_minutes: 0 },
  solo: { name: "Solo CA", line: "For one CA who moves: InboxCA signs out after 15 minutes without use. Any staff work only on approved PCs in the office.", office: true, away: false, hours_only: false, idle_minutes: 15 },
};
export type Preset = keyof typeof presets;

// The preset a firm's rules match now, if any.
export function presetOf(settings: Record<string, unknown>) {
  const office = (settings.office ?? {}) as Office;
  const access = (settings.access ?? {}) as { hours_only?: boolean; idle_minutes?: number };
  return (Object.keys(presets) as Preset[]).find((key) => {
    const preset = presets[key];
    return !!office.on === preset.office && (!preset.office || (office.away ?? true) === preset.away)
      && !!access.hours_only === preset.hours_only && (Number(access.idle_minutes) || 0) === preset.idle_minutes;
  });
}
