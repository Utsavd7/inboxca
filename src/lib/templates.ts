import {z} from "zod";

export const templateSchema=z.object({
  form_code:z.string().regex(/^[A-Z0-9_]{2,30}$/),version:z.string().regex(/^\d+(\.\d+){0,3}$/),
  valid_from:z.iso.date().nullable(),valid_until:z.iso.date().nullable(),status:z.enum(["draft","active","retired"]),
  source:z.object({file:z.string().regex(/^[A-Za-z0-9_./-]+$/),url:z.url(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}),
  mappings:z.object({format:z.enum(["xlsx","json"]),sheets:z.record(z.string(),z.number().int().min(1).max(100)).optional(),validator:z.object({file:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),fields:z.record(z.string(),z.string()).optional()}),
});
export type Template=z.infer<typeof templateSchema>;
const version=(a:string,b:string)=>{const left=a.split(".").map(Number),right=b.split(".").map(Number);for(let i=0;i<Math.max(left.length,right.length);i++) {const diff=(right[i] ?? 0)-(left[i] ?? 0);if(diff) return diff;}return 0;};

// A retired form still works for its own period. Today's date never chooses a form.
export function chooseTemplate(templates:Template[],form:string,period:string,asked?:string,reason?:string) {
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Choose the work's month.");
  const day=`${period}-01`,choices=templates.map((item)=>templateSchema.parse(item)).filter((item)=>item.form_code===form && item.status!=="draft" && item.valid_from && item.valid_from<=day && (!item.valid_until || day<item.valid_until)).sort((a,b)=>version(a.version,b.version));
  const usual=choices.find((item)=>item.status==="active") ?? choices[0];
  const selected=asked ? choices.find((item)=>item.version===asked) : usual;
  if(!selected) throw new Error("The official form for this month is not ready yet.");
  if(asked && selected.version!==usual?.version && !reason?.trim()) throw new Error("Say why you need the older form.");
  return selected;
}
