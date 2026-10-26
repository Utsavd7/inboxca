import {isGstin} from "../src/lib/identifiers.ts";
import {jsonSource} from "./json-source.ts";
import {officialSchema} from "./schema.ts";
import {itrFields} from "../src/lib/itr-fields.ts";
import {PART_ONE,TAN,one,pdfLines,plain,recogniseTaxPdf,recogniseTaxText,region,title,valuesFor,type Line} from "../src/lib/tax-papers.ts";

export type PortalRead={kind:"GSTR-2B"|"GSTR-2A";version:string;gstin:string;period:string;lines:{field:string;label:string;value:string;path:string;page:number}[];checks:{parts:string[];total:string}[]};
// Other official layouts join this interface only with their unchanged source and tests.
export type PortalParser={version:string;read:(value:unknown)=>PortalRead|null};
const object=(value:unknown):Record<string,unknown>=>value!==null && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
const schemas=new Map<string,Record<string,unknown>>();
const hashes:Record<string,string>={"v4.5":"3351e86b8309ebe0cd45abcc217951cbb57401c24336a7bbaaaef5d687202e95","v4.4":"80ef571df18bee03c302af7e1957ecb1d0ae35d21dc14ac96a745f044f42b000"};
function valid(value:unknown,version:string) {
  const {schema,validate}=officialSchema(`gstn/gstr2b-${version}-response-schema.json`,hashes[version]);schemas.set(version,schema);
  return validate(value);
}

export const portalParsers:PortalParser[]=["v4.5","v4.4"].map((version)=>({version,read(value) {
  if(!valid(value,version)) return null;
  const data=object(object(value).data),gstin=String(data.gstin ?? "").toUpperCase(),period=String(data.rtnprd ?? ""),summary=object(data.itcsumm);
  if(!isGstin(gstin) || !/^(0[1-9]|1[0-2])20\d{2}$/.test(period) || !Object.keys(summary).length) return null;
  const source=jsonSource(value),lines:PortalRead["lines"]=[],checks:PortalRead["checks"]=[];
  const shape=object(object(object(object(schemas.get(version)).properties).data).properties);
  const words:Record<string,string>={itcavl:"available credit",itcunavl:"unavailable credit",itcrev:"credit reversed",itcRejected:"rejected credit",nonrevsup:"ordinary purchases",revsup:"reverse charge purchases",isdsup:"ISD supplies",imports:"imports",othersup:"other supplies",impg:"imported goods",impgsez:"goods from an SEZ",impga:"changed imported goods",impgasez:"changed goods from an SEZ",isd:"credit from an ISD",b2b:"invoices",b2ba:"changed invoices",cdnr:"notes",cdnra:"changed notes",cdnrrev:"notes reversed",cdnrarev:"changed notes reversed",isda:"changed ISD credit",ecom:"commerce operator supplies",ecoma:"changed commerce operator supplies"};
  const visit=(node:Record<string,unknown>,path:string,rule:Record<string,unknown>)=>{
    for(const [key,item] of Object.entries(node)) {
      const next=`${path}/${key}`;
      const fields=object(rule.properties);
      if(!Object.hasOwn(fields,key)) throw new Error("Statement layout not supported");
      if(typeof item==="number") {
        const row=source.positions.get(next),page=Math.ceil((row ?? Infinity)/40);
        if(!row || page>30 || !/^-?\d{1,13}(\.\d{1,2})?$/.test(String(item))) throw new Error("Statement outside reading limits");
        const field=`gstr2b${next.replaceAll("/",".")}`.toLowerCase();
        if(!/^[a-z][a-z0-9_.]{0,99}$/.test(field)) throw new Error("Statement layout not supported");
        lines.push({field,label:`${key.toUpperCase()}, ${path.split("/").slice(3).map((part)=>words[part] ?? "statement total").join(", ")}`.slice(0,120),value:String(item),path:next,page});
        // The schema gives figures, not the arithmetic of credit eligibility.
      } else if(item!==null && typeof item==="object" && !Array.isArray(item)) visit(object(item),next,object(fields[key]));
      else throw new Error("Statement layout not supported");
    }
  };
  visit(summary,"/data/itcsumm",object(shape.itcsumm));
  if(!lines.length || lines.length>10000) return null;
  return {kind:"GSTR-2B",version,gstin,period:`${period.slice(2)}-${period.slice(0,2)}`,lines,checks};
}}));
// GSTR-2A by GSTN's pinned v2.3 response schema, which lays out its B2B invoices only; other
// sections stay unread. The GSTIN and month are the download's own gstin and fp, as the drop
// box finds them. GSTR-2A is for information: GSTR-3B credit comes from GSTR-2B alone.
const words2a:Record<string,string>={val:"Invoice value",txval:"Taxable value",rt:"Rate",iamt:"Integrated tax",camt:"Central tax",samt:"State tax",csamt:"Cess",diff_percent:"Differential percentage"};
portalParsers.push({version:"v2.3",read(value) {
  const {schema,validate}=officialSchema("gstn/gstr2a-v2.3-response-schema.json","2b2e698870db2cd4a9826f09ad9ddec07abb507d268141252352e80f8c6972f0");
  if(!validate(value)) return null;
  const top=object(value),gstin=String(top.gstin ?? "").toUpperCase(),period=String(top.fp ?? "");
  if(!isGstin(gstin) || !/^(0[1-9]|1[0-2])20\d{2}$/.test(period)) return null;
  const source=jsonSource(value),lines:PortalRead["lines"]=[];
  const visit=(item:unknown,path:string,rule:Record<string,unknown>,about:string)=>{
    if(Array.isArray(item)) {item.forEach((entry,index)=>visit(entry,`${path}/${index}`,object(rule.items),about));return;}
    const node=object(item),fields=object(rule.properties);
    const here=[about,node.ctin && `from ${node.ctin}`,node.inum && `invoice ${node.inum}`,node.num && `item ${node.num}`].filter(Boolean).join(", ");
    for(const [key,entry] of Object.entries(node)) {
      const next=`${path}/${key}`;
      if(!Object.hasOwn(fields,key)) throw new Error("Statement layout not supported");
      if(entry!==null && typeof entry==="object") visit(entry,next,object(fields[key]),here);
      else if(typeof entry==="number" && Object.hasOwn(words2a,key)) {
        const row=source.positions.get(next),page=Math.ceil((row ?? Infinity)/40),field=`gstr2a${next.replaceAll("/",".")}`.toLowerCase();
        if(!row || page>30 || !/^-?\d{1,13}(\.\d{1,2})?$/.test(String(entry))) throw new Error("Statement outside reading limits");
        if(!/^[a-z][a-z0-9_.]{0,99}$/.test(field)) throw new Error("Statement layout not supported");
        lines.push({field,label:`${words2a[key]}, ${here}`.slice(0,120),value:String(entry),path:next,page});
      }
    }
  };
  visit(top.b2b,"/b2b",object(object(schema.properties).b2b),"");
  if(!lines.length || lines.length>10000) return null;
  return {kind:"GSTR-2A",version:"v2.3",gstin,period:`${period.slice(2)}-${period.slice(0,2)}`,lines,checks:[]};
}});

