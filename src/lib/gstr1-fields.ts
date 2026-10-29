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
  exemp: {name:"Nil rated, exempt and non-GST supplies", headings:["Description", "Nil Rated Supplies", "Exempted(other than nil rated/non GST supply)", "Non-GST Supplies"]},
  docs: {name:"Documents issued", headings:["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"]},
  hsn_b2b: {name:"HSN for B2B", headings:["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"]},
  hsn_b2c: {name:"HSN for B2C", headings:["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"]},
  hsn: {name:"HSN before May 2025", headings:["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"]},
  b2ba: {name:"Amended B2B", headings:["GSTIN/UIN of Recipient", "Receiver Name", "Original Invoice Number", "Original Invoice date", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"]},
  b2cla: {name:"Amended large B2C sales", headings:["Original Invoice Number", "Original Invoice date", "Original Place Of Supply", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"]},
  b2csa: {name:"Amended B2CS", headings:["Financial Year", "Original Month", "Place Of Supply", "Type", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"]},
  cdnra: {name:"Amended credit and debit notes", headings:["GSTIN/UIN of Recipient", "Receiver Name", "Original Note Number", "Original Note Date", "Revised Note Number", "Revised Note Date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"]},
  cdnura: {name:"Amended notes to unregistered buyers", headings:["UR Type", "Original Note Number", "Original Note Date", "Revised Note Number", "Revised Note Date", "Note Type", "Place Of Supply", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"]},
  expa: {name:"Amended exports", headings:["Export Type", "Original Invoice Number", "Original Invoice date", "Revised Invoice Number", "Revised Invoice date", "Invoice Value", "Port Code", "Shipping Bill Number", "Shipping Bill Date", "Rate", "Taxable Value", "Cess Amount"]},
  ata: {name:"Amended advances received", headings:["Financial Year", "Original Month", "Original Place Of Supply", "Applicable % of Tax Rate", "Rate", "Gross Advance Received", "Cess Amount"]},
  atadja: {name:"Amended advances adjusted", headings:["Financial Year", "Original Month", "Original Place Of Supply", "Applicable % of Tax Rate", "Rate", "Gross Advance Adjusted", "Cess Amount"]},
  eco: {name:"Sales through e-commerce operators (14)", headings:["Nature of Supply", "GSTIN of E-Commerce Operator", "E-Commerce Operator Name", "Net value of supplies", "Integrated tax", "Central tax", "State/UT tax", "Cess"]},
  ecoa: {name:"Amended sales through e-commerce operators (14A)", headings:["Nature of Supply", "Financial Year", "Original Month/Quarter", "Original GSTIN of E-Commerce Operator", "Revised GSTIN of E-Commerce Operator", "E-Commerce Operator Name", "Revised Net value of supplies", "Integrated tax", "Central tax", "State/UT tax", "Cess"]},
  ecob2b: {name:"Section 9(5) supplies B2B (15)", headings:["Supplier GSTIN/UIN", "Supplier Name", "Recipient GSTIN/UIN", "Recipient Name", "Document Number", "Document Date", "Value of supplies made", "Place Of Supply", "Document type", "Rate", "Taxable Value", "Cess Amount"]},
  ecourp2b: {name:"Section 9(5) supplies URP2B (15)", headings:["Recipient GSTIN/UIN", "Recipient Name", "Document Number", "Document Date", "Value of supplies made", "Place Of Supply", "Document type", "Rate", "Taxable Value", "Cess Amount"]},
  ecob2c: {name:"Section 9(5) supplies B2C (15)", headings:["Supplier GSTIN/UIN", "Supplier Name", "Place Of Supply", "Taxable Value", "Rate", "Cess Amount"]},
  ecourp2c: {name:"Section 9(5) supplies URP2C (15)", headings:["Place Of Supply", "Taxable Value", "Rate", "Cess Amount"]},
  ecoab2b: {name:"Amended section 9(5) supplies B2B (15A)", headings:["Supplier GSTIN/UIN", "Supplier Name", "Recipient GSTIN/UIN", "Recipient Name", "Original Document Number", "Original Document Date", "Revised Document Number", "Revised Document Date", "Value of supplies made", "Place Of Supply", "Document type", "Rate", "Taxable Value", "Cess Amount"]},
  ecoab2c: {name:"Amended section 9(5) supplies B2C (15A)", headings:["Financial Year", "Original Month", "Supplier GSTIN/UIN", "Supplier Name", "Place Of Supply", "Rate", "Taxable Value", "Cess Amount"]},
  ecoaurp2b: {name:"Amended section 9(5) supplies URP2B (15A)", headings:["Recipient GSTIN/UIN", "Recipient Name", "Original Document Number", "Original Document Date", "Revised Document Number", "Revised Document Date", "Value of supplies made", "Document type", "Place Of Supply", "Rate", "Taxable Value", "Cess Amount"]},
  ecoaurp2c: {name:"Amended section 9(5) supplies URP2C (15A)", headings:["Financial Year", "Original Month", "Place Of Supply", "Rate", "Taxable Value", "Cess Amount"]},
} as const;
export type SalesSection = keyof typeof salesSections;
// A register may name each e-invoice's IRN in the tables the e-invoice system fills on the portal
// (B2B, notes and exports). The workbook has no IRN column, so it comes after the official ones.
export const irnColumn=(section:string)=>["b2b","cdnr","cdnur","exp"].includes(section) ? salesSections[section as SalesSection].headings.length : -1;
export const registerColumns=(section:SalesSection):readonly string[]=>irnColumn(section)<0 ? salesSections[section].headings : [...salesSections[section].headings,"IRN"];
// Each amendment sheet and the sheet it amends, by the workbook's sheet names.
export const amends:Partial<Record<SalesSection,SalesSection>> = {b2ba:"b2b",b2cla:"b2cl",b2csa:"b2cs",cdnra:"cdnr",cdnura:"cdnur",expa:"exp",ata:"at",atadja:"atadj",ecoa:"eco",ecoab2b:"ecob2b",ecoab2c:"ecob2c",ecoaurp2b:"ecourp2b",ecoaurp2c:"ecourp2c"};

// Headings whose cells hold amounts or counts; every other column is text or a date.
export const numericHeadings = /^(Invoice Value|Note Value|Rate|Taxable Value|Cess Amount|Total Value|Total Quantity|Integrated Tax Amount|Central Tax Amount|State\/UT Tax Amount|Applicable % of Tax Rate|Gross Advance Received|Gross Advance Adjusted|Total Number|Cancelled|Nil Rated Supplies|Exempted\(other than nil rated\/non GST supply\)|Non-GST Supplies|(Revised )?Net value of supplies|Integrated tax|Central tax|State\/UT tax|Cess|Value of supplies made)$/;

// The exemp rows, from the offline tool's official exemp.csv (reference/official/returns-offline),
// with the schema's supply type for each.
export const exemptRows: Record<string,string> = {
  "Inter-State supplies to registered persons":"INTRB2B",
  "Intra-State supplies to registered persons":"INTRAB2B",
  "Inter-State supplies to unregistered persons":"INTRB2C",
  "Intra-State supplies to unregistered persons":"INTRAB2C",
};
