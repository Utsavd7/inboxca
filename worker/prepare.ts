import type {FormRequest} from "../src/lib/form-worker.ts";
import {chooseTemplate} from "../src/lib/templates.ts";
import {gstr1Workbook} from "./gstr1.ts";
import {gstr3bJson} from "./gstr3b.ts";
import {itrBody,itrCreation,itrEntries,itrReview} from "./itr.ts";

export function prepare(request:FormRequest) {
  const {template,period,gstin}=request;
  chooseTemplate([template],template.form_code,period);
  if(/^ITR[1-4]$/.test(template.form_code)) {
    const body=request.purpose==="fields" ? itrEntries(template) : request.purpose==="check" ? itrReview(request) : itrBody(request,itrCreation(template));
    return {bytes:Buffer.from(JSON.stringify(body)),extension:"json",type:"application/json"};
  }
  if(template.form_code==="GSTR1" && template.mappings.format==="xlsx") return {bytes:gstr1Workbook(template,period,gstin!,request.drafts.map(draft=>new Map(draft.figures))),extension:"xlsx",type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
  if(template.form_code==="GSTR3B" && template.mappings.format==="json") return {bytes:gstr3bJson(template,period,gstin!,request.registration,request.drafts.map(draft=>new Map(draft.figures))),extension:"json",type:"application/json"};
  throw new Error("This official form is not ready yet");
}
