import Link from "next/link";
import {currentMember} from "@/src/lib/member";
import {deductorOf} from "@/src/lib/tds-draft";
import {deductorTypes,ministryCodes,stateCodes,type Deductor} from "@/src/lib/tds";
import {Pending} from "../../pending";
import {saveTdsDetails} from "./tds-actions";

// The details a TDS or TCS statement (Forms No. 140, 138, 144 and 143) needs about the deductor
// or collector and the person responsible, one set for each of the client's TANs. Most come from
// the client's own papers: the TAN allotment letter and the challans it pays with.
export async function TdsDetails({client,name,tans,tan,error}:{client:string;name:string;tans:{id:string;number:string}[];tan?:string;error?:string}) {
  const {supabase,membership}=await currentMember();
  if(!membership) return null;
  const chosen=tans.find(row=>row.id===tan) ?? tans[0];
  if(!chosen) return <p className="hint">Add the client&apos;s TAN under Tax numbers first.</p>;
  const saved=await deductorOf(supabase,membership.firmId,client,chosen.id);
  const blank={flat:"",post:"",road:"",area:"",district:"",state:"",pin:"",country:"India",email:"",code:"91",phone:""};
  const d:Deductor=saved ?? {name:name.slice(0,75),type:"",...blank,govt_state:"",ministry:"",ministry_other:"",person:{name:"",designation:"",...blank,pan:""}};
  const states=Object.entries(stateCodes);
  const input=(id:string,label:string,value:string,max:number,extra:Record<string,unknown>={})=><div><label htmlFor={id}>{label}</label><input id={id} name={id} defaultValue={value} maxLength={max} {...extra}/></div>;
  const place=(at:"d_"|"p_",of:typeof d|typeof d.person)=><>
    {input(`${at}flat`,"Flat, door or block number",of.flat,25)}
    {input(`${at}road`,"Road, street or sector",of.road,25)}
    {input(`${at}area`,"Area or locality",of.area,25)}
    {input(`${at}post`,"Post office",of.post,25)}
    {input(`${at}district`,"District",of.district,25)}
    <div><label htmlFor={`${at}state`}>State</label><select id={`${at}state`} name={`${at}state`} defaultValue={of.state}><option value="">Choose</option>{states.map(([code,state])=><option key={code} value={code}>{state}</option>)}</select></div>
    {input(`${at}pin`,"PIN code",of.pin,6,{inputMode:"numeric",className:"num"})}
    {input(`${at}country`,"Country",of.country,25)}
    {input(`${at}email`,"Email",of.email,75,{type:"email"})}
    <div className="form-row">{input(`${at}code`,"Country calling code",of.code,5,{inputMode:"numeric",className:"num"})}{input(`${at}phone`,"Phone number",of.phone,10,{inputMode:"numeric",className:"num"})}</div>
  </>;
  return <>
    {error==="tds" && <p className="alert" role="alert">Check the details: PIN codes need 6 digits, phone numbers up to 10 digits, and the PAN 5 letters, 4 digits and a letter.</p>}
    {tans.length>1 && <nav className="pills" aria-label="TAN">{tans.map(row=><Link key={row.id} href={`?tab=tds&tan=${row.id}`} aria-current={row.id===chosen.id ? "page" : undefined}>{row.number}</Link>)}</nav>}
    <p className="hint">For the TDS statement of TAN <span className="num">{chosen.number}</span>. Write them as on the TAN records, in English. The statement is checked against them before it is made.</p>
    <form action={saveTdsDetails} className="fields">
      <input type="hidden" name="client" value={client}/><input type="hidden" name="tan" value={chosen.id}/>
      <h3>Deductor</h3>
      {input("name","Name as on the TAN",d.name,75,{required:true})}
      <div><label htmlFor="type">Type of deductor</label><select id="type" name="type" defaultValue={d.type} required><option value="">Choose</option>{Object.entries(deductorTypes).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></div>
      {place("d_",d)}
      <details><summary>For a government deductor</summary>
        <div><label htmlFor="govt_state">State, for a State Government deductor</label><select id="govt_state" name="govt_state" defaultValue={d.govt_state}><option value="">Not a State Government deductor</option>{states.map(([code,state])=><option key={code} value={code}>{state}</option>)}</select></div>
        <div><label htmlFor="ministry">Ministry, for a Central Government deductor</label><select id="ministry" name="ministry" defaultValue={d.ministry}><option value="">Not a Central Government deductor</option>{Object.entries(ministryCodes).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></div>
        {input("ministry_other","Ministry name, if Others",d.ministry_other,150)}
      </details>
      <h3>Person responsible for deduction</h3>
      {input("p_name","Name",d.person.name,75,{required:true})}
      {input("p_designation","Designation",d.person.designation,20,{required:true})}
      {input("p_pan","PAN",d.person.pan,10,{className:"num",autoComplete:"off"})}
      {place("p_",d.person)}
      <Pending className="b b-primary">Save statement details</Pending>
    </form>
  </>;
}
