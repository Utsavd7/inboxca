import {z} from "zod";
import {validSignature} from "./file-worker.ts";
import {templateSchema} from "./templates.ts";

export const formLimit=3_000_000;
export const formRequest=z.object({
  purpose:z.enum(["prepare","fields","check"]),firm:z.uuid(),client:z.uuid(),registration:z.uuid(),gstin:z.string().length(15).optional(),pan:z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
  period:z.string().regex(/^20\d{2}(-(0[1-9]|1[0-2]))?$/),expires:z.number().int(),template:templateSchema,
  drafts:z.array(z.object({id:z.uuid(),revision:z.number().int().positive(),figures:z.array(z.tuple([z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/),z.object({label:z.string().min(1).max(120),value:z.string().max(2000),kind:z.enum(["number","date","text"]).optional()})])).min(1).max(10000)})).max(25),
}).refine(r=>/^ITR[1-6]$/.test(r.template.form_code) ? !!r.pan && !r.gstin && r.period.length===4 && (r.purpose==="fields" ? !r.drafts.length : r.purpose==="check" || !!r.drafts.length) : r.purpose==="prepare" && !!r.gstin && !r.pan && r.period.length===7 && !!r.drafts.length);

export const itrEntrySchema=z.object({field:z.string().max(100),path:z.string().max(500),group:z.string().max(120),label:z.string().max(120),kind:z.enum(["number","text","date"]),primitive:z.enum(["integer","number","string","boolean"]),choices:z.array(z.string()).optional(),defaultValue:z.string().optional(),rows:z.number().int().min(0).max(5),required:z.boolean(),latest:z.iso.date().optional(),earliest:z.iso.date().optional()});
export type ItrEntry=z.infer<typeof itrEntrySchema>;
// What a return still needs, and plain words for each failed check.
export const itrReviewSchema=z.object({missing:z.array(z.object({label:z.string().max(200),group:z.string().max(200),field:z.string().max(100).optional()})).max(2000),issues:z.array(z.string().max(400)).max(100)});
export type ItrReview=z.infer<typeof itrReviewSchema>;
export type FormRequest=z.infer<typeof formRequest>;
export async function verifyForm(body:string,signature:string,secret:string,form:string,now=Date.now()/1000) {
  if(body.length>formLimit || !await validSignature(body,signature,secret)) throw new Error("Not allowed");
  const request=formRequest.parse(JSON.parse(body));
  if(request.template.form_code!==form || request.expires<=now || request.expires>now+75 || request.drafts.reduce((n,draft)=>n+draft.figures.length,0)>10000 || new Set(request.drafts.map(draft=>draft.id)).size!==request.drafts.length || request.drafts.some(draft=>new Set(draft.figures.map(([field])=>field)).size!==draft.figures.length)) throw new Error("Not allowed");
  return request;
}
