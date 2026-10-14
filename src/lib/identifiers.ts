// Indian tax registration numbers, checked before they are stored.
const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const cleanNumber = (value: string) => value.replace(/\s/g, "").toUpperCase();

export const isPan = (pan: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);

// A GSTIN is the state code, the PAN, an entity number, Z and a check character that
// catches most typing mistakes.
export function isGstin(gstin: string) {
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  let sum = 0;
  for (let at = 0; at < 14; at++) {
    const value = BASE36.indexOf(gstin[at]) * (at % 2 ? 2 : 1);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return BASE36[(36 - (sum % 36)) % 36] === gstin[14];
}

export const panOfGstin = (gstin: string) => gstin.slice(2, 12);

// Every number a client can have, with its check.
export const numberKinds = {
  pan: { name: "PAN", valid: isPan },
  gstin: { name: "GSTIN", valid: isGstin },
  tan: { name: "TAN", valid: (tan: string) => /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(tan) },
  cin: { name: "CIN", valid: (cin: string) => /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(cin) },
  llpin: { name: "LLPIN", valid: (llpin: string) => /^[A-Z]{3}-[0-9]{4}$/.test(llpin) },
} as const;
export type NumberKind = keyof typeof numberKinds;
