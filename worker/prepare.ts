import type {FormRequest} from "../src/lib/form-worker.ts";
import {chooseTemplate} from "../src/lib/templates.ts";
import {gstr1Json,gstr1Workbook} from "./gstr1.ts";
import {zipFiles} from "./zip.ts";
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
  // The portal JSON is asked for with the workbook's own template as format json; a month that
  // needs more than one upload file gets them in one ZIP.
  if(template.form_code==="GSTR1") {
    const files=gstr1Json(template,period,gstin!,request.drafts.map(draft=>new Map(draft.figures)));
    return files.length===1 ? {bytes:files[0],extension:"json",type:"application/json"} : {bytes:zipFiles(files.map((bytes,n)=>[`GSTR-1 file ${n+1} of ${files.length}.json`,bytes])),extension:"zip",type:"application/zip"};
  }
  if(template.form_code==="GSTR3B" && template.mappings.format==="json") return {bytes:gstr3bJson(template,period,gstin!,request.registration,request.drafts.map(draft=>new Map(draft.figures))),extension:"json",type:"application/json"};
  throw new Error("This official form is not ready yet");
}
