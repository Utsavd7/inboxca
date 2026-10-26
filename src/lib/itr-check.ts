import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/src/db/types";
import {draftSchema,hundredths,openFigures} from "./datasets";
import {itrFields} from "./itr-fields";

// ITR against Form 26AS before approval (PLAN.md "Less work for the firm"): most income tax
// mismatch notices come from TDS claimed in a return that differs from Form 26AS. This lists
// the differences for the CA and never changes the return. Only official fields are compared:
// Form 26AS Part I's total tax deducted for each TAN (f26as.tds.*, worker/portal.ts) against
// the return's TDS on salary and tax deducted on other income under the same TAN, each booking
// status other than F (final), and Form 16 or Form No. 130 salary against the return's salary.
type Figure={field:string;value:string};
export type Difference={text:string;paper:string};
const RUPEE=BigInt(100),ZERO=BigInt(0);

// "₹12,400", or "₹12,400.50", from hundredths of a rupee.
export function rupees(amount:bigint) {
  const sign=amount<ZERO ? "-" : "",whole=amount<ZERO ? -amount : amount,paise=whole%RUPEE;
  return `${sign}₹${(whole/RUPEE).toLocaleString("en-IN")}${paise ? `.${String(paise).padStart(2,"0")}` : ""}`;
}
export const checkWords=(list:Difference[])=>`${list.length} ${list.length===1 ? "difference" : "differences"} with ${[...new Set(list.map(item=>item.paper))].join(" and ")}`;
export const checkTitle=(list:Difference[])=>`Check before approving: ${checkWords(list)}`;

// back: the return's figures; statement: the newest Form 26AS's figures, or null when the year
// has none; salary: each Form 16 or Form No. 130 read for the year. Rejected figures are left out
// by the caller. Amounts within 1 rupee are taken as equal.
export function itrDifferences(back:Figure[],statement:Figure[]|null,salary:{paper:string;figures:Figure[]}[]):Difference[] {
  const out:Difference[]=[],differ=(a:bigint,b:bigint)=>(a>b ? a-b : b-a)>RUPEE;
  const of=(figures:Figure[])=>new Map(figures.map(figure=>[figure.field,figure.value]));
  const amount=(value?:string)=>value===undefined ? ZERO : hundredths(value);
  type Deductor={name?:string;amount:bigint;held:bigint;statuses:Set<string>};
  const add=(map:Map<string,Deductor>,tan:string,name:string|undefined,value:bigint)=>{
    const entry=map.get(tan) ?? {amount:ZERO,held:ZERO,statuses:new Set<string>()};
    entry.name??=name;entry.amount+=value;map.set(tan,entry);return entry;
  };
  // The return: each TDS row's TAN with its tax deducted.
  const filed=new Map<string,Deductor>(),values=of(back);
  for(const [field,tan] of values) {
    const row=/^(itr\.tds\.(?:salary|other)\.\d+)\.tan$/.exec(field);
    if(row && tan.trim()) add(filed,tan.trim().toUpperCase(),values.get(`${row[1]}.name`),amount(values.get(`${row[1]}.deducted`)));
  }
  const who=(tan:string,name?:string)=>name ? `${name} (${tan})` : `TAN ${tan}`;
  if(statement) {
    // Form 26AS: each deductor's total tax deducted, and the entries not booked as final.
    const listed=new Map<string,Deductor>(),given=of(statement),rows=new Map<string,Deductor>();
    for(const [field,tan] of given) {
      const row=/^(f26as\.tds\.\d+)\.tan$/.exec(field);
      if(row) rows.set(row[1],add(listed,tan,given.get(`${row[1]}.name`),amount(given.get(`${row[1]}.deducted`))));
    }
    for(const [field,status] of given) {
      const row=/^(f26as\.tds\.\d+)(\.rows\.\d+)\.status$/.exec(field),entry=row && rows.get(row[1]);
      if(entry && status!=="F") {entry.statuses.add(status);entry.held+=amount(given.get(`${row[1]}${row[2]}.deducted`));}
    }
    for(const [tan,entry] of listed) {
      const claimed=filed.get(tan),name=who(tan,entry.name);
      if(!claimed && differ(entry.amount,ZERO)) out.push({paper:"Form 26AS",text:`TDS of ${rupees(entry.amount)} from ${name} is in Form 26AS but not in the return.`});
      else if(claimed && differ(entry.amount,claimed.amount)) out.push({paper:"Form 26AS",text:`TDS from ${name} is ${rupees(entry.amount)} in Form 26AS and ${rupees(claimed.amount)} in the return.`});
    }
    for(const [tan,entry] of filed) if(!listed.has(tan) && differ(entry.amount,ZERO)) out.push({paper:"Form 26AS",text:`TDS of ${rupees(entry.amount)} from ${who(tan,entry.name)} is in the return but not in Form 26AS.`});
    for(const [tan,entry] of listed) if(entry.statuses.size) out.push({paper:"Form 26AS",text:`${rupees(entry.held)} of the TDS from ${who(tan,entry.name)} has booking status ${[...entry.statuses].join(" and ")} in Form 26AS, not F (final).`});
  }
  // Salary: the certificates' total against the return's, for each salary figure they give.
  for(const field of ["itr.salary.gross","itr.salary.income"] as const) {
    const papers=salary.filter(paper=>paper.figures.some(figure=>figure.field===field));
    if(!papers.length) continue;
    const sum=(figures:Figure[])=>figures.filter(figure=>figure.field===field).reduce((total,figure)=>total+amount(figure.value),ZERO);
    const given=papers.reduce((total,paper)=>total+sum(paper.figures),ZERO),returned=sum(back),paper=[...new Set(papers.map(item=>item.paper))].join(" and ");
    if(!back.some(figure=>figure.field===field)) out.push({paper,text:`${itrFields[field].label} is ${rupees(given)} in ${paper} but not in the return.`});
    else if(differ(given,returned)) out.push({paper,text:`${itrFields[field].label} is ${rupees(given)} in ${paper} and ${rupees(returned)} in the return.`});
  }
  return out;
}

