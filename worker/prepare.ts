import type {FormRequest} from "../src/lib/form-worker.ts";
import {chooseTemplate} from "../src/lib/templates.ts";
import {gstr1Workbook} from "./gstr1.ts";

export function prepare(request:FormRequest) {
  const {template,period,gstin}=request;
  chooseTemplate([template],template.form_code,period);
  if(template.form_code==="GSTR1" && template.mappings.format==="xlsx") return {bytes:gstr1Workbook(template,period,gstin,request.drafts.map(draft=>new Map(draft.figures))),extension:"xlsx",type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
  // GSTR-3B stays unavailable until its published output layout and periods are checked.
  throw new Error("This official form is not ready yet");
}
