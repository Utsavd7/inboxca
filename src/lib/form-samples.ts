import type {Figure} from "./datasets";
import {itrFieldName,type ItrForm} from "./itr-fields";

// Invented returns InboxCA's tests fill, which the daily check also fills with a new version of
// an official form before it goes live by itself (D42). Every value is invented, never a
// taxpayer's, and none is an example of a return the portals accepted.
export const inventedPan="ZZZPZ0001Z"; // ggignore: invented PAN for schema tests.
export function inventedGstin(pan=inventedPan,entity="1") {
  const alphabet="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",base=`24${pan}${entity}Z`;
  const sum=[...base].reduce((sum,char,index)=>{const value=alphabet.indexOf(char)*(index%2 ? 2 : 1);return sum+Math.floor(value/36)+value%36;},0);
  return base+alphabet[(36-sum%36)%36]; // ggignore: invented GSTIN with a valid check character.
}

// One register row of a GSTR-1 section, its columns in the official workbook's order.
export const salesRow=(section:string,values:string[]):Map<string,Figure>=>new Map(values.flatMap((value,column)=>value==="" ? [] : [[`${section}.r2.c${column}`,{label:"Invented register field",value,kind:"text"} as Figure] as const]));
// A B2B invoice dated in the return's month, and an HSN row in the section the version has.
export const b2bRow=(period:string)=>salesRow("b2b",[inventedGstin("ZZZPZ0002Z"),"Invented Recipient","INV/1",`${period}-10`,"118","24-Gujarat","N","","Regular B2B","","18","100","0"]);
export const hsnRow=(section:"hsn"|"hsn_b2b")=>salesRow(section,["1001","Invented goods","NOS-NUMBERS","1.25","118","18","100","0","9","9","0"]);

// An ITR's every required figure, from its official schema: structure and required fields only,
// under the form's own field names. The PAN comes from the client, so it is not a figure.
export function itrFigures(schema:unknown,form:ItrForm) {
  type Node={type?:string;$ref?:string;allOf?:Node[];properties?:Record<string,Node>;items?:Node;required?:string[];default?:unknown;enum?:unknown[];minimum?:number;minItems?:number;pattern?:string};
  const resolve=(node:Node):Node=>{
    if(node.$ref) {let at:unknown=schema;for(const key of node.$ref.slice(2).split("/")) at=(at as Record<string,unknown>)[key];return resolve(at as Node);}
    return Object.assign({},...(node.allOf ?? []).map(resolve),node);
  };
  const text:Record<string,unknown>={AssesseeVerPAN:inventedPan,EmailAddress:"invented@invented.test",DOB:"1990-01-01",OptOutNewTaxRegime:"N",SecondaryAdd:"N",Form10IEAEarlierAYOldRegime:"NA",MobileNo:9000000000,CountryCodeMobile:91,CountryCode:"91",StateCode:"24",ReturnFileSec:11,EmployerCategory:"OTH",Capacity:"S",IFSCCode:"TSTB0000001",BankAccountNo:"000000000001",SeventhProvisio139:"N"}; // ggignore: invented identity, phone and bank details for schema tests.
  const make=(node:Node,key=""):unknown=>{
    node=resolve(node);
    if(key in text) return text[key];
    if(node.properties) return Object.fromEntries((node.required ?? []).map(key=>[key,make(node.properties![key],key)]));
    if(node.items) return Array.from({length:node.minItems ?? 0},()=>make(node.items!));
    if(node.default!==undefined) return node.default;
    if(node.enum) return node.enum[0];
    if(node.type==="integer" || node.type==="number") return Math.max(node.minimum ?? 0,0);
    return /^20\d{2}-\d{2}-\d{2}$/.test(node.pattern ?? "") ? node.pattern : node.pattern?.startsWith("([12]\\d{3}-") ? "2026-07-15" : "Invented";
  };
  const root=resolve(resolve(schema as Node).properties!.ITR).properties![form],body=make(root) as Record<string,unknown>;
  const figures:[string,Figure][]=[];
  // Every filled leaf becomes a figure under the form's own field name.
  const walk=(value:unknown,path:string[])=>{
    if(value && typeof value==="object") {for(const [key,item] of Object.entries(value)) walk(item,[...path,key]);return;}
    const field=itrFieldName(form,path.join("."));
    if(field!=="itr.personal.pan") figures.push([field,{label:path.at(-1)!,value:String(value),kind:typeof value==="number" ? "number" : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? "date" : "text"}]);
  };
  for(const [key,value] of Object.entries(body)) if(key!=="CreationInfo" && key!==`Form_${form}`) walk(value,[key]);
  return figures;
}
