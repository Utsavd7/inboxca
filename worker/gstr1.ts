import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {numericHeadings,salesSections,type SalesSection} from "../src/lib/gstr1-fields.ts";
import {xlsxEntries} from "../src/lib/sheet.ts";
import type {Figure} from "../src/lib/datasets.ts";
import {chooseTemplate,type Template} from "../src/lib/templates.ts";
import {writeWorkbook} from "./workbook.ts";
import {officialSchema} from "./schema.ts";
import {isGstin} from "../src/lib/identifiers.ts";

const unescape=(value:string)=>value.replaceAll("&amp;","&").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&quot;",'"').replaceAll("&apos;","'");
// Only named lists from the official file, never a hand-written rate or state list.
export function gstr1Workbook(template:Template,period:string,gstin:string,drafts:Map<string,Figure>[]) {
  chooseTemplate([template],"GSTR1",period);
  if(!isGstin(gstin) || !template.mappings.validator) throw new Error("Check the client's GST number and official form");
  if(!/^gstr1-v[\d.]+\/GSTR1_Excel_Workbook_Template_V[\d.]+\.xlsx$/.test(template.source.file)) throw new Error("Unknown official workbook");
  const original=readFileSync(new URL(`../reference/official/${template.source.file}`,import.meta.url));
  if(createHash("sha256").update(original).digest("hex")!==template.source.sha256) throw new Error("The official workbook changed");
  const files=xlsxEntries(original),workbook=files.get("xl/workbook.xml")!().toString();
  const strings=[...files.get("xl/sharedStrings.xml")!().toString().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([,body])=>[...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([,text])=>unescape(text)).join(""));
  const sheetCells=(sheet:number)=>new Map([...files.get(`xl/worksheets/sheet${sheet}.xml`)!().toString().matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([,attrs,body=""])=>{const value=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";return [/r="([A-Z]+\d+)"/.exec(attrs)![1],attrs.includes('t="s"') ? strings[Number(value)] : unescape(value)];}));
  const masterSheet=[...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*>/g)].findIndex(([,name])=>name==="master")+1,master=sheetCells(masterSheet),lists=new Map<string,string[]>();
  for(const [,name,ref] of workbook.matchAll(/<definedName\b[^>]*name="([^"]+)"[^>]*>([^<]+)<\/definedName>/g)) {
    const range=/^master!\$([A-Z]+)\$(\d+):\$\1\$(\d+)$/.exec(ref);
    if(range) lists.set(name,Array.from({length:Number(range[3])-Number(range[2])+1},(_,n)=>master.get(`${range[1]}${Number(range[2])+n}`) ?? "").filter(Boolean));
  }
  const codes:Record<string,string>={"Rate":"RATE","Place Of Supply":"POS","Reverse Charge":"RCHARGE","Invoice Type":"INVTYPE","Note Supply Type":"INVTYPE","Note Type":"CDRNOTE","Type":"TYPE","UQC":lists.has("NUQC") ? "NUQC" : "UQC","Applicable % of Tax Rate":"DIFF","Export Type":"EXP","UR Type":"URTYPE","Nature of Document":"DOCUMENT"};
  const cells=new Map<string,Map<string,{value:string;number:boolean}>>(),next=new Map<string,number>(),invoices=new Map<string,string>(),lastInvoice=new Map<string,string>(),summaries=new Set<string>(),checkedSheets=new Set<string>();
  const {schema,validate}=officialSchema(template.mappings.validator.file,template.mappings.validator.sha256);
  // GSTN schema v5.0 splits advances by recipient and names documents by text; v4.0 does not.
  const v5=Object.hasOwn((schema.properties as {at:{properties?:object}}).at.properties ?? {},"at_b2c");
  const last=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10);
  for(const draft of drafts) {
    const rows=new Map<string,Map<number,Figure>>();
    for(const [field,figure] of draft) {
      if(/\.t\d+\.c\d+$/.test(field)) continue;
      const match=/^([a-z0-9_]+)\.r(\d+)\.c(\d+)$/.exec(field);
      if(!match || !Object.hasOwn(salesSections,match[1])) throw new Error("This register section is not supported");
      const key=`${match[1]}.${match[2]}`;if(!rows.has(key)) rows.set(key,new Map());rows.get(key)!.set(Number(match[3]),figure);
    }
    for(const [key,row] of rows) {
      const section=key.split(".")[0] as SalesSection,sheet=template.mappings.sheets?.[section];
      if(!sheet) throw new Error("This register section does not fit the work's month");
      if(!checkedSheets.has(section)) {
        const headings=sheetCells(sheet);
        if(salesSections[section].headings.some((heading,column)=>headings.get(`${String.fromCharCode(65+column)}4`)!==heading)) throw new Error("The official headings changed");
        checkedSheets.add(section);
      }
      // Mandatory fields in the official Help Instruction and request schemas.
      const required=({b2b:[0,2,3,4,5,6,8,10,11],cdnr:[0,2,3,4,5,6,7,8,10,11],b2cs:[0,1,3,4],b2cl:[0,1,2,3,5,6],cdnur:[0,1,2,3,5,7,8],exp:[0,1,2,3,7,8],at:[0,2,3],atadj:[0,2,3],docs:[0,1,2,3]} as Record<string,number[]>)[section] ?? [0,2,3,5,6];
      if(required.some((column)=>!row.get(column)?.value)) throw new Error("A required register field is missing");
      const path=`xl/worksheets/sheet${sheet}.xml`,at=next.get(section) ?? 5;next.set(section,at+1);
      if(at>1004) throw new Error("Use at most 1,000 rows per section");
      if(!cells.has(path)) cells.set(path,new Map());
      for(const [column,figure] of row) {
        const heading=salesSections[section].headings[column];if(!heading) throw new Error("Unknown register column");
        if(/GSTIN|GSTIN\/UIN/.test(heading) && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(figure.value) && !isGstin(figure.value)) throw new Error("Check the GST number's last character");
        const list=codes[heading] && lists.get(codes[heading]);
        if(codes[heading] && (!list || !list.some((item)=>["Rate","Applicable % of Tax Rate"].includes(heading) ? Number(item)===Number(figure.value) : item===figure.value))) throw new Error(`Check ${heading} against the official choices`);
        let value=figure.value,number=numericHeadings.test(heading);
        if(number && !/^-?\d{1,13}(\.\d{1,2})?$/.test(value)) throw new Error(`Check ${heading}`);
        if(number && /^(Total Number|Cancelled)$/.test(heading) && !/^\d{1,10}$/.test(value)) throw new Error(`Check ${heading}: a whole number`);
        if(/date$/i.test(heading)) {
          if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0,10)!==value) throw new Error("Check the invoice or note date");
          // A shipping bill may follow later (Help Instruction); invoices and notes may not.
          if(value>last && heading!=="Shipping Bill Date") throw new Error("An invoice or note is after the work's month");
          value=String((Date.parse(value)-Date.UTC(1899,11,30))/86400000);number=true;
        }
        cells.get(path)!.set(`${String.fromCharCode(65+column)}${at}`,{value,number});
      }
      const get=(column:number)=>row.get(column)?.value ?? "",num=(column:number)=>Number(get(column));
      if(section==="b2cs" && get(0)==="E" && !get(6)) throw new Error("Name the commerce operator for this supply");
      const date=(column:number)=>get(column).split("-").reverse().join("-");
      const types:Record<string,string>={"Regular B2B":"R","SEZ supplies with payment":"SEWP","SEZ supplies without payment":"SEWOP","Deemed Exp":"DE","Intra-State supplies attracting IGST":"CBW"};
      const data:Record<string,unknown>={gstin,fp:period.slice(5)+period.slice(0,4)};
      const optional=(values:[string,number][])=>Object.fromEntries(values.filter(([,column])=>get(column)!=="").map(([field,column])=>[field,field==="diff_percent" ? num(column)/100 : field==="etin" ? get(column) : num(column)]));
      if(section==="b2b" || section==="cdnr") {
        if(get(0).toUpperCase()===gstin || !/^[A-Z0-9]+$/.test(get(0))) throw new Error("Check the recipient's GST number");
        const note=section==="cdnr",inv:Record<string,unknown>=note ? {nt_num:get(2),nt_dt:date(3),ntty:get(4),pos:get(5).slice(0,2),rchrg:get(6),inv_typ:types[get(7)],val:num(8),...optional([["diff_percent",9]])} : {inum:get(2),idt:date(3),val:num(4),pos:get(5).slice(0,2),rchrg:get(6),inv_typ:types[get(8)],...optional([["diff_percent",7],["etin",9]])};
        if(!note && get(9) && ["SEWP","SEWOP","DE"].includes(String(inv.inv_typ))) throw new Error("This invoice type cannot name a commerce operator");
        if(get(2)==="0") throw new Error("An invoice or note number cannot be zero");
        const identity=`${section}:${get(0)}:${get(2)}`,header=JSON.stringify(inv),previous=invoices.get(identity);
        if(previous && previous!==header) throw new Error("Rows for one invoice or note disagree");
        if(previous && lastInvoice.get(section)!==identity) throw new Error("Keep rows for one invoice or note together");
        invoices.set(identity,header);lastInvoice.set(section,identity);
        inv.itms=[{num:1,itm_det:{rt:num(10),txval:num(11),...optional([["csamt",12]])}}];
        data[section]=[{ctin:get(0),[note ? "nt" : "inv"]:[inv]}];
      } else if(section==="b2cs") data.b2cs=[{typ:get(0),sply_ty:gstin.slice(0,2)===get(1).slice(0,2) ? "INTRA" : "INTER",pos:get(1).slice(0,2),rt:num(3),txval:num(4),...optional([["diff_percent",2],["csamt",5],["etin",6]])}];
      else if(section==="b2cl") {
        // Help Instruction: inter-State, invoice value above Rs 1 lakh from August 2024, Rs 2.5 lakh before.
        if(get(3).slice(0,2)===gstin.slice(0,2)) throw new Error("Large B2C sales are inter-State; put this invoice in B2CS");
        if(num(2)<=(period>="2024-08" ? 100000 : 250000)) throw new Error("This invoice is within the B2CS limit for its month; put it in B2CS");
        const inv={inum:get(0),idt:date(1),val:num(2),...(v5 ? optional([["diff_percent",4]]) : optional([["etin",8]])),itms:[{num:1,itm_det:{rt:num(5),txval:num(6),...optional([["csamt",7]])}}]};
        const identity=`b2cl:${get(0)}`,header=JSON.stringify({...inv,itms:undefined,pos:get(3)}),previous=invoices.get(identity);
        if(previous && previous!==header) throw new Error("Rows for one invoice or note disagree");
        if(previous && lastInvoice.get(section)!==identity) throw new Error("Keep rows for one invoice or note together");
        invoices.set(identity,header);lastInvoice.set(section,identity);
        data.b2cl=[{pos:get(3).slice(0,2),inv:[inv]}];
      } else if(section==="cdnur") {
        // Help Instruction and schema: a B2CL note names the place of supply; an export note does not.
        const exported=get(0)!=="B2CL";
        if(exported===!!get(4)) throw new Error(exported ? "Leave the place of supply empty for an export note" : "Name the place of supply for this note");
        if(exported && get(6)) throw new Error("An export note has no applicable % of tax rate");
        data.cdnur=[{typ:get(0),ntty:get(3),nt_num:get(1),nt_dt:date(2),val:num(5),...(exported ? {} : {pos:get(4).slice(0,2),...(v5 ? optional([["diff_percent",6]]) : {})}),itms:[{num:1,itm_det:{rt:num(7),txval:num(8),...optional([["csamt",9]])}}]}];
        const identity=`cdnur:${get(1)}`,header=JSON.stringify({...(data.cdnur as object[])[0],itms:undefined}),previous=invoices.get(identity);
        if(previous && previous!==header) throw new Error("Rows for one invoice or note disagree");
        if(previous && lastInvoice.get(section)!==identity) throw new Error("Keep rows for one invoice or note together");
        invoices.set(identity,header);lastInvoice.set(section,identity);
      } else if(section==="exp") {
        if(get(4) && !/^[a-zA-Z0-9]{1,6}$/.test(get(4))) throw new Error("Check the six character port code");
        const inv={inum:get(1),idt:date(2),val:num(3),...(get(4) ? {sbpcode:get(4)} : {}),...(get(5) ? {sbnum:get(5)} : {}),...(get(6) ? {sbdt:date(6)} : {}),itms:[{rt:num(7),txval:num(8),...optional([["csamt",9]])}]};
        const identity=`exp:${get(1)}`,header=JSON.stringify({...inv,itms:undefined,typ:get(0)}),previous=invoices.get(identity);
        if(previous && previous!==header) throw new Error("Rows for one invoice or note disagree");
        if(previous && lastInvoice.get(section)!==identity) throw new Error("Keep rows for one invoice or note together");
        invoices.set(identity,header);lastInvoice.set(section,identity);
        data.exp=[{exp_typ:get(0),inv:[inv]}];
      } else if(section==="at" || section==="atadj") {
        // The workbook's tables are by place of supply and rate, as the schema's place of supply part.
        const entry={pos:get(0).slice(0,2),sply_ty:gstin.slice(0,2)===get(0).slice(0,2) ? "INTRA" : "INTER",itms:[{rt:num(2),ad_amt:num(3),...optional([["csamt",4]])}]};
        const key=section==="at" ? "at" : "txpd";
        data[key]=v5 ? {[`${key}_b2c`]:[entry]} : [entry];
      } else if(section==="docs") {
        // doc_num is the document's place in the official Nature of Document list (1 to 12).
        const position=(lists.get("DOCUMENT") ?? []).indexOf(get(0))+1;
        if(position<1) throw new Error("Check Nature of Document against the official choices");
        const cancel=num(4),total=num(3);
        if(cancel>total) throw new Error("More documents cancelled than issued");
        const docs=[{num:1,from:get(1),to:get(2),totnum:total,cancel,net_issue:total-cancel}];
        data.doc_issue=v5 ? {doc_det_new:[{doc_num:String(position),doc_typ:get(0),docs}]} : {doc_det:[{doc_num:position,docs}]};
      }
      else data.hsn={[section==="hsn" ? "data" : section]:[{num:at-4,...(get(0) ? {hsn_sc:get(0)} : {}),...(get(1) ? {desc:get(1)} : {}),uqc:get(2).split("-")[0],qty:num(3),rt:num(5),txval:num(6),...optional([["iamt",7],["camt",8],["samt",9],["csamt",10]])}]};
      // The workbook ignores HSN Total Value from May 2021; only taxable value is imported.
      if(!["b2b","cdnr","b2cl","cdnur","exp"].includes(section)) {
        const identity=section==="b2cs" ? `${section}:${get(0)}:${get(1)}:${get(2)}:${get(3)}:${get(6)}` : section==="at" || section==="atadj" ? `${section}:${get(0)}:${get(1)}:${get(2)}` : section==="docs" ? `${section}:${get(0)}:${get(1)}` : `${section}:${get(0)}:${get(2)}:${get(5)}`;
        if(summaries.has(identity)) throw new Error("Combine repeated summary rows in the register first");
        summaries.add(identity);
      }
      if(!validate(data)) throw new Error("A register row does not pass the official form's checks");
    }
  }
  if(!cells.size) throw new Error("There are no register rows to prepare");
  return writeWorkbook(original,cells);
}
