import {serverCrypto} from "@/src/lib/crypto";
import {checkFigures,draftSchema,hundredths,openFigures,place as linePlace,type Draft,type Figure} from "@/src/lib/datasets";
import {periodName} from "@/src/lib/documents";
import {formLayout,grouped,type FormLayout} from "@/src/lib/form-layout";
import {itrYear} from "@/src/lib/itr-fields";
import {when} from "@/src/lib/paper-origin";
import {matchPlace,matchSchema,totalOf} from "@/src/lib/purchase-register";
import {supabaseAdmin} from "@/src/lib/supabase";
import type {supabaseServer} from "@/src/lib/supabase";
import type {CheckItem,CheckPaper} from "./form-check";

// A change from the last checked period worth a second look: over 40% and over ₹10,000.
const BIG_CHANGE={share:0.4,rupees:10_000};
const paise=(figure:Figure)=>(!figure.kind || figure.kind==="number") && /\.\d*[1-9]/.test(figure.value);
const rupees=(amount:bigint,decimals=2)=>grouped(`${amount<BigInt(0) ? "-" : ""}${(amount<BigInt(0) ? -amount : amount)/BigInt(100)}.${String((amount<BigInt(0) ? -amount : amount)%BigInt(100)).padStart(2,"0")}`,undefined,decimals);
type Paper={id:string;name:string;document_type:string|null;period_key:string|null};
type Row={id:string;client_id:string;form_code:string;period_key:string};

