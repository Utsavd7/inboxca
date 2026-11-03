import Link from "next/link";
import {Fragment} from "react";
import {ChevronLeft} from "lucide-react";
import {unstable_rethrow} from "next/navigation";
import {z} from "zod";
import {hundredths} from "@/src/lib/datasets";
import {grouped} from "@/src/lib/form-layout";
import {itrWork} from "@/src/lib/itr";
import {itrFieldName,itrFields,itrReturns,itrYear,type ItrForm} from "@/src/lib/itr-fields";
import {formName} from "@/src/lib/prepared";
import {ageBands,newRegime,oldRegime,type AgeBand} from "@/src/lib/tax";
import {PageHead} from "../../../../ui";
import "../../../clients.css";

type Line={label:string;value:string;from:string};
const rupees=(amount:bigint)=>{const size=amount<BigInt(0) ? -amount : amount;return grouped(`${amount<BigInt(0) ? "-" : ""}${size/BigInt(100)}.${String(size%BigInt(100)).padStart(2,"0")}`);};
// The return's own stated totals, by their official path for each form (itr-fields.ts hashes a
// path InboxCA has no shared name for). Nothing is guessed: a path not in the schema is absent.
const stated:Record<string,Partial<Record<ItrForm,string>>>={
  gross:{ITR1:"ITR1_IncomeDeductions.GrossTotIncome",ITR4:"IncomeDeductions.GrossTotIncome",ITR2:"PartB-TI.GrossTotalIncome",ITR3:"PartB-TI.GrossTotalIncome"},
  total:{ITR1:"ITR1_IncomeDeductions.TotalIncome",ITR4:"IncomeDeductions.TotalIncome",ITR2:"PartB-TI.TotalIncome",ITR3:"PartB-TI.TotalIncome"},
  exempt:{ITR1:"ITR1_IncomeDeductions.AllwncExemptUs10.TotalAllwncExemptUs10",ITR4:"IncomeDeductions.AllwncExemptUs10.TotalAllwncExemptUs10"},
  tax:{ITR1:"ITR1_TaxComputation.TotalTaxPayable",ITR4:"TaxComputation.TotalTaxPayable"},
  rebate:{ITR1:"ITR1_TaxComputation.Rebate87A",ITR4:"TaxComputation.Rebate87A"},
  cess:{ITR1:"ITR1_TaxComputation.EducationCess",ITR4:"TaxComputation.EducationCess"},
  net:{ITR1:"ITR1_TaxComputation.NetTaxLiability",ITR4:"TaxComputation.NetTaxLiability"},
};
const heads=["itr.salary.income","itr.house_property.income","itr.business.income","itr.capital_gains.total","itr.capital_gains.ltcg112a","itr.other_sources.income"] as const;
const paid=["itr.tds.total","itr.tcs.total","itr.advance_tax.total","itr.self_assessment_tax.total"] as const;

