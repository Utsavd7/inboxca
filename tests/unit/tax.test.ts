import {describe,expect,it} from "vitest";
import {newRegime,oldRegime,type AgeBand} from "@/src/lib/tax";

// Every example is worked by hand from the official text named in src/lib/tax.ts, in rupees;
// the library holds paise. "total" is tax after rebate, surcharge, marginal relief and 4% cess.
const r=(rupees:number)=>BigInt(rupees)*BigInt(100);
const steps=(regime:ReturnType<typeof newRegime>)=>Object.fromEntries(regime.steps.map(step=>[step.label.replace(/ at \d+%$/,""),step.amount]));

describe("new regime, s.202(1) with the s.156(2) rebate",()=>{
  it.each([
    // 4 lakh: nil band ends here. Tax 0.
    [400000,0,0,0],
    // 8 lakh: 5% of 4 lakh = 20,000; rebate the lesser of 20,000 and 60,000, so nil.
    [800000,20000,20000,0],
    // 12 lakh: 20,000 + 10% of 4 lakh (40,000) = 60,000; rebate 60,000, nil.
    [1200000,60000,60000,0],
    // 12,70,000: 60,000 + 15% of 70,000 (10,500) = 70,500; income above 12 lakh is 70,000, so
    // tax is kept to 70,000 (rebate 500); cess 4% = 2,800; total 72,800.
    [1270000,70500,500,72800],
    // 12,75,000: 60,000 + 15% of 75,000 (11,250) = 71,250, below the 75,000 above 12 lakh, so
    // no relief; cess 2,850; total 74,100.
    [1275000,71250,0,74100],
    // 16 lakh: 60,000 + 15% of 4 lakh (60,000) = 1,20,000; cess 4,800; total 1,24,800.
    [1600000,120000,0,124800],
    // 20 lakh: 1,20,000 + 20% of 4 lakh (80,000) = 2,00,000; cess 8,000; total 2,08,000.
    [2000000,200000,0,208000],
    // 24 lakh: 2,00,000 + 25% of 4 lakh (1,00,000) = 3,00,000; cess 12,000; total 3,12,000.
    [2400000,300000,0,312000],
    // 50 lakh: 3,00,000 + 30% of 26 lakh (7,80,000) = 10,80,000; no surcharge at exactly 50
    // lakh; cess 43,200; total 11,23,200.
    [5000000,1080000,0,1123200],
  ])("income %s: tax %s, rebate %s, total %s",(income,tax,rebate,total)=>{
    const regime=newRegime(r(income)),got=steps(regime);
    expect(got["Tax at slab rates on normal income"]).toBe(r(tax));
    expect(got["Less rebate"]).toBe(-r(rebate));
    expect(regime.total).toBe(r(total));
  });

  it.each([
    // 50,10,000: tax 10,80,000 + 30% of 10,000 = 10,83,000; surcharge 10% = 1,08,300, so
    // 11,91,300. Cap (s.3(5)): tax and surcharge at 50 lakh (10,80,000) plus 10,000 =
    // 10,90,000; relief 1,01,300. Cess 4% of 10,90,000 = 43,600; total 11,33,600.
    [5010000,10,108300,101300,1133600],
    // 1 crore: 3,00,000 + 30% of 76 lakh (22,80,000) = 25,80,000; surcharge 10% = 2,58,000,
    // 28,38,000; the cap, 10,80,000 + 50 lakh, is far above, no relief. Cess 1,13,520; total
    // 29,51,520.
    [10000000,10,258000,0,2951520],
    // 1,00,10,000: tax 25,83,000; surcharge 15% = 3,87,450, 29,70,450. Cap: 28,38,000 at 1
    // crore plus 10,000 = 28,48,000; relief 1,22,450. Cess 1,13,920; total 29,61,920.
    [10010000,15,387450,122450,2961920],
    // 2 crore: 3,00,000 + 30% of 1,76,00,000 (52,80,000) = 55,80,000; surcharge 15% =
    // 8,37,000, 64,17,000; no relief. Cess 2,56,680; total 66,73,680.
    [20000000,15,837000,0,6673680],
    // 2,00,10,000: tax 55,83,000; surcharge 25% = 13,95,750, 69,78,750. Cap: 64,17,000 at 2
    // crore plus 10,000 = 64,27,000; relief 5,51,750. Cess 2,57,080; total 66,84,080.
    [20010000,25,1395750,551750,6684080],
    // 5,00,10,000: s.202 surcharge stays 25% (Table Sl. 10 has no 37%): tax 3,00,000 + 30% of
    // 4,76,10,000 (1,42,83,000) = 1,45,83,000; surcharge 36,45,750; 1,82,28,750; cess 7,29,150;
    // total 1,89,57,900.
    [50010000,25,3645750,0,18957900],
  ])("income %s: surcharge %s%% is %s, marginal relief %s, total %s",(income,rate,surcharge,relief,total)=>{
    const regime=newRegime(r(income)),got=steps(regime);
    expect(regime.steps[2].label).toBe(`Surcharge at ${rate}%`);
    expect(got["Surcharge"]).toBe(r(surcharge));
    expect(got["Less marginal relief on surcharge"]).toBe(-r(relief));
    expect(regime.total).toBe(r(total));
  });
});

