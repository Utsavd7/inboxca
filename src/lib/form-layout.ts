import {salesSections,type SalesSection} from "./gstr1-fields";
import {itrFields,itrGroup,type ItrForm} from "./itr-fields";

// A return laid out the way its official form is: tables of rows, each row's boxes holding the
// figures that fill them (ids), or words for a box InboxCA fills from other figures or leaves for
// the portal. Shared by Check on the form and the form view of a prepared return.
export type FormCell={ids?:string[];text?:string}|null;
export type FormRow={key:string;number?:string;name:string;fill:"figures"|"heading"|"worked"|"elsewhere"|"portal"|"none";cells:FormCell[]};
export type FormTable={key:string;number?:string;name:string;heads:string[];rows:FormRow[]};
export type FormLayout={tables:FormTable[];placed:number;empty?:string[]};

// GSTR-3B as the official offline utility lays it out (reference/official/gstr3b-v5.8, sheet
// GSTR-3B): its tables, row names and columns in its order, with where worker/gstr3b.ts writes each
// row in the upload JSON. credit: the GSTR-2B summary parts the GSTR-3B FAQ puts in the row, as
// worker/gstr3b.ts places them; sales: rows InboxCA fills from the GSTR-1 figures; portal: rows
// InboxCA leaves for the portal; worked: 4(C), which is 4(A) less 4(B).
type Row3b={key:string;number?:string;name:string;json?:string;heads?:string[];credit?:string[];fill:"credit"|"sales"|"portal"|"worked"|"heading"};
const valued:[string,string][]=[["txval","Total Taxable value"],["iamt","Integrated Tax"],["camt","Central Tax"],["samt","State/UT Tax"],["csamt","Cess"]],taxes=valued.slice(1);
export const gstr3bTables:{key:string;number:string;name:string;heads:[string,string][];rows:Row3b[]}[]=[
  {key:"3.1",number:"3.1",name:"Details of Outward Supplies and inward supplies liable to reverse charge",heads:valued,rows:[
    {key:"3.1a",number:"(a)",name:"Outward Taxable supplies (other than zero rated, nil rated and exempted)",json:"sup_details.osup_det",fill:"sales"},
    {key:"3.1b",number:"(b)",name:"Outward Taxable supplies (zero rated)",json:"sup_details.osup_zero",heads:["txval","iamt","csamt"],fill:"sales"},
    {key:"3.1c",number:"(c)",name:"Other Outward Taxable supplies (Nil rated, exempted)",json:"sup_details.osup_nil_exmp",heads:["txval"],fill:"sales"},
    {key:"3.1d",number:"(d)",name:"Inward supplies (liable to reverse charge)",json:"sup_details.isup_rev",fill:"portal"},
    {key:"3.1e",number:"(e)",name:"Non-GST Outward supplies",json:"sup_details.osup_nongst",heads:["txval"],fill:"sales"},
  ]},
  {key:"3.1.1",number:"3.1.1",name:"Details of supplies notified under section 9(5) of the CGST Act, 2017 and corresponding provision in IGST/UTGST/SGST Acts",heads:valued,rows:[
    {key:"3.1.1i",number:"(i)",name:"Taxable supplies on which electronic commerce operator pays tax u/s 9(5) [to be furnished by electronic commerce operator]",json:"eco_dtls.eco_sup",fill:"portal"},
    {key:"3.1.1ii",number:"(ii)",name:"Taxable supplies made by registered person through electronic commerce operator, on which electronic commerce operator is required to pay tax u/s 9(5) [to be furnished by registered person making supplies through electronic commerce operator]",json:"eco_dtls.eco_reg_sup",heads:["txval"],fill:"sales"},
  ]},
  {key:"3.2",number:"3.2",name:"Of the supplies shown in 3.1 (a), details of inter-state supplies made to unregistered persons, composition taxable person and UIN holders",heads:[["pos","Place of Supply(State/UT)"],["txval","Total Taxable value"],["iamt","Amount of Integrated Tax"]],rows:[
    {key:"3.2u",name:"Supplies made to Unregistered Persons",json:"inter_sup.unreg_details",fill:"sales"},
    {key:"3.2c",name:"Supplies made to Composition Taxable Persons",json:"inter_sup.comp_details",fill:"portal"},
    {key:"3.2i",name:"Supplies made to UIN holders",json:"inter_sup.uin_details",fill:"portal"},
  ]},
  {key:"4",number:"4",name:"Eligible ITC",heads:taxes,rows:[
    {key:"4a",number:"(A)",name:"ITC Available (Whether in full or part)",fill:"heading"},
    {key:"4a1",number:"(1)",name:"Import of goods",json:"itc_elg.itc_avl.IMPG",credit:["itcavl.imports"],fill:"credit"},
    {key:"4a2",number:"(2)",name:"Import of services",json:"itc_elg.itc_avl.IMPS",fill:"portal"},
    {key:"4a3",number:"(3)",name:"Inward supplies liable to reverse charge (other than 1 & 2 above)",json:"itc_elg.itc_avl.ISRC",credit:["itcavl.revsup"],fill:"credit"},
    {key:"4a4",number:"(4)",name:"Inward supplies from ISD",json:"itc_elg.itc_avl.ISD",credit:["itcavl.isdsup"],fill:"credit"},
    {key:"4a5",number:"(5)",name:"All other ITC",json:"itc_elg.itc_avl.OTH",credit:["itcavl.nonrevsup"],fill:"credit"},
    {key:"4b",number:"(B)",name:"ITC Reversed",fill:"heading"},
    {key:"4b1",number:"(1)",name:"As per rules 38,42 & 43 of CGST Rules and section 17(5)",json:"itc_elg.itc_rev.RUL",fill:"portal"},
    {key:"4b2",number:"(2)",name:"Others",json:"itc_elg.itc_rev.OTH",fill:"portal"},
    {key:"4c",number:"(C)",name:"Net ITC Available (A)-(B)",json:"itc_elg.itc_net",fill:"worked"},
    {key:"4d",number:"(D)",name:"Other Details",fill:"heading"},
    {key:"4d1",number:"(1)",name:"ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period",json:"itc_elg.itc_inelg.RUL",fill:"portal"},
    {key:"4d2",number:"(2)",name:"Ineligible ITC under section 16(4) & ITC restricted due to PoS rules",json:"itc_elg.itc_inelg.OTH",credit:["itcunavl.nonrevsup","itcunavl.isdsup","itcunavl.revsup"],fill:"credit"},
  ]},
  {key:"5",number:"5",name:"Values of exempt, Nil-rated and non-GST inward supplies",heads:[["inter","Inter-State supplies"],["intra","Intra-state supplies"]],rows:[
    {key:"5g",name:"From a supplier under composition scheme, Exempt and Nil rated supply",json:"inward_sup.isup_details.GST",fill:"portal"},
    {key:"5n",name:"Non GST supply",json:"inward_sup.isup_details.NONGST",fill:"portal"},
  ]},
  {key:"5.1",number:"5.1",name:"Interest & late fee payable",heads:taxes,rows:[
    {key:"5.1i",name:"Interest",json:"intr_ltfee.intr_details",fill:"portal"},
    {key:"5.1l",name:"Late fee",fill:"portal"},
  ]},
  {key:"6",number:"6",name:"Payment of Tax",heads:[],rows:[{key:"6p",name:"Payment of tax",fill:"portal"}]},
];
// The 4(A) and 4(D) row and column a GSTR-2B summary total goes in, as worker/gstr3b.ts places it.
const credit3b=/^gstr2b\.([a-z0-9]+)\.data\.itcsumm\.(itcavl|itcunavl)\.([a-z]+)\.(igst|cgst|sgst|cess)$/;
const headOf:Record<string,string>={igst:"iamt",cgst:"camt",sgst:"samt",cess:"csamt"};
export const words3b={portal:"Add on the portal",sales:"Filled from the sales figures",worked:"Worked out by InboxCA"};