// Each return's differences, read as the signed in person. A return is its own entered figures
// and the figures from the client's papers for the year, as src/lib/itr.ts builds it, or the
// drafts a prepared return was made from (sources). statement: the year has a Form 26AS.
export type ItrWork={client:string;period:string;form:string;sources?:string[]};
export async function itrChecks(db:SupabaseClient<Database>,firm:string,returns:ItrWork[]) {
  if(!returns.length) return [];
  const {data:rows,error}=await db.from("datasets").select("id,client_id,period_key,data").eq("firm_id",firm).eq("form_code","ITR").in("client_id",[...new Set(returns.map(work=>work.client))]).in("period_key",[...new Set(returns.map(work=>work.period))]).limit(1000);
  if(error) throw new Error("The figures could not be read.");
  const drafts=(rows ?? []).map(row=>({...row,data:draftSchema.parse(row.data)}));
  const reader=(draft:typeof drafts[number])=>draft.data.target ? "" : draft.data.lines[0].source.reader ?? "";
  // Papers still in Documents, newest first: a removed paper is not checked against.
  const ids=drafts.filter(draft=>/^form(26as|16|130)-/.test(reader(draft))).map(draft=>draft.id);
  const {data:papers,error:failed}=ids.length ? await db.from("documents").select("id").eq("firm_id",firm).in("id",ids).in("status",["filed","to_check"]).order("received_at",{ascending:false}) : {data:[],error:null};
  if(failed) throw new Error("The papers could not be read.");
  const newest=(papers ?? []).map(paper=>paper.id),opened=new Map<string,Promise<Figure[]>>();
  const figures=(draft:typeof drafts[number])=>{
    if(!opened.has(draft.id)) opened.set(draft.id,openFigures(firm,draft.id,draft.data).then(values=>draft.data.lines.filter(line=>line.state!=="rejected").map(line=>({field:line.field,value:values.get(line.id)!.value}))));
    return opened.get(draft.id)!;
  };
  return Promise.all(returns.map(async work=>{
    const year=drafts.filter(draft=>draft.client_id===work.client && draft.period_key===work.period);
    const used=year.filter(draft=>work.sources ? work.sources.includes(draft.id) : !draft.data.target || draft.data.target.form===work.form && draft.data.lines.some(line=>line.source.entered_by));
    const kept=year.filter(draft=>newest.includes(draft.id)).sort((a,b)=>newest.indexOf(a.id)-newest.indexOf(b.id)),statement=kept.find(draft=>reader(draft)==="form26as-text");
    const salary=await Promise.all(kept.filter(draft=>/^form(16|130)-/.test(reader(draft))).map(async draft=>({paper:reader(draft).startsWith("form16") ? "Form 16" : "Form No. 130",figures:await figures(draft)})));
    const back=(await Promise.all(used.map(figures))).flat().filter(figure=>figure.field.startsWith("itr."));
    return {statement:!!statement,differences:itrDifferences(back,statement ? await figures(statement) : null,salary)};
  }));
}
