"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {currentWriter} from "@/src/lib/member";
import {canManageClients} from "@/src/lib/clients";
import {grantFor} from "@/src/lib/permission-grants";
import {keepReason} from "@/src/lib/reason";
import {checkAllTds,enterTds,readTdsRegister,sealDeductor} from "@/src/lib/tds-draft";
import {deductorSchema,isTdsForm,quarterOf,tdsFields,tdsMappingSchema} from "@/src/lib/tds";
import {clientBack} from "../../return-back";

// The TAN's statement details, on the client's Details: the owner, a partner or a manager, as
// for its numbers. Row level security keeps the change to the person's own firm.
export async function saveTdsDetails(form:FormData) {
  const {supabase,membership}=await currentWriter();
  const client=z.uuid().parse(form.get("client")),tan=z.uuid().parse(form.get("tan")),back=`/app/clients/${client}?tab=tds&tan=${tan}`;
  if(!membership || !canManageClients(membership.role)) redirect(`${back}&error=role`);
  const get=(name:string)=>String(form.get(name) ?? "");
  const address=(at:string)=>({flat:get(`${at}flat`),post:get(`${at}post`),road:get(`${at}road`),area:get(`${at}area`),district:get(`${at}district`),state:get(`${at}state`),pin:get(`${at}pin`).trim(),country:get(`${at}country`),email:get(`${at}email`).trim(),code:get(`${at}code`).trim(),phone:get(`${at}phone`).replace(/[\s-]/g,"")});
  const parsed=deductorSchema.safeParse({name:get("name"),type:get("type"),...address("d_"),govt_state:get("govt_state"),ministry:get("ministry"),ministry_other:get("ministry_other"),person:{name:get("p_name"),designation:get("p_designation"),...address("p_"),pan:get("p_pan").trim().toUpperCase()}});
  if(!parsed.success) redirect(`${back}&error=tds`);
  const {data:row}=await supabase.from("client_registrations").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",tan).eq("kind","tan").maybeSingle();
  if(!row) redirect(`${back}&error=role`);
  const {data:saved,error}=await supabase.from("client_registrations").update({details_enc:await sealDeductor(membership.firmId,client,tan,parsed.data)}).eq("firm_id",membership.firmId).eq("id",tan).select("id").maybeSingle();
  if(error || !saved) redirect(`${back}&error=role`);
  revalidatePath("/app","layout");redirect(`/app/clients/${client}?changed=tds`);
}

// The statement page's steps (app/(app)/app/clients/[id]/tds/tds-statement.tsx), each going back
// to it: the return's own page at its Draft step when sent from there.
async function writer(form:FormData) {
  const {supabase,membership,userId}=await currentWriter();
  const client=z.uuid().parse(form.get("client")),tan=z.uuid().parse(form.get("tan")),period=String(form.get("period")),code=String(form.get("form") ?? "TDS140");
  quarterOf(period);
  if(!isTdsForm(code)) throw new Error("Choose the statement.");
  const page=await clientBack(client),back=`${page===`/app/clients/${client}` ? `${page}/tds?` : `${page}?step=draft&`}tan=${tan}&period=${period}&form=${code}`;
  if(!membership) redirect("/app");
  const {data:number}=await supabase.from("client_registrations").select("id").eq("firm_id",membership.firmId).eq("client_id",client).eq("id",tan).eq("kind","tan").maybeSingle();
  if(!number) redirect(back);
  return {supabase,membership,userId,client,tan,period,form:code,back};
}
const editor=async(work:Awaited<ReturnType<typeof writer>>)=>{
  const permission=work.membership.may("edit_figures",work.client) ? null : await grantFor(work.membership.firmId,work.userId,"edit_figures",work.client);
  if(!work.membership.may("edit_figures",work.client) && !permission) redirect(`${work.back}&message=permission`);
  return permission;
};

export async function readTds(form:FormData) {
  const work=await writer(form),permission=await editor(work),source=z.uuid().parse(form.get("source"));
  const {data:doc}=await work.supabase.from("documents").select("id,firm_id,client_id,name,sha256").eq("firm_id",work.membership.firmId).eq("client_id",work.client).eq("id",source).eq("status","filed").is("prepared",null).maybeSingle();
  if(!doc) redirect(`${work.back}&message=check`);
  try {
    const kind=tdsMappingSchema.shape.kind.parse(form.get("kind")),header=z.coerce.number().int().min(1).max(40).parse(form.get("header"))-1;
    const mapping=tdsMappingSchema.parse({kind,header,headings:["read"],columns:tdsFields[kind].map((_,index)=>Number(form.get(`column${index}`) ?? -1))});
    await readTdsRegister(doc,{form:work.form,period:work.period,registration:work.tan,mapping},work.userId,permission);
  } catch(error) {await keepReason(error);redirect(`${work.back}&source=${source}&kind=${String(form.get("kind"))}&message=check`);}
  revalidatePath("/app","layout");redirect(`${work.back}&message=read`);
}

export async function enterTdsFigures(form:FormData) {
  const work=await writer(form),permission=await editor(work);
  try {await enterTds(work.supabase,{firm:work.membership.firmId,userId:work.userId,permission},work.client,work.tan,work.period,work.form,form);}
  catch(error) {await keepReason(error);redirect(`${work.back}&message=check`);}
  revalidatePath("/app","layout");redirect(`${work.back}&message=entered`);
}

export async function checkTds(form:FormData) {
  const work=await writer(form);
  if(!work.membership.may("check_figures",work.client)) redirect(`${work.back}&message=permission`);
  const revisions=new Map(form.getAll("draft").map(String).map(value=>value.split(":")).map(([id,revision])=>[z.uuid().parse(id),Number(revision)]));
  let done:{checked:number;flagged:number};
  try {done=await checkAllTds(work.supabase,work.membership.firmId,work.userId,work.client,work.tan,work.period,work.form,revisions);}
  catch(error) {await keepReason(error);redirect(`${work.back}&message=check`);}
  revalidatePath("/app","layout");redirect(`${work.back}&message=${done.flagged ? "flagged" : "checked"}`);
}