// A read only computation for one return: the heads of income, deductions and taxable income
// from the figures a person has checked, added up by InboxCA beside what the return itself
// states. Tax under the old and new regime is worked out from official rate text (src/lib/tax.ts)
// for tax year 2026-27 on, for a resident individual's normal income; for AY 2026-27 under the
// 1961 Act InboxCA holds no rate text, so that part says what is needed instead.
export default async function Computation({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {id}=await params,q=await searchParams,form=z.enum(itrReturns).catch("ITR1").parse(q.form),period=/^20\d{2}$/.test(q.year ?? "") ? q.year! : "2026";
  const age=z.enum(["under60","60","80"]).catch("under60").parse(q.age) as AgeBand;
  const back=`/app/clients/${id}/itr?form=${form}&year=${period}`;
  let work:Awaited<ReturnType<typeof itrWork>>;
  try {work=await itrWork(id,form,period);} catch(error) {
    unstable_rethrow(error);
    return <><PageHead crumbs={[[back,"Income tax return"]]} title="Computation"/><p className="hint">InboxCA cannot open this return yet. Check that the client has a PAN and that the official form for {itrYear(period)} is in InboxCA.</p></>;
  }
  const {context,drafts}=work;
  // Checked figures only, by field; the first checked figure for a field counts, any other is named.
  const checked=new Map<string,Line>(),twice:string[]=[];
  let open=0;
  for(const row of drafts) for(const line of row.data.lines) {
    if(line.state!=="confirmed") {if(line.state==="pending") open++;continue;}
    const figure=row.figures.get(line.id)!,from=line.source.entered_by ? "entered by your team" : "read from a paper";
    if(checked.has(line.field)) {if(checked.get(line.field)!.value!==figure.value) twice.push(figure.label);continue;}
    checked.set(line.field,{label:figure.label,value:figure.value,from});
  }
  const at=(field:string)=>checked.get(field),amount=(line?:Line)=>{try {return line ? hundredths(line.value) : null;} catch {return null;}};
  const statedAt=(key:string)=>{const path=stated[key][form];return path ? at(itrFieldName(form,path)) : undefined;};
  const incomes=heads.flatMap(field=>{const line=at(field);return line && (itrFields[field].paths as Partial<Record<ItrForm,string>>)[form] ? [{field,label:itrFields[field].label,line}] : [];});
  const deductions=at("itr.deductions.total"),exempt=statedAt("exempt");
  const sum=incomes.reduce<bigint|null>((total,{line})=>{const value=amount(line);return total===null || value===null ? null : total+value;},BigInt(0));
  const taxable=sum!==null ? sum-(amount(deductions) ?? BigInt(0)) : null;
  const gross=statedAt("gross"),total=statedAt("total");
  const differs=(worked:bigint|null,line?:Line)=>{const value=amount(line);return worked!==null && value!==null && worked!==value;};
  const taxLines=(["tax","rebate","cess","net"] as const).flatMap(key=>{const line=statedAt(key);return line ? [line] : [];});
  const payments=paid.flatMap(field=>{const line=at(field);return line ? [{label:itrFields[field].label,line}] : [];});
  // Normal income: the taxable income less the heads taxed at their own rates (capital gains).
  const special=(["itr.capital_gains.total","itr.capital_gains.ltcg112a"] as const).flatMap(field=>{const line=at(field);return line ? [{label:itrFields[field].label,line}] : [];});
  const normal=taxable===null ? null : special.reduce((left,{line})=>left-(amount(line) ?? BigInt(0)),taxable);
  const regimes=Number(period)>=2027 && normal!==null ? [newRegime(normal<BigInt(0) ? BigInt(0) : normal),oldRegime(normal<BigInt(0) ? BigInt(0) : normal,age)] : null;
  const row=(label:string,value:string,note?:string,strong=false)=><li className="app-row" key={label+value}><span className="grow">{strong ? <strong>{label}</strong> : label}{note && <span className="sub">{note}</span>}</span><span className="num">{value}</span></li>;
  const shown=(line:Line)=>grouped(line.value,undefined,0);

  return <>
    <PageHead crumb={<Link className="crumb" href={back}><ChevronLeft size={14} aria-hidden/>{formName(form)} {itrYear(period)}</Link>} title={`Computation, ${context.client.name}`}
      sub={<span className="head-meta"><span>Working sheet for the CA to check. Figures a person has checked, added up by InboxCA. Nothing here is a return or is filed.</span></span>}/>
    <section className="pane client-pane computation" aria-label="Computation sheet">
      {!!open && <p className="hint">{open} {open===1 ? "figure is" : "figures are"} not checked yet and left out. <Link href={`/app/clients/${id}?tab=extraction`}>Check the figures</Link>.</p>}
      {!!twice.length && <p className="alert" role="alert">Two checked papers give different values for {twice.join(", ")}. The first is used here; settle it under Check the figures.</p>}
      <section className="panel" aria-labelledby="comp-income">
        <div className="panel-head"><h2 id="comp-income">Income</h2></div>
        <ul className="app-rows">
          {incomes.map(({label,line})=>row(label,shown(line),line.from))}
          {!incomes.length && <li className="app-row"><span className="grow hint">No head of income is checked yet.</span></li>}
          {exempt && row("Allowances exempt under section 10, as stated in the return",shown(exempt),"Not counted in the total; shown as the return has it")}
          {sum!==null && row("Gross total income, added up by InboxCA",rupees(sum),gross ? `The return states ${shown(gross)}${differs(sum,gross) ? ". These differ: check which is right" : ", the same"}` : "The return's own gross total income is not checked yet",true)}
        </ul>
      </section>
      <section className="panel" aria-labelledby="comp-deductions">
        <div className="panel-head"><h2 id="comp-deductions">Deductions and taxable income</h2></div>
        <ul className="app-rows">
          {deductions ? row(itrFields["itr.deductions.total"].label,shown(deductions),deductions.from) : <li className="app-row"><span className="grow hint">Total deductions are not checked yet, so nothing is taken off.</span></li>}
          {taxable!==null && row("Taxable income, worked out by InboxCA",rupees(taxable),total ? `The return states ${shown(total)}${differs(taxable,total) ? ". These differ: check which is right" : ", the same"}` : "The return's own total income is not checked yet",true)}
        </ul>
      </section>
      <section className="panel" aria-labelledby="comp-tax">
        <div className="panel-head"><h2 id="comp-tax">Tax, old and new regime</h2>{regimes && <span className="hint">Age for the old regime: {(Object.keys(ageBands) as AgeBand[]).map((band,i)=><Fragment key={band}>{i>0 && ", "}{band===age ? <strong>{ageBands[band]}</strong> : <Link href={`${back.replace("/itr?","/itr/computation?")}&age=${band}`}>{ageBands[band]}</Link>}</Fragment>)}</span>}</div>
        {regimes ? <>
          <p className="hint">On the normal income worked out by InboxCA, {rupees(normal!<BigInt(0) ? BigInt(0) : normal!)}, for a resident individual: Income-tax Act 2025 and the Finance Act 2026 rates for {itrYear(period)}. {special.length ? `${special.map(({label})=>label).join(" and ")} ${special.length===1 ? "is" : "are"} taxed at special rates and not computed here.` : "Income taxed at special rates (capital gains and the like) is not computed here."}</p>
          <div className="regimes">
            {regimes.map(regime=><ul className="app-rows" key={regime.name} aria-label={regime.name}>
              <li className="app-row"><span className="grow"><strong>{regime.name}</strong></span></li>
              {regime.steps.map(step=>row(step.label,rupees(step.amount),step.section))}
              {row("Tax for the year",rupees(regime.total),"Before taxes paid and interest",true)}
            </ul>)}
          </div>
        </> : Number(period)>=2027 ? <p className="hint">The taxable income is not worked out yet, so there is no tax to show. Check the heads of income first.</p>
          : <p className="hint">Not available for {itrYear(period)}. InboxCA works out tax only from official rate text, and holds the 1961 Act rates for this year (s.115BAC(1A)) in none of its official references. Form No. 130 (Income-tax Rules, 2026) gives only health and education cess at 4%. From tax year 2026-27 both regimes show here side by side.</p>}
        {!!taxLines.length && <>
          <p className="hint">As entered in the return, not worked out by InboxCA:</p>
          <ul className="app-rows">{taxLines.map(line=>row(line.label,shown(line),line.from))}</ul>
        </>}
      </section>
      {!!payments.length && <section className="panel" aria-labelledby="comp-paid">
        <div className="panel-head"><h2 id="comp-paid">Taxes paid</h2></div>
        <ul className="app-rows">{payments.map(({label,line})=>row(label,shown(line),line.from))}</ul>
      </section>}
    </section>
  </>;
}
