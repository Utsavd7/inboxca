import {isGstin} from "../src/lib/identifiers.ts";
import {jsonSource} from "./json-source.ts";
import {officialSchema} from "./schema.ts";

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
