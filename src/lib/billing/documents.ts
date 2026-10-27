import { rupees, type DocKind } from "./money";

// The document each captured payment and each refund makes (PLAN.md 5.14.1 Invoices), kept as
// issued. Before Orelu's GST start date a payment makes a payment receipt with no GST and a
// refund a refund receipt; from it, a payment makes a tax invoice with the particulars of CGST
// rule 46 and a refund of it a credit note with those of rule 53(1A) (rule texts read on
// taxinformation.cbic.gov.in, CBIC's own site, on 27 Oct 2026).
export type Party = { name: string; address: string; gstin?: string; pan?: string; stateCode?: string; state?: string };
export type Doc = {
  kind: DocKind;
  no: string;
  date: string;
  seller: Party;
  buyer: Party;
  lines: { text: string; paise: number }[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  rate?: number;
  sac?: string;
  total: number;
  paidBy?: string;
  // A credit note or refund receipt: the document it corrects, and why.
  of?: { no: string; date: string };
  reason?: string;
  signatory?: string;
};

export const docTitles: Record<DocKind, string> = { receipt: "Payment receipt", invoice: "Tax invoice", credit: "Credit note", refund: "Refund receipt" };
export const reasonWords: Record<string, string> = { money_back: "Money back within 14 days of the first payment", duplicate: "A payment taken twice", charge_error: "A payment taken in error" };

// GST of a document: CGST and SGST halves for a firm in Orelu's state, IGST otherwise (the place
// of supply is the firm's state).
export function taxLines(gstPaise: number, sameState: boolean) {
  if (!gstPaise) return { cgst: 0, sgst: 0, igst: 0 };
  if (!sameState) return { cgst: 0, sgst: 0, igst: gstPaise };
  const cgst = Math.round(gstPaise / 2);
  return { cgst, sgst: gstPaise - cgst, igst: 0 };
}

const escape = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
const party = (who: Party) => [who.name, who.address, ...(who.stateCode ? [`State: ${who.state} (code ${who.stateCode})`] : []), ...(who.gstin ? [`GSTIN: ${who.gstin}`] : []), ...(who.pan ? [`PAN: ${who.pan}`] : [])];

// The document's lines in reading order, for the printable page and the email alike.
export function docRows(doc: Doc) {
  const gst = doc.kind === "invoice" || doc.kind === "credit";
  const rows: [string, string][] = [];
  if (gst && doc.sac) rows.push(["SAC (HSN for services)", doc.sac]);
  for (const line of doc.lines) rows.push([line.text, rupees(line.paise)]);
  if (gst) {
    rows.push([doc.kind === "credit" ? "Taxable value credited" : "Taxable value", rupees(doc.taxable)]);
    if (doc.igst) rows.push([`IGST at ${doc.rate}%`, rupees(doc.igst)]);
    if (doc.cgst) rows.push([`CGST at ${(doc.rate ?? 0) / 2}%`, rupees(doc.cgst)]);
    if (doc.sgst) rows.push([`SGST at ${(doc.rate ?? 0) / 2}%`, rupees(doc.sgst)]);
  }
  rows.push([doc.kind === "credit" || doc.kind === "refund" ? "Total given back" : "Total paid", rupees(doc.total)]);
  return rows;
}

export function docNotes(doc: Doc) {
  const notes: string[] = [];
  if (doc.of) notes.push(`For ${doc.of.no} of ${day(doc.of.date)}.`);
  if (doc.reason) notes.push(`Reason: ${reasonWords[doc.reason] ?? doc.reason}.`);
  if (doc.paidBy) notes.push(`Paid by ${doc.paidBy}.`);
  if (doc.kind === "invoice" || doc.kind === "credit") notes.push(`Place of supply: ${doc.buyer.state} (code ${doc.buyer.stateCode}). Tax payable on reverse charge: No.`);
  else notes.push(doc.seller.gstin ? "No GST was charged on this payment." : "Orelu is not registered under GST, so no GST is charged.");
  // Rule 46 needs no signature on an electronic invoice (its proviso under the IT Act, 2000);
  // rule 53(1A)(i) has no such proviso, so a credit note names the authorised signatory.
  if (doc.kind === "invoice") notes.push("An electronic invoice: no signature is needed.");
  if (doc.kind === "credit" && doc.signatory) notes.push(`For ${doc.seller.name}, authorised signatory: ${doc.signatory}.`);
  return notes;
}

// The email to the owner: the whole document in plain text, and the printable page's address.
export function docText(doc: Doc, link: string) {
  return [
    `${docTitles[doc.kind]} ${doc.no}, ${day(doc.date)}`,
    `From: ${party(doc.seller).join(", ")}`,
    `To: ${party(doc.buyer).join(", ")}`,
    docRows(doc).map(([what, amount]) => `${what}: ${amount}`).join("\n"),
    docNotes(doc).join("\n"),
    `See it or print it in InboxCA: ${link}`,
  ].join("\n\n");
}

// The printable page: plain HTML that prints on one A4 page, with no script.
export function docHtml(doc: Doc) {
  const block = (title: string, lines: string[]) => `<div><h2>${title}</h2>${lines.map((line) => `<p>${escape(line)}</p>`).join("")}</div>`;
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(`${docTitles[doc.kind]} ${doc.no}`)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:black}h1{font-size:1.4rem;margin:0}h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;margin:0 0 .25rem;color:dimgray}p{margin:0}.head{display:flex;justify-content:space-between;gap:1rem;border-bottom:2px solid black;padding-bottom:.75rem}.parties{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin:1.25rem 0}table{width:100%;border-collapse:collapse}td{padding:.4rem 0;border-bottom:1px solid gainsboro}td:last-child{text-align:right;font-variant-numeric:tabular-nums}tr:last-child td{font-weight:700;border-bottom:2px solid black}.notes{margin-top:1rem}.notes p{margin:.2rem 0}@media print{body{margin:0}.print{display:none}}</style></head>
<body><div class="head"><div><h1>${docTitles[doc.kind]}</h1><p>InboxCA by ${escape(doc.seller.name)}</p></div><div><p><strong>${escape(doc.no)}</strong></p><p>${escape(day(doc.date))}</p></div></div>
<div class="parties">${block("From", party(doc.seller))}${block("To", party(doc.buyer))}</div>
<table>${docRows(doc).map(([what, amount]) => `<tr><td>${escape(what)}</td><td>${escape(amount)}</td></tr>`).join("")}</table>
<div class="notes">${docNotes(doc).map((note) => `<p>${escape(note)}</p>`).join("")}</div>
<p class="print"><br>Use your browser's Print to keep a copy or save it as a PDF.</p></body></html>`;
}
