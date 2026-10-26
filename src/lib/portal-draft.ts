import {randomUUID} from "node:crypto";
import {z} from "zod";
import {serverCrypto} from "./crypto";
import {createDraft,draftSchema,place,saveDraft,type Draft} from "./datasets";
import {supabaseAdmin} from "./supabase";
import {workerRead} from "./worker-read";

const tax=z.object({kind:z.enum(["Form 26AS","Form 16","Form 130"]),version:z.enum(["text","traces","rules-2026"]),pan:z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/),period:z.string().regex(/^20\d{2}$/),lines:z.array(z.object({field:z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/),label:z.string().min(1).max(120),value:z.string().min(1).max(2000),kind:z.enum(["number","text","date"]),path:z.string().max(256).optional(),page:z.number().int().min(1).max(30)})).min(1).max(10000)});
const result=z.object({read:z.union([z.object({kind:z.enum(["GSTR-2B","GSTR-2A"]),version:z.enum(["v4.5","v4.4","v2.3"]),gstin:z.string().length(15),period:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),lines:z.array(z.object({field:z.string().regex(/^[a-z][a-z0-9_.]{0,99}$/),label:z.string().max(120),value:z.string().regex(/^-?\d{1,13}(\.\d{1,2})?$/),path:z.string().max(256),page:z.number().int().min(1).max(30)})).min(1).max(10000)}),tax]).nullable()});

// Called after the person's document check, or by that firm's document job.
export async function readPortalDraft(document:{id:string;firm_id:string;client_id:string;name:string;sha256:string;period_key:string;document_type:string}) {
  // A locked Form 16 is read with the password a person typed for it, never a guessed one.
  const {data:locked}=/\.pdf$/i.test(document.name) ? await supabaseAdmin().from("documents").select("password_enc").eq("firm_id",document.firm_id).eq("id",document.id).single() : {data:null};
  const password=locked?.password_enc ? await serverCrypto().decrypt(document.firm_id,`documents/${document.id}/password`,locked.password_enc) : undefined;
  const {read}=result.parse(await workerRead(document.firm_id,document,"portal",undefined,password));
  if(!read || read.kind!==document.document_type) return null;
  if("pan" in read) return readTaxDraft(document,read);
  if(read.period!==document.period_key) throw new Error("The file's month does not match this work.");
  const admin=supabaseAdmin(),crypto=serverCrypto();
  const {data:registration}=await admin.from("client_registrations").select("id").eq("firm_id",document.firm_id).eq("client_id",document.client_id).eq("kind","gstin").eq("number_bidx",await crypto.blindIndex(document.firm_id,"gstin",read.gstin)).maybeSingle();
  if(!registration) throw new Error("This statement belongs to a different client.");
  // GSTR-2B credit joins the month's GSTR-3B draft. GSTR-2A is for information only, so it
  // keeps a draft of its own and never feeds GSTR-3B.
  const prefix=read.kind==="GSTR-2B" ? "gstr2b" : "gstr2a",form=read.kind==="GSTR-2B" ? "GSTR3B" : "GSTR2A";
  const field=(key:string)=>key.replace(`${prefix}.`,`${prefix}.${registration.id.replaceAll("-","")}.`);
  for(let attempt=0;attempt<3;attempt++) {
    const {data:previous,error}=await admin.from("datasets").select("*").eq("firm_id",document.firm_id).eq("client_id",document.client_id).eq("form_code",form).eq("period_key",read.period).maybeSingle();
    if(error) throw new Error("The draft could not be opened.");
    const id=previous?.id ?? randomUUID(),data:Draft=previous ? draftSchema.parse(previous.data) : {lines:[],checks:[]};
    if(data.lines.some((line)=>line.source.document===document.id)) return id;
    // A later statement never silently replaces a figure that someone checked.
    if(read.lines.some((line)=>data.lines.some((old)=>old.field===field(line.field)))) return null;
    for(const line of read.lines) {
      const lineId=randomUUID();
      data.lines.push({id:lineId,field:field(line.field),value_enc:await crypto.encrypt(document.firm_id,place(id,lineId),JSON.stringify({label:line.label,value:line.value})),state:"pending",source:{document:document.id,sha256:document.sha256,page:line.page,path:line.path,reader:`${prefix}-${read.version}`}});
    }
    if(await saveDraft({id,firm_id:document.firm_id,client_id:document.client_id,form_code:form,period_key:read.period,revision:previous?.revision ?? 0},data,null,"dataset.changed",{})) return id;
  }
  throw new Error("The draft changed. Open it again.");
}

// An income tax paper gets a draft of its own among the client's figures for the year, keyed
// by the paper, so reading it again changes nothing. Its PAN and year must be this work's; a
// paper filed under another client or year is left unread. Form 16 takes the next free row
// of TDS on salary, so two employers' certificates never fill the same row.
async function readTaxDraft(document:{id:string;firm_id:string;client_id:string;sha256:string;period_key:string},read:z.infer<typeof tax>) {
  if(read.period!==document.period_key) return null;
  const admin=supabaseAdmin();
  const [{data:registration},{data:drafts,error}]=await Promise.all([
    admin.from("client_registrations").select("id").eq("firm_id",document.firm_id).eq("client_id",document.client_id).eq("kind","pan").eq("number_bidx",await serverCrypto().blindIndex(document.firm_id,"pan",read.pan)).maybeSingle(),
    admin.from("datasets").select("id,data").eq("firm_id",document.firm_id).eq("client_id",document.client_id).eq("form_code","ITR").eq("period_key",read.period).limit(100),
  ]);
  if(error) throw new Error("The draft could not be opened.");
  if(!registration) return null;
  if(drafts?.some((row)=>row.id===document.id)) return document.id;
  const used=new Set(drafts?.flatMap((row)=>draftSchema.parse(row.data).lines.map((line)=>/^itr\.tds\.salary\.(\d+)\./.exec(line.field)?.[1])));
  let row=0;while(used.has(String(row))) row++;
  const reader=`${read.kind==="Form 26AS" ? "form26as" : read.kind==="Form 16" ? "form16" : "form130"}-${read.version}`;
  const lines=read.lines.map((line)=>({id:randomUUID(),field:line.field.replace(/^itr\.tds\.salary\.0\./,`itr.tds.salary.${row}.`),label:line.label,value:line.value,kind:line.kind,source:{document:document.id,sha256:document.sha256,page:line.page,...(line.path && {path:line.path}),reader}}));
  return await createDraft({id:document.id,firm_id:document.firm_id,client_id:document.client_id,form_code:"ITR",period_key:read.period,lines,checks:[]},null) ? document.id : null;
}
