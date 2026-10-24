import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";

// The signed in app's design rules (type, weight, space, corners, colour through tokens only).
const files=readdirSync("app/(app)",{recursive:true,encoding:"utf8"}).map((file)=>`app/(app)/${file}`);
const sizes=["12px","13px","14px","16px","24px","inherit"],weights=["400","500","600","inherit"];
const space=[0,4,8,12,16,24,32,48],corners=[0,6,8,12,999];

function cssProblems(css:string){
  const problems:string[]=[];
  for(const [,name,raw] of css.replace(/\/\*[\s\S]*?\*\//g,"").matchAll(/[{;]\s*([a-z-]+)\s*:\s*([^;{}]+)/g)){
    const value=raw.replace(/\s*!important/,"").trim(),px=[...value.matchAll(/(-?[\d.]+)px/g)].map((match)=>Math.abs(Number(match[1])));
    const bad=name==="font-size" ? !sizes.includes(value) && !value.startsWith("var(")
      : name==="font-weight" ? !weights.includes(value)
      : name==="font" ? px.some((size)=>!sizes.includes(`${size}px`)) || /\b(?!400|500|600)\d00\b/.test(value)
      : /^(margin|padding|gap|row-gap|column-gap|inset)/.test(name) ? px.some((size)=>!space.includes(size))
      : name.includes("radius") ? px.some((size)=>!corners.includes(size)) || /%/.test(value) && value!=="50%"
      : false;
    if(bad) problems.push(`${name}: ${value}`);
    if(/#[0-9a-f]{3,8}\b/i.test(value)) problems.push(`colour ${name}: ${value}`);
  }
  return problems;
}

it("keeps every style sheet of the signed in app on the scale",()=>{
  const sheets=files.filter((file)=>file.endsWith(".css"));
  expect(sheets).toContain("app/(app)/app/app.css");
  for(const file of sheets){
    const css=readFileSync(file,"utf8").replace(/^html:has\(\.ui\) \{[\s\S]*?\n\}/m,(block)=>block.replace(/#[0-9a-f]{3,8}\b/gi,""));
    expect(cssProblems(css),file).toEqual([]);
  }
});

it("keeps inline styles in the signed in app on the scale",()=>{
  for(const file of files.filter((name)=>name.endsWith(".tsx"))){
    const tsx=readFileSync(file,"utf8"),problems=[
      ...[...tsx.matchAll(/fontSize\s*:\s*["']?(\d+)/g)].filter((match)=>!sizes.includes(`${match[1]}px`)),
      ...[...tsx.matchAll(/fontWeight\s*:\s*["']?(\d+)/g)].filter((match)=>!weights.includes(match[1])),
    ].map((match)=>match[0]);
    expect(problems,file).toEqual([]);
  }
});

it("catches values off the scale",()=>{
  expect(cssProblems(".a{font-size:15px;font-weight:700;padding:10px 16px;border-radius:7px;color:#fff;border:1px solid var(--line)}"))
    .toEqual(["font-size: 15px","font-weight: 700","padding: 10px 16px","border-radius: 7px","colour color: #fff"]);
});