describe("old regime, Finance Act 2026 Part I-B Paragraph A with the s.156(1) rebate",()=>{
  it.each<[AgeBand,number,number,number,number]>([
    // Below 60, 2.5 lakh: nil.
    ["under60",250000,0,0,0],
    // Below 60, 5 lakh: 5% of 2.5 lakh = 12,500; rebate the lesser of 12,500 and 12,500, nil.
    ["under60",500000,12500,12500,0],
    // Below 60, 5,10,000: 12,500 + 20% of 10,000 = 14,500; no rebate above 5 lakh; cess 580;
    // total 15,080.
    ["under60",510000,14500,0,15080],
    // Below 60, 10 lakh: 12,500 + 20% of 5 lakh (1,00,000) = 1,12,500; cess 4,500; total 1,17,000.
    ["under60",1000000,112500,0,117000],
    // 60 to 79, 3 lakh: nil. 5 lakh: 5% of 2 lakh = 10,000, rebate 10,000, nil. 10 lakh:
    // 10,000 + 1,00,000 = 1,10,000; cess 4,400; total 1,14,400.
    ["60",300000,0,0,0],
    ["60",500000,10000,10000,0],
    ["60",1000000,110000,0,114400],
    // 80 and above, 5 lakh: nil. 10 lakh: 20% of 5 lakh = 1,00,000; cess 4,000; total 1,04,000.
    ["80",500000,0,0,0],
    ["80",1000000,100000,0,104000],
  ])("%s, income %s: tax %s, rebate %s, total %s",(age,income,tax,rebate,total)=>{
    const regime=oldRegime(r(income),age),got=steps(regime);
    expect(got["Tax at slab rates on normal income"]).toBe(r(tax));
    expect(got["Less rebate"]).toBe(-r(rebate));
    expect(regime.total).toBe(r(total));
  });

  it.each([
    // 50,10,000: 1,12,500 + 30% of 40,10,000 (12,03,000) = 13,15,500; surcharge 10% =
    // 1,31,550, 14,47,050. Cap (Table 2): tax at 50 lakh, 13,12,500, plus 10,000 = 13,22,500;
    // relief 1,24,550. Cess 52,900; total 13,75,400.
    [5010000,10,131550,124550,1375400],
    // 1,00,10,000: 1,12,500 + 30% of 90,10,000 (27,03,000) = 28,15,500; surcharge 15% =
    // 4,22,325, 32,37,825. Cap: 28,12,500 at 1 crore with 10% (30,93,750) plus 10,000 =
    // 31,03,750; relief 1,34,075. Cess 1,24,150; total 32,27,900.
    [10010000,15,422325,134075,3227900],
    // 2,00,10,000: 1,12,500 + 30% of 1,90,10,000 (57,03,000) = 58,15,500; surcharge 25% =
    // 14,53,875, 72,69,375. Cap: 58,12,500 at 2 crore with 15% (66,84,375) plus 10,000 =
    // 66,94,375; relief 5,75,000. Cess 2,67,775; total 69,62,150.
    [20010000,25,1453875,575000,6962150],
    // 5 crore: 1,12,500 + 30% of 4,90,00,000 (1,47,00,000) = 1,48,12,500; surcharge 25% =
    // 37,03,125, 1,85,15,625; no relief. Cess 7,40,625; total 1,92,56,250.
    [50000000,25,3703125,0,19256250],
    // 5,00,10,000: tax 1,48,15,500; surcharge 37% = 54,81,735, 2,02,97,235. Cap: 1,85,15,625
    // at 5 crore plus 10,000 = 1,85,25,625; relief 17,71,610. Cess 7,41,025; total 1,92,66,650.
    [50010000,37,5481735,1771610,19266650],
  ])("below 60, income %s: surcharge %s%% is %s, marginal relief %s, total %s",(income,rate,surcharge,relief,total)=>{
    const regime=oldRegime(r(income),"under60"),got=steps(regime);
    expect(regime.steps[2].label).toBe(`Surcharge at ${rate}%`);
    expect(got["Surcharge"]).toBe(r(surcharge));
    expect(got["Less marginal relief on surcharge"]).toBe(-r(relief));
    expect(regime.total).toBe(r(total));
  });
});

describe("AY 2026-27 under the 1961 Act",()=>{
  // s.115BAC(1A)(iii) and s.87A as amended by the Finance Act 2025, and Part I-A of the Finance
  // Act 2026, give the same figures as tax year 2026-27; only the sections named differ.
  it.each([800000,1270000,5010000,25000000])("income %s: the same tax, with 1961 Act sections",income=>{
    for(const [then,now] of [[newRegime(r(income),2026),newRegime(r(income))],[oldRegime(r(income),"60",2026),oldRegime(r(income),"60")]]) {
      expect(then.total).toBe(now.total);
      expect(then.steps.map(step=>step.section).join(" ")).not.toMatch(/2025 s\.|s\.3\(|Part I-B/);
    }
    expect(newRegime(r(income),2026).steps[0].section).toBe("Income-tax Act 1961 s.115BAC(1A)(iii)");
  });
});
