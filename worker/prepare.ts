import type {FormRequest} from "../src/lib/form-worker.ts";
import {chooseTemplate} from "../src/lib/templates.ts";
import {gstr1Workbook} from "./gstr1.ts";
import {itrBody,itrCreation,itrEntries} from "./itr.ts";
import {itrChecks} from "./itr-rules.ts";

export function prepare(request:FormRequest) {
  const {template,period,gstin}=request;
  chooseTemplate([template],template.form_code,period);
  if(/^ITR[14]$/.test(template.form_code)) {
    if(request.purpose==="fields") return {bytes:Buffer.from(JSON.stringify(itrEntries(template))),extension:"json",type:"application/json"};
    const output=itrBody(request,request.purpose==="prepare" ? itrCreation() : {},request.purpose==="prepare"),issues=itrChecks(output.ITR[template.form_code],template.form_code);
    if(request.purpose==="check") return {bytes:Buffer.from(JSON.stringify({issues})),extension:"json",type:"application/json"};
    if(issues.length) throw new Error(issues[0]);
    return {bytes:Buffer.from(JSON.stringify(output)),extension:"json",type:"application/json"};
  }
  if(template.form_code==="GSTR1" && template.mappings.format==="xlsx") return {bytes:gstr1Workbook(template,period,gstin!,request.drafts.map(draft=>new Map(draft.figures))),extension:"xlsx",type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
  // GSTR-3B stays unavailable until its published output layout and periods are checked.
  throw new Error("This official form is not ready yet");
}
