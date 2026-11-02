import {checkFigures,hundredths,type Draft,type Figure} from "./datasets";
import {amends,registerColumns,salesSections,type SalesSection} from "./gstr1-fields";
import {isGstin} from "./identifiers";

// A GST register checked by its totals, not cell by cell: a section is right when its rows add up
// to the register's own total row and, where the register names the tax, each row's tax is its rate
// times its taxable value. Rows that are unusual by rule stay for a person to check one by one.
type Line=Draft["lines"][number];
const cell=/^([a-z0-9_]+)\.([rt])(\d+)\.c(\d+)$/;
export const registerLine=(field:string)=>{const hit=cell.exec(field);return hit && Object.hasOwn(salesSections,hit[1]) ? {section:hit[1] as SalesSection,total:hit[2]==="t",row:`${hit[2]}${hit[3]}`,column:Number(hit[4])} : null;};
export type Section={section:SalesSection;name:string;rows:number;flagged:{row:string;line:string;why:string}[];totals:{label:string;value:string;ok:boolean}[];byRate:{rate:string;taxable:bigint;tax?:bigint}[];agree:boolean;lines:string[];checked:boolean;by?:string;at?:string};
const taxOn=(taxable:bigint,rate:bigint)=>{const product=taxable*rate,sign=product<BigInt(0) ? BigInt(-1) : BigInt(1);return sign*((product*sign+BigInt(5000))/BigInt(10000));};

export function sectionSummary(draft:Draft,figures:Map<string,Figure>):Section[] {
  const sections=new Map<SalesSection,Map<string,Map<number,Line>>>();
  for(const line of draft.lines) {
    const at=registerLine(line.field);
    if(!at) continue;
    if(!sections.has(at.section)) sections.set(at.section,new Map());
    const rows=sections.get(at.section)!;
    if(!rows.has(at.row)) rows.set(at.row,new Map());
    rows.get(at.row)!.set(at.column,line);
  }
  return [...sections].map(([section,rows])=>{
    const headings=registerColumns(section),col=(name:string)=>headings.indexOf(name),value=(row:Map<number,Line>,column:number)=>{const line=row.get(column);return line ? figures.get(line.id)?.value ?? "" : "";};
    const data=[...rows].filter(([key])=>key.startsWith("r")),totalRows=[...rows].filter(([key])=>key.startsWith("t"));
    const rate=col("Rate"),taxable=col("Taxable Value"),taxes=["Integrated Tax Amount","Central Tax Amount","State/UT Tax Amount"].map(col).filter((at)=>at>=0);
    const number=["Invoice Number","Note Number","Document Number"].map(col).find((at)=>at>=0),dated=headings.findIndex((heading)=>/date$/i.test(heading)),valued=["Invoice Value","Note Value","Value of supplies made"].map(col).find((at)=>at>=0);
    const rates=new Map<string,number>(),headers=new Map<string,Set<string>>();
    for(const [,row] of data) {
      if(rate>=0) rates.set(value(row,rate),(rates.get(value(row,rate)) ?? 0)+1);
      if(number!==undefined) {const id=value(row,number);if(!headers.has(id)) headers.set(id,new Set());headers.get(id)!.add([headings.findIndex((heading)=>/GSTIN/.test(heading)),dated,valued ?? -1].map((at)=>at>=0 ? value(row,at) : "").join("|"));}
    }
    const flagged:Section["flagged"]=[],byRate=new Map<string,{taxable:bigint;tax?:bigint}>();
    for(const [key,row] of data) {
      const why:string[]=[];
      const first=[...row.values()][0].id;
      if(rate>=0 && !value(row,rate)) why.push("The rate is missing");
      if(taxable>=0 && !value(row,taxable)) why.push("The taxable value is missing");
      if(Object.hasOwn(amends,section)) why.push("An amendment: check it against the original");
      headings.forEach((heading,column)=>{
        if(!/GSTIN/.test(heading)) return;
        const gstin=value(row,column);
        if(gstin ? !isGstin(gstin) : heading!=="E-Commerce GSTIN") why.push(`${heading} is ${gstin ? "not a valid GSTIN" : "missing"}`);
      });
      if(rate>=0 && data.length>=10 && rates.get(value(row,rate))===1) why.push("A rate no other row uses");
      if(number!==undefined && (headers.get(value(row,number))?.size ?? 0)>1) why.push("Another row has this number with different details");
      if([...row.values()].some((line)=>line.state==="rejected")) why.push("Marked wrong");
      try {
        if(rate>=0 && taxable>=0 && value(row,taxable)) {
          const base=hundredths(value(row,taxable)),at=hundredths(value(row,rate) || "0"),due=taxOn(base,at);
          const entry=byRate.get(value(row,rate)) ?? {taxable:BigInt(0),...(taxes.length && {tax:BigInt(0)})};
          entry.taxable+=base;
          if(taxes.length) {
            const paid=taxes.reduce((sum,column)=>sum+hundredths(value(row,column) || "0"),BigInt(0));
            entry.tax=entry.tax!+paid;
            if(paid!==due) why.push("The tax is not the rate times the taxable value");
          }
          byRate.set(value(row,rate),entry);
        }
      } catch {why.push("A figure could not be read");}
      if(why.length) flagged.push({row:key,line:first,why:why.join(". ")});
    }
    // The register's own totals, each against the sum of its rows (the draft's sum checks).
    const totals:Section["totals"]=totalRows.flatMap(([,row])=>[...row.values()].flatMap((line)=>{
      const check=draft.checks.find((one)=>one.kind==="sum" && one.total===line.id);
      return check ? [{label:figures.get(line.id)!.label.replace(/, row \d+$/,""),value:figures.get(line.id)!.value,ok:checkFigures({...draft,checks:[check]},figures).length===0}] : [];
    }));
    const skip=new Set(flagged.map((one)=>one.row));
    const lines=[...rows].filter(([key])=>!skip.has(key)).flatMap(([,row])=>[...row.values()]);
    const latest=lines.filter((line)=>line.state==="confirmed").sort((a,b)=>(a.at! < b.at! ? 1 : -1))[0];
    return {section,name:salesSections[section].name,rows:data.length,flagged,totals,byRate:[...byRate].map(([rate,entry])=>({rate,...entry})).sort((a,b)=>Number(a.rate)-Number(b.rate)),
      agree:totals.length>0 && totals.every((total)=>total.ok),lines:lines.map((line)=>line.id),checked:lines.length>0 && lines.every((line)=>line.state==="confirmed"),...(latest && {by:latest.by,at:latest.at})};
  });
}
