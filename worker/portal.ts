import Ajv from "ajv";
import {readFileSync} from "node:fs";
import {isGstin} from "../src/lib/identifiers.ts";
import {jsonSource} from "./json-source.ts";

export type PortalRead={kind:"GSTR-2B";version:string;gstin:string;period:string;lines:{field:string;label:string;value:string;path:string;page:number}[];checks:{parts:string[];total:string}[]};
// Other official layouts join this interface only with their unchanged source and tests.
export type PortalParser={version:string;read:(value:unknown)=>PortalRead|null};
const object=(value:unknown):Record<string,unknown>=>value!==null && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
const validators=new Map<string,Ajv.ValidateFunction>();
const schemas=new Map<string,Record<string,unknown>>();
function valid(value:unknown,version:string) {
  let validate=validators.get(version);
  if(!validate) {
    const source=JSON.parse(readFileSync(new URL(`../reference/official/gstn/gstr2b-${version}-response-schema.json`,import.meta.url),"utf8"));
    schemas.set(version,source);
    validate=new Ajv({schemaId:"auto",allErrors:true,extendRefs:true,multipleOfPrecision:2,logger:false}).compile(source);
    validators.set(version,validate);
  }
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

export function readPortal(bytes:Uint8Array) {
  let value:unknown;
  try {value=JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/,""));} catch {return null;}
  for(const parser of portalParsers) {try {const read=parser.read(value);if(read) return read;} catch {continue;}}
  return null;
}
