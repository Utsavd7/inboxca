// Files from the government portals, recognised by their own contents, never by their
// names (PLAN.md 5.3.1, D39): the client and the period are read from inside the file, so
// staff choose nothing. Only the GST portal's JSON downloads of GSTR-2B and GSTR-2A are
// listed so far, in the layout the portal publishes; each is to be checked against real
// files in the pilot. Form 26AS, AIS, TIS and acknowledgements follow once real samples
// are in hand. Anything else is not a portal file.
export type PortalFile = { type: "GSTR-2B" | "GSTR-2A"; gstin: string; period: string };

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const SECTIONS_2A = ["b2b", "b2ba", "cdn", "cdna", "isd", "isda", "impg", "impgsez", "tds", "tcs"];

// "092026" (month and year, as the portal writes a return period) → "2026-09".
const period = (value: unknown) => (typeof value === "string" && /^(0[1-9]|1[0-2])20\d\d$/.test(value) ? `${value.slice(2)}-${value.slice(0, 2)}` : "");

export function recognisePortalFile(bytes: Uint8Array): PortalFile | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const top = json as Record<string, unknown>;
  const data = (top.data ?? {}) as Record<string, unknown>;
  // GSTR-2B: { data: { gstin, rtnprd, docdata: { ... } } }
  if (typeof data.gstin === "string" && GSTIN.test(data.gstin) && period(data.rtnprd) && (data.docdata && typeof data.docdata === "object" || data.itcsumm && typeof data.itcsumm === "object"))
    return { type: "GSTR-2B", gstin: data.gstin, period: period(data.rtnprd) };
  // GSTR-2A: { gstin, fp, b2b: [...], cdn: [...], ... }
  if (typeof top.gstin === "string" && GSTIN.test(top.gstin) && period(top.fp) && SECTIONS_2A.some((section) => Array.isArray(top[section])))
    return { type: "GSTR-2A", gstin: top.gstin, period: period(top.fp) };
  return null;
}
