"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {fileForm,prepareDocument,recordFormDecision,uploadEditedForm,visibleForm} from "@/src/lib/prepared";
import {runJobsSoon} from "@/src/jobs/run-soon";

export async function prepareForm(form:FormData) {
  const client=z.uuid().parse(form.get("client")),back=`/app/clients/${client}?tab=outputs`;
  let id:string;
  try {
    id=await prepareDocument({client,registration:String(form.get("registration")),form:z.enum(["GSTR1","ITR1","ITR4"]).parse(form.get("form") ?? "GSTR1"),period:String(form.get("period")),drafts:form.getAll("draft").map(String),version:String(form.get("version") ?? "") || undefined,reason:String(form.get("reason") ?? "") || undefined});
  } catch {redirect(`${back}&form=check`);}
  revalidatePath("/app","layout");redirect(`/app/files/${id}/view`);
}

export async function decideForm(form:FormData) {
  const id=z.uuid().parse(form.get("document")),{document}=await visibleForm(id),back=`/app/clients/${document.client_id}?tab=outputs`;
  const decision=z.enum(["approved","rejected"]).parse(form.get("decision"));
  try {await recordFormDecision(id,decision,String(form.get("reason") ?? ""),String(form.get("explanation") ?? ""));}
  catch {redirect(`${back}&form=approval`);}
  revalidatePath("/app","layout");redirect(back);
}

export async function markFormFiled(form:FormData) {
  const id=z.uuid().parse(form.get("document")),{document}=await visibleForm(id),back=`/app/clients/${document.client_id}?tab=outputs`;
  const upload=form.get("ack_file");
  try {await fileForm(id,String(form.get("ack") ?? ""),String(form.get("paper") ?? "") || undefined,upload instanceof File ? upload : undefined);}
  catch {redirect(`${back}&form=ack`);}
  runJobsSoon();
  revalidatePath("/app","layout");redirect(back);
}

export async function addEditedForm(form:FormData) {
  const id=z.uuid().parse(form.get("document")),{document}=await visibleForm(id),back=`/app/clients/${document.client_id}?tab=outputs`;
  const file=form.get("edited_file");let draft:string;
  try {if(!(file instanceof File)) throw new Error("Choose the file.");draft=(await uploadEditedForm(id,file)).draft;}
  catch {redirect(`${back}&form=edited`);}
  revalidatePath("/app","layout");redirect(`/app/clients/${document.client_id}?tab=extraction&draft=${draft}`);
}