type Line={id:string;field:string;label:string};
const other=(lines:Line[]):FormTable[]=>lines.length ? [{key:"other",name:"Other figures",heads:["Figure"],rows:lines.map((line)=>({key:line.id,name:line.label,fill:"figures",cells:[{ids:[line.id]}]}))}] : [];

function gstr3b(lines:Line[],names:Record<string,string>):FormLayout {
  const keys=[...new Set(lines.flatMap((line)=>credit3b.exec(line.field)?.[1] ?? []))],placed=new Set<string>();
  const tables=keys.flatMap((key)=>gstr3bTables.map((table)=>{
    const into=(row:Row3b,head:string)=>lines.filter((line)=>{const hit=credit3b.exec(line.field);return hit?.[1]===key && headOf[hit[4]]===head && !!row.credit?.includes(`${hit[2]}.${hit[3]}`);}).map((line)=>line.id);
    return {key:`${key}-${table.key}`,number:table.number,name:keys.length>1 ? `${table.name}, ${names[key] ?? "GSTIN"}` : table.name,heads:table.heads.map(([,label])=>label),rows:table.rows.map((row):FormRow=>{
      if(row.fill==="heading") return {key:row.key,number:row.number,name:row.name,fill:"heading",cells:[]};
      if(row.fill==="sales" || row.fill==="portal") return {key:row.key,number:row.number,name:row.name,fill:row.fill==="sales" ? "elsewhere" : "portal",cells:[{text:row.fill==="sales" ? words3b.sales : words3b.portal}]};
      if(row.fill==="worked") return {key:row.key,number:row.number,name:row.name,fill:"worked",cells:table.heads.map(([head])=>({ids:table.rows.filter((one)=>one.key.startsWith("4a")).flatMap((one)=>into(one,head))}))};
      const cells=table.heads.map(([head])=>{const ids=into(row,head);ids.forEach((id)=>placed.add(id));return ids.length ? {ids} : null;});
      return cells.some(Boolean) ? {key:row.key,number:row.number,name:row.name,fill:"figures",cells} : {key:row.key,number:row.number,name:row.name,fill:"none",cells:[{text:"Not in this GSTR-2B"}]};
    })};
  }));
  return {tables:[...tables,...other(lines.filter((line)=>!placed.has(line.id)))],placed:placed.size};
}