export function readPortal(bytes:Uint8Array) {
  let value:unknown;
  try {value=JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/,""));} catch {return null;}
  for(const parser of portalParsers) {try {const read=parser.read(value);if(read) return read;} catch {continue;}}
  return null;
}

// Income tax papers (src/lib/tax-papers.ts). The Form 26AS text file's Part I rows are the
// paper's own figures, kept to check the return against; Form 16 and Form No. 130 give the
// salary figures the return already has fields for. Exemptions and the standard deduction
// have no return field yet, so they stay unread.
export type TaxRead={kind:"Form 26AS"|"Form 16"|"Form 130";version:"text"|"traces"|"rules-2026";pan:string;period:string;lines:{field:string;label:string;value:string;kind:"number"|"text"|"date";page:number;path?:string}[]};
const AMOUNT=/^-?\d{1,13}(\.\d{1,2})?$/,MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export function readTaxText(bytes:Uint8Array):TaxRead|null {
  const paper=recogniseTaxText(bytes);if(!paper) return null;
  const rows=new TextDecoder().decode(bytes).replace(/^﻿/,"").split(/\r?\n/),lines:TaxRead["lines"]=[];
  // Only rows the viewer shows beside a figure are read: its first 100,000 bytes, 40 lines a page, 30 pages.
  const shown=new TextDecoder().decode(bytes.subarray(0,100_000)).replace(/^﻿/,"").split(/\r?\n/);
  // Columns by their header names: the number of empty fields between them differs by part.
  let deductors:string[]=[],entries:string[]=[],tan="",count=-1,entry=0;
  const cell=(heads:string[],values:string[],name:RegExp)=>{const at=heads.findIndex((head)=>name.test(head));return at<0 ? "" : values[at] ?? "";};
  const add=(at:number,field:string,label:string,value:string,kind:"number"|"text"|"date",valid:RegExp)=>{
    const page=Math.ceil((at+1)/40);
    if(page>30 || shown[at]!==rows[at] || !valid.test(value)) throw new Error("Statement outside reading limits");
    lines.push({field,label:label.slice(0,120),value,kind,page,path:`/line/${at+1}`});
  };
  try {
    for(let at=rows.findIndex((row)=>PART_ONE.test(title(row)))+1;at<rows.length;at++) {
      const name=title(rows[at]),values=rows[at].split("^").map(plain);
      if(/^PART[- ]?[IVXA]+\b/i.test(name)) break;
      if(!name || /No Transactions Present/i.test(name)) continue;
      if(values.includes("Name of Deductor")) {deductors=values;continue;}
      if(values.includes("Transaction Date")) {entries=values;continue;}
      if(/^\d+$/.test(values[0]) && deductors.length) {
        tan=cell(deductors,values,/^TAN of Deductor$/);count++;entry=0;
        add(at,`f26as.tds.${count}.tan`,`Deductor ${count+1}: TAN`,tan,"text",TAN);
        add(at,`f26as.tds.${count}.name`,`${tan}: name of deductor`,cell(deductors,values,/^Name of Deductor$/),"text",/^.{1,200}$/);
        for(const [key,words,head] of [["paid","total amount paid or credited",/^Total Amount Paid\/Credited/],["deducted","total tax deducted",/^Total Tax Deducted/],["deposited","total TDS deposited",/^Total TDS Deposited/]] as const)
          add(at,`f26as.tds.${count}.${key}`,`${tan}: ${words}`,cell(deductors,values,head),"number",AMOUNT);
      } else if(!values[0] && /^\d+$/.test(values[1] ?? "") && entries.length && count>=0) {
        const date=/^(\d{2})-([A-Z][a-z]{2})-(20\d{2})$/.exec(cell(entries,values,/^Transaction Date$/)),iso=date ? `${date[3]}-${String(MONTHS.indexOf(date[2])+1).padStart(2,"0")}-${date[1]}` : "";
        if(!date || !MONTHS.includes(date[2]) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0,10)!==iso) throw new Error("Statement layout not supported");
        const row=`f26as.tds.${count}.rows.${entry}`,about=`${tan}, row ${++entry}`;
        add(at,`${row}.section`,`${about}: section`,cell(entries,values,/^Section/),"text",/^[0-9A-Za-z()]{1,12}$/);
        add(at,`${row}.date`,`${about}: transaction date`,iso,"date",/^20\d{2}-\d{2}-\d{2}$/);
        add(at,`${row}.status`,`${about}: status of booking`,cell(entries,values,/^Status of Booking/),"text",/^[A-Z]$/);
        for(const [key,words,head] of [["paid","amount paid or credited",/^Amount Paid\/Credited/],["deducted","tax deducted",/^Tax Deducted/],["deposited","TDS deposited",/^TDS Deposited/]] as const)
          add(at,`${row}.${key}`,`${about}: ${words}`,cell(entries,values,head),"number",AMOUNT);
      } else throw new Error("Statement layout not supported");
    }
  } catch {return null;}
  return lines.length && lines.length<=10000 ? {kind:"Form 26AS",version:"text",pan:paper.pan,period:paper.period,lines} : null;
}

