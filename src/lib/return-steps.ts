import {fills,notReady,returnOf,stepOf,type Work} from "./return-work";

// The six steps of a return's own page (/app/clients/[id]/returns/[task]), in order, built on
// where public.return_stages says the return stands (src/lib/return-work.ts). Each work given
// here has its form only when that file was corrected outside InboxCA, as Fill reads it.
export const stepNames={papers:"Papers",figures:"Figures",draft:"Draft",check:"Check",approve:"Approve",file:"File"};
export type Step=keyof typeof stepNames;
const order=Object.keys(stepNames) as Step[];
const tds=(code:string|null)=>/^(TDS|TCS)_RET$/.test(code ?? "");

// GSTR-1, GSTR-3B and income tax returns have all six; a TDS or TCS statement is prepared on its
// own page and never filled, so it has no fill to check; any other return only papers and filing.
export const stepsFor=(code:string|null):Step[]=>fills(code) ? order : tds(code) ? order.filter(step=>step!=="check") : ["papers","file"];

// The step a return stands at: papers until they are in, figures until Fill could make the draft,
// then the fill's checks, the approval and the filing.
export function currentStep(work:Work,code:string|null):Step {
  const at=stepOf(work.stage),figures=work.stage==="in" || !!work.missing && work.missing!=="return" || !!work.form;
  const step:Step=at<2 ? "papers" : at===2 ? (figures ? "figures" : "draft") : (["check","approve","file","file"] as const)[at-3];
  const steps=stepsFor(code);
  return steps.includes(step) ? step : steps.find(one=>order.indexOf(one)>order.indexOf(step)) ?? steps[steps.length-1];
}

// The one thing to do next, as the button that does it (act), or why the return waits (why).
// Approve is for the firm's owner, partners and managers (approver), as Return files says.
export type Act="ask"|"upload"|"fill"|"open"|"check"|"approve"|"download"|"file";
export type Next={step:Step;label?:string;act?:Act;why?:string};
export function nextAction(work:Work,code:string|null,{period,drafts,approver}:{period:string;drafts:{wrong:number;name:string}[];approver:boolean}):Next|null {
  const step=currentStep(work,code);
  if(work.stage==="filed") return null;
  if(step==="papers") return work.stage==="asked" ? {step,label:"Upload papers",act:"upload",why:"Papers asked for. Waiting for the client to send them."} : {step,label:"Ask for papers",act:"ask"};
  if(!fills(code) && !tds(code) || step==="file") return work.stage==="approved" ? {step,label:"Download and file",act:"download"} : {step,label:"Mark filed",act:"file"};
  if(step==="approve") return approver ? {step,label:"Approve",act:"approve"} : {step,why:"Only the firm's owner, a partner or a manager can give the second approval."};
  if(step==="check") return work.stage==="rejected" ? {step,label:"Correct the figures",act:"check",why:notReady({...work,form:null},drafts,period)!} : {step,label:`Check ${work.open ?? 0} ${work.open===1 ? "figure" : "figures"}`,act:"check"};
  if(tds(code)) return {step:"draft",label:"Prepare the statement",act:"open"};
  const why=notReady({...work,form:work.form ?? null},drafts,period);
  if(work.missing==="return") return {step:"draft",label:"Start the return",act:"open",why:why!};
  if(why) return {step:"figures",why};
  return /^ITR_/.test(code ?? "") ? {step:"draft",label:"Open the income tax return",act:"open"} : {step:"draft",label:`Prepare ${returnOf(code)}`,act:"fill"};
}