// Check on the form: the figures laid out as their return, with what InboxCA already knows about
// each (how it was read, the client's books, the last checked period, totals) and each paper's
// own GSTIN or PAN and period. Nothing here is stored; it is read again with the page.
export async function formCheckData({supabase,firm,userId,row,draft,figures,papers,who,issues,sourceReady,lineId}:{supabase:Awaited<ReturnType<typeof supabaseServer>>;firm:string;userId:string;row:Row;draft:Draft;figures:Map<string,Figure>;papers:Paper[];who:(id?:string)=>string;issues:string[];sourceReady:boolean;lineId?:string}) {
  const crypto=serverCrypto(),admin=supabaseAdmin();
  const [{data:client},{data:registrations},{data:changes},{data:earlier},{data:matches}]=await Promise.all([
    supabase.from("clients").select("name").eq("firm_id",firm).eq("id",row.client_id).single(),
    supabase.from("client_registrations").select("id,kind,number_enc").eq("firm_id",firm).eq("client_id",row.client_id),
    admin.from("activity_log").select("details").eq("firm_id",firm).eq("entity_type","client").eq("entity_id",row.client_id).eq("action","dataset.changed").eq("details->>dataset",row.id).limit(1000),
    supabase.from("datasets").select("id,period_key,data").eq("firm_id",firm).eq("client_id",row.client_id).eq("form_code",row.form_code).lt("period_key",row.period_key).order("period_key",{ascending:false}).limit(1),
    papers.some((paper)=>paper.document_type==="GSTR-2B") ? supabase.from("gst_matches").select("register_id,statement_id,result_enc").eq("firm_id",firm).in("statement_id",papers.filter((paper)=>paper.document_type==="GSTR-2B").map((paper)=>paper.id)) : Promise.resolve({data:[]}),
  ]);
  const numbers=new Map(await Promise.all((registrations ?? []).map(async(one)=>[one.id,{kind:one.kind,number:await crypto.decrypt(firm,`clients/${row.client_id}/${one.kind}`,one.number_enc)}] as const)));
  const keyOf=(field:string)=>/^gstr2[ab]\.([0-9a-f]{32})\./.exec(field)?.[1],idOf=(key:string)=>[...numbers.keys()].find((id)=>id.replaceAll("-","")===key);
  const names=Object.fromEntries([...new Set(draft.lines.flatMap((line)=>keyOf(line.field) ?? []))].map((key)=>[key,`GSTIN ${numbers.get(idOf(key) ?? "")?.number ?? ""}`.trim()]));
  const layout:FormLayout=formLayout(row.form_code,draft.lines.map((line)=>({id:line.id,field:line.field,label:figures.get(line.id)!.label})),{target:draft.target?.form,names});
  // Where the return puts each figure: "4(A)(5) All other ITC, Integrated Tax".
  const place=new Map<string,string>(),decimals=new Map<string,number>();
  for(const table of layout.tables) {
    let heading="";
    const columns=table.heads.map((_,index)=>table.rows.some((one)=>one.fill==="figures" && one.cells[index]?.ids?.some((id)=>paise(figures.get(id)!))) ? 2 : 0);
    for(const one of table.rows) {
      if(one.fill==="heading") {heading=one.number ?? "";continue;}
      if(one.fill==="worked") {
        one.cells=one.cells.map((cell,index)=>({text:rupees((cell?.ids ?? []).reduce((sum,id)=>sum+hundredths(figures.get(id)!.value),BigInt(0)),columns[index])}));
        continue;
      }
      if(one.fill!=="figures") continue;
      one.cells.forEach((cell,index)=>cell?.ids?.forEach((id)=>{
        decimals.set(id,columns[index] ?? 2);
        const head=table.heads.length>1 ? `, ${table.heads[index]}` : "",part=cell.ids!.length>1 ? `, ${figures.get(id)!.label.split(", ").at(-1)}` : "";
        place.set(id,table.key==="other" ? figures.get(id)!.label : table.number ? `${table.number}${heading}${one.number ?? ""} ${one.name}${head}${part}` : `${table.name}, ${one.name}${head}${part}`);
      }));
    }
  }
  const corrected=new Set((changes ?? []).flatMap((entry)=>{const details=entry.details as {line?:string;state?:string};return details.state==="edit" && details.line ? [details.line] : [];}));
  // The same figure in the last period's checked figures (rows of a register are not the same rows a month later).
  const last=earlier?.[0],lastDraft=last ? draftSchema.parse(last.data) : null,lastFigures=last && lastDraft ? await openFigures(firm,last.id,lastDraft).catch(()=>null) : null;
  const before=new Map(lastDraft && lastFigures ? lastDraft.lines.filter((line)=>line.state==="confirmed" && !/\.[rt]\d+\.c\d+$|^f26as\./.test(line.field)).map((line)=>[line.field,lastFigures.get(line.id)!.value]) : []);
  const lastName=last ? row.form_code==="ITR" ? itrYear(last.period_key) : periodName(last.period_key) : "";
  // The client's purchase books against this GSTR-2B's credit: the match with its register (gst-match).
  const books=new Map<string,ReturnType<typeof totalOf>>();
  for(const match of matches ?? []) {
    const result=matchSchema.parse(JSON.parse(await crypto.decrypt(firm,matchPlace(match.register_id),match.result_enc)));
    books.set(match.statement_id,totalOf([...result.matched,...result.missing,...result.extra,...result.differ,...result.changed],"books"));
  }
  const totals=new Map(draft.checks.map((check)=>[check.total,checkFigures({...draft,checks:[check]},figures).length===0]));
  // The chosen figure: the one asked for, else the first still to check in the form's order. A
  // very long set shows 400 figures at a time, around it.
  const order=layout.tables.flatMap((table)=>table.rows.filter((one)=>one.fill==="figures").flatMap((one)=>one.cells.flatMap((cell)=>cell?.ids ?? []))).filter((id,at,all)=>all.indexOf(id)===at);
  const active=order.find((id)=>id===lineId) ?? order.find((id)=>draft.lines.find((line)=>line.id===id)!.state!=="confirmed") ?? order[0];
  const start=Math.floor(Math.max(0,order.indexOf(active))/400)*400,shown=new Set(order.slice(start,start+400));
  if(order.length>400) layout.tables=layout.tables.map((table)=>({...table,rows:table.rows.filter((one)=>one.fill==="figures" ? one.cells.some((cell)=>cell?.ids?.some((id)=>shown.has(id))) : start===0)})).filter((table)=>table.rows.length);
  const items:CheckItem[]=draft.lines.filter((line)=>order.length<=400 || shown.has(line.id)).flatMap((line)=>{
    const figure=figures.get(line.id)!,paper=papers.find((one)=>one.id===line.source.document),chips:CheckItem["chips"]=[],looks:string[]=[];
    const reader=line.source.reader ?? "";
    if(line.source.entered_by) chips.push({text:"Typed by your team",tone:"info"});
    else if(/^(gstr2|form26as)/.test(reader)) chips.push({text:`Exact from the ${reader.startsWith("gstr2b") ? "GSTR-2B" : reader.startsWith("gstr2a") ? "GSTR-2A" : "Form 26AS text"} file`,tone:"ok"});
    else if(/^form(16|130)/.test(reader)) chips.push({text:"Read from the PDF's printed text",tone:"info"});
    else if(line.source.cell) chips.push({text:`Exact from cell ${line.source.cell}`,tone:"ok"});
    else if(line.source.path) chips.push({text:"Exact from the return file",tone:"ok"});
    const head=/\.itcavl\.nonrevsup\.(igst|cgst|sgst|cess)$/.exec(line.field)?.[1] as "igst"|"cgst"|"sgst"|"cess"|undefined,book=head && paper && books.get(paper.id);
    if(book && head) {
      const gap=hundredths(figure.value)-BigInt(book[head]);
      if(gap>=BigInt(-100) && gap<=BigInt(100)) chips.push({text:"Matches books",tone:"ok"});
      else {const words=`₹${rupees(gap<BigInt(0) ? -gap : gap)} ${gap>BigInt(0) ? "more" : "less"} than books`;chips.push({text:words,tone:"look"});looks.push(words);}
    }
    const old=before.get(line.field);
    if(old!==undefined) {
      if((!figure.kind || figure.kind==="number") && /^-?\d/.test(old)) {
        const now=hundredths(figure.value),then=hundredths(old),gap=now-then,size=gap<BigInt(0) ? -gap : gap,share=then===BigInt(0) ? null : Number(size)/Math.abs(Number(then));
        chips.push({text:`${lastName}: ${grouped(old,undefined,decimals.get(line.id))}${gap===BigInt(0) ? ", the same" : share===null ? "" : `, ${gap>BigInt(0) ? "up" : "down"} ${Math.round(share*100)}%`}`,tone:"info"});
        if(size>BigInt(BIG_CHANGE.rupees*100) && (share===null || share>BIG_CHANGE.share)) looks.push(`Big change from ${lastName}`);
      } else if(old!==figure.value) chips.push({text:`Changed since ${lastName}`,tone:"info"});
    }
    if(totals.has(line.id)) {
      if(totals.get(line.id)) chips.push({text:"Adds up",tone:"ok"});
      else {chips.push({text:"The parts do not add up",tone:"look"});looks.push("The parts do not add up");}
    }
    if(line.state==="rejected") looks.push("Marked wrong");
    if(line.source.document && !paper) looks.push("Its paper is not available");
    const blocked=!sourceReady ? "A paper these figures came from was changed or removed. Ask the owner to restore it, or read the paper again." : !paper && !line.source.entered_by ? "The paper these figures came from is not available. Ask the owner to restore it." : issues.length ? "Correct the figures listed above before you mark any as right." : undefined;
    return [{id:line.id,place:place.get(line.id) ?? figure.label,shown:grouped(figure.value,figure.kind,decimals.get(line.id)),value:figure.value,...(figure.kind && {kind:figure.kind}),state:line.state,corrected:corrected.has(line.id),
      ...(line.state==="confirmed" && line.by && {checked:`${who(line.by)}, ${when(line.at!)}`,short:`${who(line.by)}, ${when(line.at!)}`}),
      ...(line.source.entered_by && {entered:`Entered by ${who(line.source.entered_by)}, ${when(line.source.entered_at!)}`}),
      ...(paper && {paper:paper.id,page:line.source.page,sheet:line.source.sheet}),where:line.source.cell ? `Sheet ${line.source.sheet}, cell ${line.source.cell}` : line.source.page ? `Page ${line.source.page}` : "",
      chips,...(looks.length && {look:looks.join(". ")}),...(blocked && {blocked})}];
  });
  // Each paper's own GSTIN or PAN and period, which InboxCA matched to this client when it read a
  // portal file (portal-draft.ts refuses one for another client or month).
  const about=(paper:Paper)=>{
    const lines=draft.lines.filter((line)=>line.source.document===paper.id),portal=lines.some((line)=>line.source.reader),key=lines.map((line)=>keyOf(line.field)).find(Boolean);
    const number=key ? numbers.get(idOf(key) ?? "") : row.form_code==="ITR" ? [...numbers.values()].find((one)=>one.kind==="pan") : draft.registration ? numbers.get(draft.registration) : undefined;
    const period=paper.period_key ? row.form_code==="ITR" ? itrYear(paper.period_key) : periodName(paper.period_key) : "";
    const same=!paper.period_key || paper.period_key===row.period_key;
    return {text:`This ${paper.document_type ?? "paper"} is for ${client?.name ?? "this client"}${number ? `, ${number.kind==="pan" ? "PAN" : "GSTIN"} ${number.number}` : ""}${period ? `, ${period}` : ""}${same ? "" : `, not ${row.form_code==="ITR" ? itrYear(row.period_key) : periodName(row.period_key)}`}`,...(portal || !same ? {ok:portal && same} : {})};
  };
  const checkPapers:CheckPaper[]=papers.map((paper)=>({id:paper.id,name:paper.name,about:about(paper)}));
  const kept:Record<string,{value:string;reason:string}>={};
  for(const [line,edit] of Object.entries(draft.edits?.[userId] ?? {})) {
    const at=draft.lines.find((one)=>one.id===line);
    if(at && edit.base===at.value_enc) kept[line]=JSON.parse(await crypto.decrypt(firm,`${linePlace(row.id,line)}/edit/${userId}`,edit.value_enc));
  }
  return {layout,items,papers:checkPapers,kept,active,pager:{previous:start>0 ? order[start-400] : undefined,next:order[start+400]}};
}