// Gross salary is row 1(d) under Gross Salary, income chargeable under Salaries is its own
// row, and the tax deducted is the summary's Total row: the second of its three amounts, in
// the official column order. Each other figure must be the only amount on its row.
export async function readTaxPdf(bytes:Uint8Array,password?:string):Promise<TaxRead|null> {
  let lines:Line[];
  try {lines=await pdfLines(bytes,30,password);} catch {return null;}
  const paper=recogniseTaxPdf(lines);
  if(paper?.type!=="Form 16" && paper?.type!=="Form 130") return null;
  const sixteen=paper.type==="Form 16",out:TaxRead["lines"]=[];
  const amounts=(line?:Line)=>(line?.text.split(" ") ?? []).filter((word)=>/^-?(\d{1,3}(,\d{2,3})+|\d{1,13})\.\d{2}$/.test(word)).map((word)=>word.replace(/,/g,""));
  const only=(line?:Line)=>amounts(line).length===1 ? amounts(line)[0] : "";
  const put=(field:string,value:string,page?:number,kind:"number"|"text"="number")=>{if(value && page) out.push({field,label:itrFields[field.replace(/\.0\./,".*.") as keyof typeof itrFields].label,value,kind,page});};
  const salary=sixteen ? region(lines,/Details of Salary Paid and any other income and tax deducted/i) : region(lines,/PART C \(Annexure ?- ?I\)/i,/PART C \(Annexure ?- ?II\)/i);
  const head=salary.findIndex((line)=>/Gross Salary/i.test(line.text)),stop=salary.findIndex((line,at)=>at>head && /Allowances to the/i.test(line.text));
  const gross=head<0 ? undefined : salary.slice(head+1,stop<0 ? undefined : stop).find((line)=>/^\(d\) ?Total\b/i.test(line.text));
  const income=salary.find((line)=>/Income chargeable under the head\W+Salaries/i.test(line.text));
  const total=region(lines,/Summary of amount paid\/credited and tax deducted at source thereon/i,/^I\. Details of tax deducted and deposited/i).find((line)=>/^Total\b/i.test(line.text) && amounts(line).length===3);
  const tan=one(sixteen ? valuesFor(lines,/TAN of the Deductor/,TAN) : valuesFor(region(lines,/Details of the employer\/specified bank/i,/Details of the employee/i),/Tax Deduction and Collection Account Number/,TAN));
  if(paper.salary) {put("itr.salary.gross",only(gross),gross?.page);put("itr.salary.income",only(income),income?.page);}
  // A Form 16 Part B alone has no tax summary, so it leaves the TDS row to its Part A.
  if(paper.tax && tan) {
    put("itr.tds.salary.0.tan",tan.value,tan.page,"text");
    if(paper.salary) put("itr.tds.salary.0.income",only(income),income?.page);
    put("itr.tds.salary.0.deducted",amounts(total)[1] ?? "",total?.page);
  }
  return out.length ? {kind:paper.type,version:sixteen ? "traces" : "rules-2026",pan:paper.pan,period:paper.period,lines:out} : null;
}
