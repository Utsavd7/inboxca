import {randomUUID} from "node:crypto";
import {expect,it,vi} from "vitest";
import {checkTitle,itrDifferences,rupees} from "@/src/lib/itr-check";
import {itrCheckWorkItems} from "@/src/lib/work/itr-check";
import {readTaxPdf,readTaxText} from "../../worker/portal";
import {bankTan,form16,form26asText,tan} from "../fixtures/tax-papers";

const figures=vi.hoisted(()=>new Map<string,string>());
vi.mock("@/src/lib/crypto",()=>({serverCrypto:()=>({decrypt:async(_firm:string,path:string)=>figures.get(path.split("/").pop()!)})}));
vi.mock("@/src/lib/supabase",()=>({supabaseAdmin:()=>{throw new Error("Not used here");}}));

// The invented papers as InboxCA's readers give them: Form 26AS with the employer's salary TDS
// (booked F) and a bank's interest TDS (booked U), and the employer's Form 16.
const statement=readTaxText(form26asText())!.lines;
const salaryRow=[{field:"itr.tds.salary.0.tan",value:tan},{field:"itr.tds.salary.0.deducted",value:"64480"}];
const bank=`INVENTED BANK LIMITED (${bankTan})`; // ggignore: invented TAN.

it("lists 26AS TDS not in the return and an entry not booked as final, and nothing that agrees", async()=>{
  const certificate=(await readTaxPdf(Buffer.from(form16())))!.lines;
  const found=itrDifferences(certificate,statement,[{paper:"Form 16",figures:certificate}]);
  expect(found).toEqual([
    {paper:"Form 26AS",text:`TDS of ₹1,200 from ${bank} is in Form 26AS but not in the return.`},
    {paper:"Form 26AS",text:`₹1,200 of the TDS from ${bank} has booking status U in Form 26AS, not F (final).`},
  ]);
  expect(checkTitle(found)).toBe("Check before approving: 2 differences with Form 26AS");
});

it("takes amounts within 1 rupee as equal, adds a TAN's rows, and names TDS Form 26AS does not have", ()=>{
  const bankRow=(value:string)=>[{field:"itr.tds.other.0.tan",value:bankTan},{field:"itr.tds.other.0.deducted",value}];
  expect(itrDifferences([...salaryRow,...bankRow("1200.99")],statement,[])).toEqual([expect.objectContaining({text:expect.stringContaining("booking status U")})]);
  expect(itrDifferences([...salaryRow,...bankRow("1198")],statement,[])[0].text).toBe(`TDS from ${bank} is ₹1,200 in Form 26AS and ₹1,198 in the return.`);
  // The employer's TDS split over a salary row and another row under the same TAN still agrees.
  const split=[{field:"itr.tds.salary.0.tan",value:tan},{field:"itr.tds.salary.0.deducted",value:"60000"},{field:"itr.tds.other.1.tan",value:tan.toLowerCase()},{field:"itr.tds.other.1.deducted",value:"4480"},...bankRow("1200")];
  expect(itrDifferences(split,statement,[]).map(item=>item.text)).toEqual([`₹1,200 of the TDS from ${bank} has booking status U in Form 26AS, not F (final).`]);
  const extra=[...salaryRow,...bankRow("1200"),{field:"itr.tds.salary.1.tan",value:"ZZZZ00009Z"},{field:"itr.tds.salary.1.name",value:"INVENTED SECOND EMPLOYER"},{field:"itr.tds.salary.1.deducted",value:"5000"},{field:"itr.tds.other.2.tan",value:"ZZZZ00008Z"},{field:"itr.tds.other.2.deducted",value:"300"}]; // ggignore: invented TANs.
  expect(itrDifferences(extra,statement,[]).slice(0,2).map(item=>item.text)).toEqual(["TDS of ₹5,000 from INVENTED SECOND EMPLOYER (ZZZZ00009Z) is in the return but not in Form 26AS.","TDS of ₹300 from TAN ZZZZ00008Z is in the return but not in Form 26AS."]); // ggignore: invented TANs.
});

it("compares Form 16 and Form No. 130 salary with the return's, with or without Form 26AS", ()=>{
  const paper=(gross:string)=>[{field:"itr.salary.gross",value:gross},{field:"itr.salary.income",value:"100000"}];
  const found=itrDifferences([{field:"itr.salary.gross",value:"1150000"}],null,[{paper:"Form 16",figures:paper("700000")},{paper:"Form No. 130",figures:paper("500000.50")}]);
  expect(found).toEqual([
    {paper:"Form 16 and Form No. 130",text:"Gross salary is ₹12,00,000.50 in Form 16 and Form No. 130 and ₹11,50,000 in the return."},
    {paper:"Form 16 and Form No. 130",text:"Income from salary is ₹2,00,000 in Form 16 and Form No. 130 but not in the return."},
  ]);
  expect(checkTitle(found.slice(0,1))).toBe("Check before approving: 1 difference with Form 16 and Form No. 130");
  expect(itrDifferences([{field:"itr.salary.gross",value:"700000"}],null,[{paper:"Form 16",figures:[{field:"itr.salary.gross",value:"700000.00"}]}])).toEqual([]);
  expect(rupees(BigInt(-123456789))).toBe("-₹12,34,567.89");
});

it("gives the assigned person a Today item for a started return that differs, read as them", async()=>{
  const client=randomUUID(),own=randomUUID(),paper=randomUUID(),person=randomUUID(),at="2026-10-26T05:00:00.000Z",sha256="a".repeat(64);
  const lines=(draft:string,list:{field:string;value:string}[],source:object)=>list.map(({field,value})=>{const id=randomUUID();figures.set(id,JSON.stringify({label:field,value,kind:/tan$/.test(field) || /name$|section$|status$/.test(field) ? "text" : /date$/.test(field) ? "date" : "number"}));return {id,field,value_enc:`invented encrypted ${draft}`,source,state:"pending"};});
  const rows=[
    {id:own,client_id:client,period_key:"2026",form:"ITR1",data:{target:{form:"ITR1",version:"1.1"},lines:lines(own,salaryRow,{entered_by:person,entered_at:at}),checks:[]}},
    {id:paper,client_id:client,period_key:"2026",form:null,data:{lines:lines(paper,statement,{document:paper,sha256,page:1,reader:"form26as-text"}),checks:[]}},
  ];
  const answers:Record<string,unknown[]>={datasets:rows,tasks:[],clients:[{id:client,name:"Iyer Consultants"}],documents:[{id:paper}]};
  const supabase={from:(table:string)=>{const query={select:()=>query,eq:()=>query,not:()=>query,in:()=>query,like:()=>query,limit:()=>query,order:()=>query,then:(resolve:(value:unknown)=>void)=>resolve({data:answers[table],error:null})};return query;}};
  const context={supabase,membership:{firmId:"firm"},userId:person} as unknown as Parameters<typeof itrCheckWorkItems>[0];
  expect(await itrCheckWorkItems(context)).toEqual([{key:`itr-check:${client}:2026:ITR1`,title:"ITR-1 for Iyer Consultants, AY 2026-27",why:"2 differences with Form 26AS. Check before approving",client:{id:client,name:"Iyer Consultants"},action:{label:"See differences",href:`/app/clients/${client}/itr?form=ITR1&year=2026`},audience:"assigned"}]);
  // Once the return is filed, it is not checked again.
  answers.tasks=[{client_id:client,period_key:"2026-03"}];
  expect(await itrCheckWorkItems(context)).toEqual([]);
});
