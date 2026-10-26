import {z} from "zod";
import {numericHeadings,salesSections,type SalesSection} from "./gstr1-fields.ts";
import type {Figure} from "./datasets";

export const mappingSchema=z.object({section:z.enum(Object.keys(salesSections) as [SalesSection,...SalesSection[]]),header:z.number().int().min(0).max(39),headings:z.array(z.string().max(200)).min(1).max(26),columns:z.array(z.number().int().min(-1).max(25)).max(26)});
export type SalesMapping=z.infer<typeof mappingSchema>;
const normal=(text:string)=>text.trim().toLowerCase().replace(/\s+/g," ");
export function sameHeadings(a:string[],b:string[]) {return a.length===b.length && a.every((v,i)=>normal(v)===normal(b[i]));}
export function exactMapping(rows:string[][]):SalesMapping|undefined {
  for(let header=0;header<Math.min(40,rows.length);header++) {
    // A B2B row also holds every B2CL heading: the table matching the most headings is meant.
    const all=Object.entries(salesSections).filter(([,{headings}])=>headings.every((name)=>rows[header].filter((value)=>normal(value)===normal(name)).length===1));
    const most=Math.max(0,...all.map(([,{headings}])=>headings.length)),matches=all.filter(([,{headings}])=>headings.length===most);
    if(matches.length>1) return;
    if(matches.length===1) {const [section,{headings}]=matches[0];return {section:section as SalesSection,header,headings:rows[header],columns:headings.map((name)=>rows[header].findIndex((value)=>normal(value)===normal(name)))};}
  }
}
export function date(value:string) {
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if(/^\d{5}(\.0+)?$/.test(value)) return new Date((Number(value)-25569)*86400_000).toISOString().slice(0,10);
  const parts=/^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})$/.exec(value);
  if(!parts) throw new Error("Dates need a four digit year.");
  const month=/^\d+$/.test(parts[2]) ? Number(parts[2]) : ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(parts[2].toLowerCase())+1;
  const result=`${parts[3]}-${String(month).padStart(2,"0")}-${parts[1].padStart(2,"0")}`;
  if(new Date(result).toISOString().slice(0,10)!==result) throw new Error("Check the date.");
  return result;
}
// Section names and headings are official. These are internal draft keys, not portal JSON.
export function extractSales(rows:string[][],asked:SalesMapping) {
  const mapping=mappingSchema.parse(asked),headings=salesSections[mapping.section].headings;
  if(!sameHeadings(rows[mapping.header] ?? [],mapping.headings) || mapping.columns.length!==headings.length) throw new Error("The columns changed. Check them again.");
  const columns=mapping.columns.filter((column)=>column>=0);
  if(!columns.length || new Set(columns).size!==columns.length || columns.some((column)=>column>=mapping.headings.length)) throw new Error("Choose a different column for each field.");
  const lines:(Figure & {field:string;row:number;column:number;total:boolean})[]=[];
  for(let row=mapping.header+1;row<rows.length;row++) {
    if(!rows[row].some((cell)=>cell.trim())) continue;
    const total=rows[row].some((cell)=>/^(grand\s+)?total$/i.test(cell.trim()));
    for(let index=0;index<headings.length;index++) {
      const column=mapping.columns[index],raw=rows[row][column]?.trim();
      if(column<0 || !raw || total && /^(grand\s+)?total$/i.test(raw)) continue;
      const label=headings[index],numeric=numericHeadings.test(label);
      if(total && !numeric) continue;
      if(numeric && !/^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(\.\d{1,2})?$/.test(raw)) throw new Error(`Check ${label} in row ${row+1}.`);
      const kind:Figure["kind"]=/date$/i.test(label) ? "date" : numeric ? "number" : "text";
      lines.push({field:`${mapping.section}.${total ? "t" : "r"}${row+1}.c${index}`,label:`${label}, row ${row+1}`,value:kind==="date" ? date(raw) : numeric ? raw.replaceAll(",","") : raw,kind,row:row+1,column,total});
    }
  }
  if(!lines.length || lines.length>10000) throw new Error("Use a register with 1 to 10,000 filled fields.");
  return lines;
}
