import {xlsxEntries} from "../src/lib/sheet.ts";
import {chooseTemplate,type Template} from "../src/lib/templates.ts";
import {numericHeadings,salesSections,type SalesSection} from "../src/lib/gstr1-fields.ts";
import type {Figure} from "../src/lib/datasets.ts";
import {gstr1Workbook} from "./gstr1.ts";
import {officialFile} from "./official.ts";

const decode=(text:string)=>text.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-f]+);/gi,(_,code:string)=>code[0]==="#" ? String.fromCodePoint(parseInt(code.slice(code[1]==="x" ? 2 : 1),code[1]==="x" ? 16 : 10)) : ({lt:"<",gt:">",amp:"&",quot:'"',apos:"'"} as Record<string,string>)[code]);
const text=(xml:string)=>[...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([,value])=>decode(value)).join("");
function cells(bytes:Buffer) {
  const entries=xlsxEntries(bytes),sheets=new Map<string,Map<string,{value:string;formula:string}>>();
  const shared=[...(entries.get("xl/sharedStrings.xml")?.().toString() ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([,value])=>text(value));
  let size=0;
  for(const [path,read] of entries) if(/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) {
    const xml=read();size+=xml.length;if(size>100_000_000) throw new Error("Workbook too large");
    const sheet=new Map<string,{value:string;formula:string}>();
    for(const [,attrs,body=""] of xml.toString().matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref=/r="([A-Z]+\d+)"/.exec(attrs)?.[1],type=/t="(\w+)"/.exec(attrs)?.[1],raw=/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      if(!ref) throw new Error("Missing cell address");
      const value=type==="s" ? shared[Number(raw)] : type==="inlineStr" ? text(body) : decode(raw),formula=/<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? "";
      if(value===undefined || value.length>100000) throw new Error("Invalid cell");
      if(value || formula) sheet.set(ref,{value,formula});
    }
    sheets.set(path,sheet);
  }
  return sheets;
}

// Read the pinned workbook's cells, then use its normal generator for the official checks.
export function editedForm(bytes:Buffer,context:{template:Template;period:string;gstin:string}) {
  const {template,period,gstin}=context;
  chooseTemplate([template],"GSTR1",period);
  if(template.form_code!=="GSTR1" || template.mappings.format!=="xlsx" || !/^gstr1-v[\d.]+\/GSTR1_Excel_Workbook_Template_V[\d.]+\.xlsx$/.test(template.source.file)) throw new Error("Unsupported form");
  const original=officialFile(template.source.file,template.source.sha256);
  if(/date1904="(?:1|true)"/.test(xlsxEntries(bytes).get("xl/workbook.xml")!().toString())) throw new Error("Keep the official workbook date setting");
  const parts=xlsxEntries(bytes),known=xlsxEntries(original);
  const external=(xml:string)=>[...xml.matchAll(/<Relationship\b[^>]*>/g)].filter(([tag])=>/TargetMode="External"|(?:vbaProject|oleObject|externalLink)"/.test(tag)).map(([tag])=>[...tag.matchAll(/(Type|Target|TargetMode)="([^"]*)"/g)].map(([,key,value])=>`${key}=${decode(value)}`).sort().join("|")).sort().join("\n");
  for(const [path,read] of parts) {
    if(!known.has(path) && path!=="xl/calcChain.xml" || /vbaProject|\/embeddings\/|\/externalLinks\//i.test(path) && (!known.has(path) || !read().equals(known.get(path)!()))) throw new Error("Keep the official workbook's parts");
    if(path.endsWith(".rels") && external(read().toString())!==external(known.get(path)?.().toString() ?? "")) throw new Error("The workbook's outside links changed");
  }
  const input=cells(bytes),blank=cells(original),lines:({field:string;page:number;sheet:number;cell:string}&Figure)[]=[],figures=new Map<string,Figure>();
  if(input.size!==blank.size) throw new Error("The workbook's sheets changed");
  for(const [path,expected] of blank) {
    const actual=input.get(path);if(!actual) throw new Error("Missing sheet");
    const number=Number(/sheet(\d+)\.xml$/.exec(path)![1]),section=Object.entries(template.mappings.sheets ?? {}).find(([,sheet])=>sheet===number)?.[0] as SalesSection|undefined;
    for(const ref of new Set([...actual.keys(),...expected.keys()])) {
      const row=Number(ref.replace(/^[A-Z]+/,"")),col=ref.replace(/\d+$/,"");
      const value=actual.get(ref),old=expected.get(ref);
      if(!section || row<5) {
        if((value?.formula || value?.value || "")!==(old?.formula || old?.value || "")) throw new Error("Only the supported form's data cells may change");
        continue;
      }
      if(value?.formula) throw new Error("Use values in the form data cells");
      if(!value?.value) continue;
      const column=col.charCodeAt(0)-65,heading=salesSections[section].headings[column];
      if(col.length!==1 || !heading || row>1004 || value.formula || value.value.length>2000) throw new Error("Use values in the form's data cells, up to 1,000 rows");
      const kind:Figure["kind"]=/date$/i.test(heading) ? "date" : numericHeadings.test(heading) ? "number" : "text";
      let read=value.value;
      if(kind==="date") {
        if(!/^\d{1,6}$/.test(read)) throw new Error("Keep the official Excel date cells");
        read=new Date(Date.UTC(1899,11,30)+Number(read)*86400000).toISOString().slice(0,10);
      }
      const field=`${section}.r${row}.c${column}`,figure={label:heading,value:read,kind};
      figures.set(field,figure);lines.push({...figure,field,page:Math.ceil(row/40),sheet:number,cell:ref});
    }
  }
  if(!lines.length || lines.length>10000) throw new Error("Choose a filled form within the size limit");
  gstr1Workbook(template,period,gstin,[figures]);
  return {lines};
}
