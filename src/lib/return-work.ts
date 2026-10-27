import {periodLabel} from "./calendar";

// Where a return stands and what holds it up, as public.return_stages and public.return_pins
// (20261031900000_return_work.sql) decide, in the words staff read.
export type Work={stage:string;open:number|null;missing:string|null;form?:string|null};
export type Pin=Work & {kind:string;task:string;form:string|null;client:string;client_name:string;code:string;period_key:string;due_on:string};

// The return a calendar task is, and the ones Fill makes (an ITR in the form chosen on its own
// page).
export const returnOf=(code:string|null)=>/^GSTR1_/.test(code ?? "") ? "GSTR-1" : /^GSTR3B_/.test(code ?? "") ? "GSTR-3B" : /^ITR_/.test(code ?? "") ? "ITR" : null;
export const fills=(code:string|null)=>/^(GSTR1|GSTR3B|ITR)_/.test(code ?? "");
export const returnPeriod=(code:string,period:string)=>periodLabel(/_Q$/.test(code) ? "quarterly" : /^ITR_/.test(code) ? "yearly" : "monthly",period);
// Fill is offered while a return has figures but no draft made from them.
export const fillable=(work?:Work)=>!!work && ["figures","checked"].includes(work.stage) && !work.missing;

const figures=(count:number)=>`${count} ${count===1 ? "figure" : "figures"}`;
const missingWords:Record<string,string>={sales:"sales register still missing",credit:"GSTR-2B still missing",return:"return not started"};
const lines:Record<string,string>={none:"Papers not asked for yet",asked:"Papers asked for",in:"Papers in, figures not read yet",rejected:"Draft sent back. Correct the figures",checked:"All figures checked, not filled yet",draft:"Checked, waiting for approval",approved:"Approved. Download it and file on the portal",filed:"Filed"};
// Six steps, and how many a return has passed.
export const steps=["Papers asked for","Papers in","Filled","Checked","Approved","Filed"];
export const stepOf=(stage:string)=>({none:0,asked:1,in:2,figures:2,checked:2,filled:3,rejected:3,draft:4,approved:5,filed:6} as Record<string,number>)[stage] ?? 0;

// One plain line of where a return stands.
export function stageLine({stage,open,missing}:Work) {
  if(stage==="filled") return `Filled. ${figures(open ?? 0)} not checked yet`;
  if(stage!=="figures") return lines[stage] ?? "";
  if(missing) return `Papers in, ${missingWords[missing]}`;
  return `Papers in, not filled yet${open ? `. ${figures(open)} not checked yet` : ""}`;
}

// Why Fill cannot make a return's draft, naming what to do; null when it can.
export function notReady(work:Work & {form:string|null},drafts:{wrong:number;name:string}[],period:string) {
  if(work.stage==="filed") return "This return is filed already.";
  if(work.stage==="rejected") return "This draft was sent back. Correct the figures first.";
  if(work.stage==="figures" && work.form) return "Check the figures of the corrected file first.";
  if(work.missing==="return") return "Start this return on its income tax page first, so InboxCA knows its form.";
  if(!drafts.length || work.missing==="sales") return `Add the sales register for ${period} first.`;
  if(work.missing==="credit") return `Add the GSTR-2B for ${period} first.`;
  const wrong=drafts.filter(draft=>draft.wrong),one=wrong.length===1 && wrong[0].wrong===1;
  return wrong.length ? `${wrong.map(draft=>`${figures(draft.wrong)} in ${draft.name}`).join(" and ")} ${one ? "is" : "are"} marked wrong. Correct ${one ? "it" : "them"} first.` : null;
}

export function dueWords(due:string,today:string) {
  const days=Math.round((Date.parse(due)-Date.parse(today))/86_400_000);
  return days<=0 ? "due today" : days===1 ? "due tomorrow" : `due in ${days} days`;
}

// A pinned return, as a title and a line under it: "GSTR-3B for Mehta Textiles, Sep 2026" and
// "Due in 4 days. Filled, 3 figures not checked yet".
export function pinWords(pin:Pin,today:string) {
  const title=`${returnOf(pin.code)} for ${pin.client_name}, ${returnPeriod(pin.code,pin.period_key)}`,due=dueWords(pin.due_on,today);
  if(pin.kind==="approve") return {title,meta:"Checked and ready for your approval"};
  if(pin.kind==="approved") return {title,meta:"Approved. Download it and file on the portal"};
  const held=pin.stage==="filled" ? `filled, ${figures(pin.open ?? 0)} not checked yet` : pin.stage==="rejected" ? "draft sent back" : pin.missing ? missingWords[pin.missing] : pin.kind==="fill" ? "not filled yet" : pin.stage==="in" ? "papers in, figures not read yet" : "papers still missing";
  return {title,meta:`${due[0].toUpperCase()}${due.slice(1)}. ${held[0].toUpperCase()}${held.slice(1)}`};
}

// Why InboxCA's own fill left a return for a person, by the code its job keeps
// (src/jobs/fill-return.ts, src/lib/fill.ts).
export const fillReasons:Record<string,string>={
  software:"InboxCA cannot make the return file for the income tax portal yet. It is waiting for its software ID from the Income Tax Department.",
  forms:"Figures are entered for two ITR forms. Prepare the right one under Return files.",
  details:"Details its official form needs are still empty. Fill them on its income tax page.",
  issues:"Some figures do not fit its official form. Correct them on its income tax page.",
  pan:"Keep only one PAN for this client before preparing this return.",
  form:"The official form for this period is not ready yet.",
};

// A return in Fill all's preview (/app/work, public.due_fills): it is filled now when ready and
// not filled or being filled already; otherwise the line says why not. Only the file worker knows
// whether an ITR has every detail its official form needs, so an ITR is filled where every detail
// is there, none before InboxCA has its software ID (itrs false), and one the last fill left says why.
export type DueFill=Work & {code:string;period_key:string;due_on:string;wrong:number;ready:boolean;filling:boolean;reason?:string|null};
export function fillLine(row:DueFill,today:string,itrs=true) {
  const itr=/^ITR_/.test(row.code),held=itr && !itrs && row.ready && !row.filling,go=row.ready && !row.filling && !held;
  const why=held ? fillReasons.software : row.wrong ? `${figures(row.wrong)} marked wrong` : !row.ready && row.stage==="figures" && !row.missing ? "Corrected file to check first" : stageLine(row);
  const ready=row.reason ? `Not filled last time. ${fillReasons[row.reason] ?? "Press Fill on the return to see why."}` : row.open ? `${figures(row.open)} to check` : "Every figure checked";
  return {go,status:go ? (itr ? "Filled if every detail is there" : "Will be filled") : ["filled","draft","approved"].includes(row.stage) ? "Filled already" : row.filling ? "Being filled" : "Not ready",
    what:`${returnOf(row.code)} for ${returnPeriod(row.code,row.period_key)}, ${dueWords(row.due_on,today)}. ${go ? ready : why}`};
}
