// Income tax on a resident individual's normal income for tax year 2026-27 on, from official
// text alone: the Income-tax Act, 2025, s.202(1) (new regime slabs) and s.156 (rebate), and the
// Finance Act, 2026 (https://egazette.gov.in/WriteReadData/2026/271439.pdf): First Schedule
// Part I-B Paragraph A (old regime slabs by age), Paragraph F Table 1 Sl. 1 and Table 2 Sl. 1
// (old regime surcharge and its marginal relief), s.3(4)(b) Table Sl. 10 and s.3(5) Table Sl. 6
// (new regime surcharge and its marginal relief), s.3(15) (4% cess). Amounts are paise, as the
// ITR figures are. Income taxed at special rates (capital gains and the like) is not computed.
export type Step={label:string;section:string;amount:bigint};
export type Regime={name:string;steps:Step[];total:bigint};
export type AgeBand="under60"|"60"|"80";
export const ageBands:Record<AgeBand,string>={under60:"Below 60",60:"60 to 79","80":"80 and above"};

const lakh=(n:number)=>BigInt(n*100000)*BigInt(100);
const percent=(amount:bigint,rate:number)=>amount*BigInt(rate)/BigInt(100);
const max=(a:bigint,b:bigint)=>a>b ? a : b,min=(a:bigint,b:bigint)=>a<b ? a : b;
// Each slab is its upper limit (none for the last) and its rate on the income within it.
type Slab=[upTo:bigint|null,rate:number];
const slabTax=(income:bigint,slabs:Slab[])=>{
  let tax=BigInt(0),from=BigInt(0);
  for(const [upTo,rate] of slabs) {
    const to=upTo===null ? income : min(income,upTo);
    if(to>from) tax+=percent(to-from,rate);
    if(upTo===null || income<=upTo) break;
    from=upTo;
  }
  return tax;
};
// s.202(1): nil to 4 lakh, then 5, 10, 15, 20, 25 and 30 per cent for each 4 lakh band above.
const newSlabs:Slab[]=[[lakh(4),0],[lakh(8),5],[lakh(12),10],[lakh(16),15],[lakh(20),20],[lakh(24),25],[null,30]];
// Part I-B Paragraph A items (I), (II) and (III): the nil band is 2.5, 3 or 5 lakh by age.
const oldSlabs:Record<AgeBand,Slab[]>={under60:[[lakh(2.5),0],[lakh(5),5],[lakh(10),20],[null,30]],60:[[lakh(3),0],[lakh(5),5],[lakh(10),20],[null,30]],"80":[[lakh(5),0],[lakh(10),20],[null,30]]};
// Surcharge bands: income above the first amount of a band pays the rate on the whole tax;
// marginal relief keeps tax plus surcharge within tax plus surcharge at the band's start
// plus the income above it. Paragraph F Table 1 Sl. 1 and Table 2 Sl. 1 for the old regime;
// s.3(4)(b) Table Sl. 10 and s.3(5) Table Sl. 6 for s.202, which stops at 25%.
type Band=[above:bigint,rate:number];
const oldBands:Band[]=[[lakh(50),10],[lakh(100),15],[lakh(200),25],[lakh(500),37]];
const newBands:Band[]=[[lakh(50),10],[lakh(100),15],[lakh(200),25]];
const surchargeRate=(income:bigint,bands:Band[])=>bands.reduce((rate,[above,r])=>income>above ? r : rate,0);
const bandStart=(income:bigint,bands:Band[])=>bands.reduce<bigint|null>((start,[above])=>income>above ? above : start,null);

function regime(name:string,income:bigint,slabs:Slab[],bands:Band[],rebate:(tax:bigint)=>[bigint,string],sections:{slabs:string;surcharge:string;relief:string}):Regime {
  const tax=slabTax(income,slabs),[off,rebateSection]=rebate(tax),after=tax-off;
  // Tax plus surcharge before marginal relief, at any income; the band's start sets the cap.
  const charged=(at:bigint)=>{const t=slabTax(at,slabs);return t+percent(t,surchargeRate(at,bands));};
  const rate=surchargeRate(income,bands),surcharge=percent(after,rate),start=bandStart(income,bands);
  const relief=start===null ? BigInt(0) : max(BigInt(0),after+surcharge-(charged(start)+(income-start)));
  const before=after+surcharge-relief,cess=percent(before,4);
  const steps:Step[]=[
    {label:"Tax at slab rates on normal income",section:sections.slabs,amount:tax},
    {label:"Less rebate",section:rebateSection,amount:-off},
    {label:`Surcharge at ${rate}%`,section:sections.surcharge,amount:surcharge},
    {label:"Less marginal relief on surcharge",section:sections.relief,amount:-relief},
    {label:"Health and Education Cess at 4%",section:"Finance Act 2026 s.3(15)",amount:cess},
  ];
  return {name,steps,total:before+cess};
}

// New regime: s.156(2), total income up to 12 lakh pays nothing up to 60,000 of tax; above it
// the tax is kept within the income above 12 lakh.
export const newRegime=(income:bigint)=>regime("New regime, s.202(1)",income,newSlabs,newBands,tax=>
  [income<=lakh(12) ? min(tax,BigInt(6000000)) : max(BigInt(0),tax-(income-lakh(12))),"Income-tax Act 2025 s.156(2)"],
  {slabs:"Income-tax Act 2025 s.202(1)",surcharge:"Finance Act 2026 s.3(4)(b) Table Sl. 10",relief:"Finance Act 2026 s.3(5) Table Sl. 6"});
// Old regime: s.156(1), a resident with total income up to 5 lakh pays nothing up to 12,500.
export const oldRegime=(income:bigint,age:AgeBand)=>regime(`Old regime, ${ageBands[age].toLowerCase()}`,income,oldSlabs[age],oldBands,tax=>
  [income<=lakh(5) ? min(tax,BigInt(1250000)) : BigInt(0),"Income-tax Act 2025 s.156(1)"],
  {slabs:`Finance Act 2026 First Schedule Part I-B Paragraph A(${age==="under60" ? "I" : age==="60" ? "II" : "III"})`,surcharge:"Finance Act 2026 Part I-B Paragraph F Table 1 Sl. 1",relief:"Finance Act 2026 Part I-B Paragraph F Table 2 Sl. 1"});