// GSTR-1 by the sheets of the official workbook (gstr1-fields.ts), in its order: a register's
// row and column (sales-register.ts, worker/edited-form.ts) are the sheet's row and heading.
function gstr1(lines:Line[]):FormLayout {
  const cell=/^([a-z0-9_]+)\.([rt])(\d+)\.c(\d+)$/,read=(line:Line)=>{const hit=cell.exec(line.field);return hit && Object.hasOwn(salesSections,hit[1]) && salesSections[hit[1] as SalesSection].headings[Number(hit[4])] ? {section:hit[1] as SalesSection,total:hit[2]==="t",row:Number(hit[3]),column:Number(hit[4])} : null;};
  const placed=lines.filter(read),tables:FormTable[]=[],empty:string[]=[];
  for(const [section,{name,headings}] of Object.entries(salesSections) as [SalesSection,typeof salesSections[SalesSection]][]) {
    const mine=placed.map((line)=>({line,at:read(line)!})).filter(({at})=>at.section===section);
    if(!mine.length) {empty.push(name);continue;}
    const columns=[...new Set(mine.map(({at})=>at.column))].sort((a,b)=>a-b),rows=[...new Set(mine.map(({at})=>`${at.total ? "t" : "r"}${at.row}`))].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
    tables.push({key:section,name,heads:columns.map((column)=>headings[column]),rows:rows.map((row)=>({key:`${section}.${row}`,name:`${row.startsWith("t") ? "Total, row" : "Row"} ${row.slice(1)}`,fill:"figures",cells:columns.map((column)=>{const ids=mine.filter(({at})=>`${at.total ? "t" : "r"}${at.row}`===row && at.column===column).map(({line})=>line.id);return ids.length ? {ids} : null;})}))});
  }
  return {tables:[...tables,...other(lines.filter((line)=>!read(line)))],placed:placed.length,empty};
}

// An income tax return by its official schema's parts (itr-fields.ts names them as the worker's
// form entries do), each detail InboxCA maps in itr-fields.ts order; a repeating one (TDS rows,
// challans) is a table with a row each. A paper read without a chosen return lays out as ITR-1.
function itr(lines:Line[],target?:string):FormLayout {
  const form=(target ?? "ITR1") as ItrForm,key=(field:string)=>field.replace(/\.(0|[1-9]\d{0,2})(?=\.|$)/g,".*"),index=(field:string)=>/\.(\d+)\./.exec(field)?.[1] ?? "0";
  const entries=Object.entries(itrFields).flatMap(([field,entry])=>{const path=(entry.paths as Partial<Record<ItrForm,string>>)[form];return path ? [{field,label:entry.label,part:itrGroup(path.split(".")[0]),rows:field.includes("*")}] : [];});
  const placed=new Set<string>(),tables:FormTable[]=[];
  for(const part of [...new Set(entries.map((entry)=>`${entry.part}|${entry.rows}`))]) {
    const mine=entries.filter((entry)=>`${entry.part}|${entry.rows}`===part),found=(field:string)=>lines.filter((line)=>key(line.field)===field);
    mine.forEach((entry)=>found(entry.field).forEach((line)=>placed.add(line.id)));
    if(!mine[0].rows) {tables.push({key:part,name:mine[0].part,heads:["Figure"],rows:mine.map((entry)=>{const ids=found(entry.field).map((line)=>line.id);return {key:entry.field,name:entry.label,fill:ids.length ? "figures" : "none",cells:[ids.length ? {ids} : {text:"Not in these figures"}]};})});continue;}
    const rows=[...new Set(mine.flatMap((entry)=>found(entry.field).map((line)=>index(line.field))))].sort((a,b)=>Number(a)-Number(b));
    tables.push({key:part,name:mine[0].part,heads:mine.map((entry)=>entry.label),rows:rows.length ? rows.map((row)=>({key:`${part}.${row}`,name:`Row ${Number(row)+1}`,fill:"figures",cells:mine.map((entry)=>{const ids=found(entry.field).filter((line)=>index(line.field)===row).map((line)=>line.id);return ids.length ? {ids} : null;})})) : [{key:`${part}.none`,name:"No rows",fill:"none",cells:[{text:"Not in these figures"}]}]});
  }
  return {tables:[...tables,...other(lines.filter((line)=>!placed.has(line.id)))],placed:placed.size};
}

// names: a label for each GSTIN key in a GSTR-2B figure's field, when a set has more than one.
export function formLayout(form:string,lines:Line[],{target,names={}}:{target?:string;names?:Record<string,string>}={}):FormLayout {
  if(form==="GSTR3B") return gstr3b(lines,names);
  if(form==="GSTR1") return gstr1(lines);
  if(form==="ITR" && lines.some((line)=>line.field.startsWith("itr."))) return itr(lines,target);
  return {tables:other(lines),placed:0};
}
