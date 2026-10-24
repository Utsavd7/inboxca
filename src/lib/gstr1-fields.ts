// Headings from row 4 of the unchanged GST portal workbook in reference/official/gstr1-v2.2.
export const salesSections = {
  b2b: {name:"B2B", headings:["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"]},
  b2cs: {name:"B2CS", headings:["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"]},
  cdnr: {name:"Credit and debit notes", headings:["GSTIN/UIN of Recipient", "Receiver Name", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"]},
  b2cl: {name:"Large B2C sales (B2CL)", headings:["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"]},
  cdnur: {name:"Credit and debit notes to unregistered buyers", headings:["UR Type", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"]},
  exp: {name:"Exports", headings:["Export Type", "Invoice Number", "Invoice date", "Invoice Value", "Port Code", "Shipping Bill Number", "Shipping Bill Date", "Rate", "Taxable Value", "Cess Amount"]},
  at: {name:"Advances received", headings:["Place Of Supply", "Applicable % of Tax Rate", "Rate", "Gross Advance Received", "Cess Amount"]},
  atadj: {name:"Advances adjusted", headings:["Place Of Supply", "Applicable % of Tax Rate", "Rate", "Gross Advance Adjusted", "Cess Amount"]},
  docs: {name:"Documents issued", headings:["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"]},
  hsn_b2b: {name:"HSN for B2B", headings:["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"]},
  hsn_b2c: {name:"HSN for B2C", headings:["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"]},
  hsn: {name:"HSN before May 2025", headings:["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"]},
} as const;
export type SalesSection = keyof typeof salesSections;

// Headings whose cells hold amounts or counts; every other column is text or a date.
export const numericHeadings = /^(Invoice Value|Note Value|Rate|Taxable Value|Cess Amount|Total Value|Total Quantity|Integrated Tax Amount|Central Tax Amount|State\/UT Tax Amount|Applicable % of Tax Rate|Gross Advance Received|Gross Advance Adjusted|Total Number|Cancelled)$/;
