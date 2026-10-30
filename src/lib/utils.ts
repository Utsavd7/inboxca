// Two letters for a name or an address: "Patel Textiles" is PT, "ravi@x.in" is RA. Kept here,
// not in the app's ui.tsx, so the not found page and client links do not load the app's menus.
export const initials = (text: string) => {
  const words = text.split("@")[0].split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
};
