import {z} from "zod";
import {validSignature} from "./file-worker.ts";
import {templateSchema} from "./templates.ts";

export const formLimit=3_000_000;
export const formRequest=z.object({
  purpose:z.literal("prepare"),firm:z.uuid(),client:z.uuid(),registration:z.uuid(),gstin:z.string().length(15),
  period:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),expires:z.number().int(),template:templateSchema,
  drafts:z.array(z.object({id:z.uuid(),revision:z.number().int().positive(),figures:z.array(z.tuple([z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/),z.object({label:z.string().min(1).max(120),value:z.string().max(2000),kind:z.enum(["number","date","text"]).optional()})])).min(1).max(10000)})).min(1).max(25),
});
export type FormRequest=z.infer<typeof formRequest>;
export async function verifyForm(body:string,signature:string,secret:string,form:string,now=Date.now()/1000) {
  if(body.length>formLimit || !await validSignature(body,signature,secret)) throw new Error("Not allowed");
  const request=formRequest.parse(JSON.parse(body));
  if(request.template.form_code!==form || request.expires<=now || request.expires>now+75 || request.drafts.reduce((n,draft)=>n+draft.figures.length,0)>10000 || new Set(request.drafts.map(draft=>draft.id)).size!==request.drafts.length || request.drafts.some(draft=>new Set(draft.figures.map(([field])=>field)).size!==draft.figures.length)) throw new Error("Not allowed");
  return request;
}
